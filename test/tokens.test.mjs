// Token efficiency is a promise of this tool: what it puts in front of Claude stays small, and the
// default spends nothing when there is nothing new. These tests hold it to that.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDigest, leanTranscript, SKILLS, digestMode } from "../claude-team.mjs";
import { tmp, person, gitc, sh, runCli, writeFakeSession, isolatedGitEnv } from "./helpers.mjs";

// A hub on disk, written by hand: TEAM.md, notes by two people, and shared sessions.
function fakeHub() {
  const dir = tmp("ct-hub-");
  const p = path.join(dir, "projects", "web");
  fs.mkdirSync(path.join(p, "notes"), { recursive: true });
  fs.writeFileSync(path.join(p, "TEAM.md"), "# Team context: web\n\n## Conventions\n- pnpm, never npm\n- PRs reviewed within a day\n");
  fs.writeFileSync(path.join(p, "notes", "alice.md"), "# Notes by Alice\n\n- 2026-10-01 09:00 [Alice] staging moved to eu-west\n");
  fs.writeFileSync(path.join(p, "notes", "bob.md"), "# Notes by Bob\n\n- 2026-10-01 10:00 [Bob] API v2 is live\n");
  const share = (id, author, title, firstShared, sharedAt = firstShared) => {
    const d = path.join(p, "sessions", `${firstShared.slice(0, 10)}_${author.toLowerCase()}_${id.slice(0, 8)}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ id, title, author, authorSlug: author.toLowerCase(), firstShared, sharedAt, next: "write the test" }));
  };
  share("aaaaaaaa-1", "Alice", "Fix login", "2026-10-01T09:30:00.000Z");
  return { hub: { dir, label: "a test hub" }, share, notes: (who, line) => fs.appendFileSync(path.join(p, "notes", `${who.toLowerCase()}.md`), `- ${line}\n`), team: path.join(p, "TEAM.md") };
}

test("the default digest says each thing once, and nothing at all when nothing is new", () => {
  const h = fakeHub();
  const me = "bob";
  const first = buildDigest(h.hub, "web", { me });
  assert.match(first.text, /TEAM\.md:[\s\S]*pnpm/, "a first session sees the standing context");
  assert.match(first.text, /aaaaaaaa Alice: Fix login \(next: write the test\)/);
  assert.ok(first.text.length <= 1500);
  const seen = { at: "2026-10-02T00:00:00.000Z", notes: first.notesFromOthers, team: first.teamHash };

  const quiet = buildDigest(h.hub, "web", { me, seen });
  assert.equal(quiet.text, "", "nothing new: zero tokens");

  h.notes("Alice", "2026-10-02 08:00 [Alice] release on Friday");
  h.share("cccccccc-3", "Alice", "Rate limiter", "2026-10-02T08:30:00.000Z");
  h.share("aaaaaaaa-1", "Alice", "Fix login", "2026-10-01T09:30:00.000Z", "2026-10-02T09:00:00.000Z"); // a live update
  const fresh = buildDigest(h.hub, "web", { me, seen });
  assert.match(fresh.text, /new since your last session/);
  assert.match(fresh.text, /Alice 10-02: release on Friday/);
  assert.match(fresh.text, /cccccccc Alice: Rate limiter/);
  assert.doesNotMatch(fresh.text, /Fix login/, "an update of a session already announced is not news");
  assert.doesNotMatch(fresh.text, /TEAM\.md/, "unchanged TEAM.md is not repeated");
  assert.doesNotMatch(fresh.text, /API v2/, "old notes are not repeated");
  assert.ok(fresh.text.length < 500, `${fresh.text.length} characters`);

  fs.appendFileSync(h.team, "- deploys on Thursdays\n");
  assert.match(buildDigest(h.hub, "web", { me, seen }).text, /TEAM\.md:[\s\S]*deploys on Thursdays/, "a changed TEAM.md is shown again");
});

test("pointer, off and full modes, and the size cap", () => {
  const h = fakeHub();
  const seen = { at: "2026-10-02T00:00:00.000Z", notes: 1, team: "x" };
  h.notes("Alice", "2026-10-02 08:00 [Alice] release on Friday");
  const pointer = buildDigest(h.hub, "web", { me: "bob", seen, mode: "pointer" }).text;
  assert.equal(pointer.split("\n").length, 1);
  assert.match(pointer, /1 new note, TEAM\.md changed since your last session/);
  assert.equal(buildDigest(h.hub, "web", { me: "bob", seen, mode: "off" }).text, "");
  fs.appendFileSync(h.team, `- ${"a very long convention line ".repeat(200)}\n`);
  const full = buildDigest(h.hub, "web", { me: "bob", seen, mode: "full" }).text;
  assert.match(full, /Notes:/);
  assert.match(full, /Shared sessions/);
  assert.ok(full.length <= 1500, `${full.length} characters`);
  assert.equal(digestMode({ project: "web", digest: "full" }, { projects: { web: { digest: "pointer" } } }), "pointer");
  assert.equal(digestMode({ project: "web" }, {}), "new");
});

test("only /team-load is visible to Claude, and every description is short", () => {
  for (const [name, body] of Object.entries(SKILLS)) {
    const description = body.match(/^description: (.*)$/m)[1];
    assert.ok(description.length <= 100, `${name}: ${description.length} characters`);
    assert.equal(/^disable-model-invocation: true$/m.test(body), name !== "team-load", name);
  }
  assert.match(SKILLS["team-share"], /at most 25 lines/);
});

test("the lean transcript drops successful tool output and keeps failures", () => {
  const md = "# Title\n\nShared by **Alice** on 2026-10-01\n\n### Claude\n\n- Read `a.ts`\n  - ↳ 300 lines of code\n  - ✗ permission denied\n\nDone.\n";
  const lean = leanTranscript(md);
  assert.doesNotMatch(lean, /300 lines of code|^# Title|Shared by/m);
  assert.match(lean, /✗ permission denied/);
  assert.match(lean, /- Read `a\.ts`/);
});

test("loading and resuming a long session say what they cost", () => {
  const base = tmp("ct-tok-");
  const genv = isolatedGitEnv(base);
  const shared = path.join(base, "hub");
  const ann = person(base, "Ann");
  const ben = person(base, "Ben");
  const aRoot = path.join(base, "ann", "web");
  fs.mkdirSync(aRoot, { recursive: true });
  assert.equal(runCli(["init", "--hub", shared, "--yes", "--project", "web"], { cwd: aRoot, env: ann.env }).code, 0);
  const s = writeFakeSession({ claude: ann.claude, root: aRoot, home: ann.home, title: "Big refactor", extraTurns: 60 });
  assert.equal(runCli(["share", s.id], { cwd: aRoot, env: ann.env }).code, 0);
  const metaDir = fs.readdirSync(path.join(shared, "projects", "web", "sessions"))[0];
  const meta = JSON.parse(fs.readFileSync(path.join(shared, "projects", "web", "sessions", metaDir, "meta.json"), "utf8"));
  assert.ok(meta.approxTokens > 20000, `approxTokens ${meta.approxTokens}`);

  const bRoot = path.join(base, "ben", "web");
  fs.cpSync(aRoot, bRoot, { recursive: true });
  assert.equal(runCli(["join", "--folder", shared], { cwd: bRoot, env: ben.env }).code, 0);
  const lean = runCli(["show", "--for-context", s.id.slice(0, 8)], { cwd: bRoot, env: ben.env });
  assert.equal(lean.code, 0, lean.all);
  assert.ok(lean.out.length < 16000, `default load is ${lean.out.length} characters`);
  assert.match(lean.out, /About [\d.]+K tokens loaded of a [\d.]+K-token conversation; "\/team-load [0-9a-f]{8} full" loads more/);
  assert.doesNotMatch(lean.out, /doWork\(\);/, "tool output is not loaded");
  assert.match(lean.out, /Module 59 is refactored/, "the latest state is loaded");
  const full = runCli(["show", "--for-context", `${s.id.slice(0, 8)} full`], { cwd: bRoot, env: ben.env });
  assert.ok(full.out.length > lean.out.length * 1.5, "full loads more");

  const resume = runCli(["resume", s.id.slice(0, 8)], { cwd: bRoot, env: ben.env });
  assert.equal(resume.code, 0, resume.all);
  assert.match(resume.out, /Resuming re-sends this whole conversation, about [\d.]+K tokens/);
  assert.match(resume.out, /\/team-load [0-9a-f]{8} loads the brief and the recent conversation for about 3K tokens/);
  const list = runCli(["list"], { cwd: bRoot, env: ben.env });
  assert.match(list.out, /Big refactor +~[\d.]+K tok/);
  void gitc; void sh; void genv;
});
