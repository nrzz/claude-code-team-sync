// Automatic sync: background pulls and pushes, notices of what teammates add, and automatic
// sharing. Hooks run as Claude Code runs them: a separate process, JSON on stdin.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { autoSettings, diffSnapshots } from "../claude-team.mjs";
import { tmp, person, gitc, sh, runCli, writeFakeSession, isolatedGitEnv } from "./helpers.mjs";

test("settings: yours for the project, then yours, then the project's, then the defaults", () => {
  assert.deepEqual(autoSettings({ project: "web" }, {}), { autoSync: true, syncMinutes: 5, notices: "notice", autoShare: "off", shareMinutes: 10 });
  const pcfg = { project: "web", autoShare: "end", syncMinutes: 3 };
  assert.equal(autoSettings(pcfg, {}).autoShare, "end");
  assert.equal(autoSettings(pcfg, { autoShare: "off" }).autoShare, "off");
  assert.equal(autoSettings(pcfg, { autoShare: "off", projects: { web: { autoShare: "live" } } }).autoShare, "live");
  assert.equal(autoSettings(pcfg, { projects: { other: { autoShare: "live" } } }).autoShare, "end");
  assert.equal(autoSettings(pcfg, {}).syncMinutes, 3);
  assert.equal(autoSettings({ project: "web", notices: "loud", syncMinutes: -2, autoSync: false }, {}).notices, "notice");
  assert.equal(autoSettings({ project: "web", syncMinutes: 0.2 }, {}).syncMinutes, 1);
  assert.equal(autoSettings({ project: "web", autoSync: false }, {}).autoSync, false);
});

test("what teammates added: new sessions and notes, never your own, never updates", () => {
  const prev = { sessions: { a: { authorSlug: "alice" } }, notes: { alice: 1 } };
  const next = { sessions: { a: { authorSlug: "alice" }, b: { author: "Bob", authorSlug: "bob", title: "API v2" }, c: { authorSlug: "me" } }, notes: { alice: 3, me: 2 } };
  const notesNow = [
    { when: "2026-10-03 10:05", who: "Alice", text: "third" },
    { when: "2026-10-03 10:04", who: "me", text: "mine" },
    { when: "2026-10-03 10:03", who: "Alice", text: "second" },
    { when: "2026-10-03 10:01", who: "Alice", text: "first" },
  ];
  const items = diffSnapshots(prev, next, notesNow, "me");
  assert.deepEqual(items.map((i) => i.kind === "session" ? i.id : i.text), ["b", "second", "third"]);
  assert.deepEqual(diffSnapshots(null, next, notesNow, "me"), [], "the first sync is a baseline");
});

function setup() {
  const base = tmp("ct-auto-");
  const genv = isolatedGitEnv(base);
  const origin = path.join(base, "remotes", "webapp.git");
  sh("git", ["init", "-q", "--bare", "--initial-branch=main", origin], { env: genv });
  const alice = person(base, "Alice");
  const bob = person(base, "Bob");
  const aRoot = path.join(base, "alice-code", "webapp");
  gitc(["clone", "-q", origin, aRoot], { env: genv });
  fs.writeFileSync(path.join(aRoot, "README.md"), "# webapp\n");
  gitc(["add", "."], { cwd: aRoot, env: genv });
  gitc(["commit", "-q", "-m", "first"], { cwd: aRoot, env: genv });
  const init = runCli(["init", "--hub", "branch", "--yes"], { cwd: aRoot, env: alice.env });
  assert.equal(init.code, 0, init.all);
  gitc(["add", "."], { cwd: aRoot, env: genv });
  gitc(["commit", "-q", "-m", "team hub"], { cwd: aRoot, env: genv });
  gitc(["push", "-q", "origin", "HEAD:main"], { cwd: aRoot, env: genv });
  const bRoot = path.join(base, "bob-code", "webapp");
  gitc(["clone", "-q", origin, bRoot], { env: genv });
  const cli = (root) => path.join(root, ".claude", "team-sync", "claude-team.mjs");
  const hook = (who, root, event, input = {}, extra = {}) =>
    runCli(["hook", event], { cwd: root, env: { ...who.env, CLAUDE_TEAM_SYNC_MINUTES: "0", CLAUDE_TEAM_SHARE_MINUTES: "0", ...extra }, input: JSON.stringify({ cwd: root, ...input }), cli: cli(root) });
  const run = (who, root, args, input, extra = {}) => runCli(args, { cwd: root, env: { ...who.env, ...extra }, input, cli: cli(root) });
  const hubFiles = () => sh("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", "claude-team-hub"], { env: genv });
  return { base, genv, origin, alice, bob, aRoot, bRoot, hook, run, hubFiles };
}

test("automatic sync end to end", async (t) => {
  const w = setup();
  const { alice, bob, aRoot, bRoot, hook, run, hubFiles } = w;

  await t.test("init installs the four hooks", () => {
    const settings = JSON.parse(fs.readFileSync(path.join(aRoot, ".claude", "settings.json"), "utf8"));
    for (const [event, name] of [["SessionStart", "session-start"], ["UserPromptSubmit", "prompt"], ["Stop", "stop"], ["SessionEnd", "session-end"]]) {
      assert.deepEqual(settings.hooks[event][0].hooks[0].args.slice(1), ["hook", name], event);
    }
    assert.ok(fs.existsSync(path.join(aRoot, ".claude", "skills", "team-auto", "SKILL.md")));
  });

  await t.test("a teammate's share and note arrive mid-session as one notice, once", () => {
    const start = hook(bob, bRoot, "session-start", { session_id: "bob-s1", source: "startup" });
    assert.equal(start.code, 0, start.all);
    // Nothing new yet.
    assert.equal(hook(bob, bRoot, "prompt", { session_id: "bob-s1", prompt: "hi" }).out, "");
    // Alice shares and notes while Bob works.
    const s = writeFakeSession({ claude: alice.claude, root: aRoot, home: alice.home, title: "Fix login redirect loop" });
    assert.equal(run(alice, aRoot, ["share", s.id]).code, 0);
    assert.equal(run(alice, aRoot, ["note", "staging is frozen until Monday"]).code, 0);
    const p = hook(bob, bRoot, "prompt", { session_id: "bob-s1", prompt: "next" });
    assert.equal(p.code, 0, p.all);
    const out = JSON.parse(p.out);
    assert.match(out.systemMessage, /^Team: Alice shared "Fix login redirect loop" \(\/team-load [0-9a-f]{8}\) · Alice: staging is frozen until Monday$/);
    assert.equal(out.hookSpecificOutput, undefined, "notice mode costs no tokens");
    assert.equal(hook(bob, bRoot, "prompt", { session_id: "bob-s1", prompt: "again" }).out, "", "said once");
  });

  await t.test("notices can also tell Claude, or stay quiet", () => {
    assert.equal(run(bob, bRoot, ["auto", "notices", "context"]).code, 0);
    run(alice, aRoot, ["note", "API v2 is live"]);
    const p = JSON.parse(hook(bob, bRoot, "prompt", { session_id: "bob-s1" }).out);
    assert.equal(p.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(p.hookSpecificOutput.additionalContext, /Alice: API v2 is live/);
    run(bob, bRoot, ["auto", "notices", "off"]);
    run(alice, aRoot, ["note", "one more"]);
    assert.equal(hook(bob, bRoot, "prompt", { session_id: "bob-s1" }).out, "");
    run(bob, bRoot, ["auto", "notices", "notice"]);
  });

  await t.test("edits to TEAM.md in the hub are pushed without a sync command", () => {
    const st = run(alice, aRoot, ["context", "--path"]);
    const teamFile = st.out.trim();
    fs.appendFileSync(teamFile, "- 2026-10-03 we review every PR within a day\n");
    hook(alice, aRoot, "prompt", { session_id: "alice-s1" });
    const shown = run(bob, bRoot, ["context"]);
    assert.match(shown.out, /we review every PR within a day/);
  });

  await t.test("live sharing keeps your session up to date after turns, at most every few minutes", () => {
    assert.match(run(alice, aRoot, ["auto", "live"]).out, /Sharing: +your sessions update in the hub every 10 min/);
    const s = writeFakeSession({ claude: alice.claude, root: aRoot, home: alice.home, title: "Live pairing on payments" });
    hook(alice, aRoot, "stop", { session_id: s.id });
    assert.match(hubFiles(), new RegExp(`_alice_${s.id.slice(0, 8)}/meta\\.json`));
    // Inside the interval nothing is shared again.
    const before = sh("git", ["--git-dir", w.origin, "rev-list", "--count", "claude-team-hub"], { env: w.genv });
    hook(alice, aRoot, "stop", { session_id: s.id }, { CLAUDE_TEAM_SHARE_MINUTES: "10" });
    assert.equal(sh("git", ["--git-dir", w.origin, "rev-list", "--count", "claude-team-hub"], { env: w.genv }), before);
    // Bob hears about it on his next prompt.
    assert.match(JSON.parse(hook(bob, bRoot, "prompt", { session_id: "bob-s1" }).out).systemMessage, /Alice shared "Live pairing on payments"/);
  });

  await t.test("a written brief survives automatic updates", () => {
    const s = writeFakeSession({ claude: alice.claude, root: aRoot, home: alice.home, title: "Checkout bug" });
    assert.equal(run(alice, aRoot, ["share", s.id, "--brief", "-"], "## Goal\nFix checkout.\n\n**Next step**: add the regression test\n").code, 0);
    hook(alice, aRoot, "stop", { session_id: s.id });
    const show = run(bob, bRoot, ["show", s.id.slice(0, 8)]);
    assert.match(show.out, /Fix checkout\./);
    assert.doesNotMatch(show.out, /Written automatically/);
  });

  await t.test("sharing at session end, and skipping a private session", () => {
    assert.equal(run(bob, bRoot, ["auto", "end"]).code, 0);
    const kept = writeFakeSession({ claude: bob.claude, root: bRoot, home: bob.home, title: "Private experiment" });
    assert.match(run(bob, bRoot, ["auto", "skip", "--session", kept.id]).out, /will not be shared automatically/);
    hook(bob, bRoot, "session-end", { session_id: kept.id, reason: "prompt_input_exit" });
    assert.doesNotMatch(hubFiles(), new RegExp(kept.id.slice(0, 8)));
    const done = writeFakeSession({ claude: bob.claude, root: bRoot, home: bob.home, title: "Rate limiter" });
    hook(bob, bRoot, "session-end", { session_id: done.id, reason: "prompt_input_exit" });
    assert.match(hubFiles(), new RegExp(`_bob_${done.id.slice(0, 8)}/brief\\.md`));
    const meta = JSON.parse(sh("git", ["--git-dir", w.origin, "show", `claude-team-hub:${hubFiles().split("\n").find((f) => f.includes(`_bob_${done.id.slice(0, 8)}/meta.json`))}`], { env: w.genv }));
    assert.equal(meta.auto, true);
  });

  await t.test("watch prints what is new", () => {
    run(alice, aRoot, ["note", "release is on Friday"]);
    const r = run(bob, bRoot, ["watch", "--once"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Alice: release is on Friday/);
  });

  await t.test("auto status explains every setting", () => {
    const r = run(bob, bRoot, ["auto"]);
    assert.match(r.out, /Sync: +on, every 5 min while you work \(last (just now|.+ago)\)/);
    assert.match(r.out, /Notices: +one line for you, no tokens/);
    assert.match(r.out, /Sharing: +each session is shared when it ends/);
  });

  await t.test("the background sync really runs as a detached process", async () => {
    run(alice, aRoot, ["note", "from the background"]);
    const env = { CLAUDE_TEAM_SYNC_INLINE: "" };
    const stateDir = path.join(bob.claude, "team-sync", "state");
    const stateFile = fs.readdirSync(stateDir).find((f) => f.endsWith("--webapp.json"));
    const before = JSON.parse(fs.readFileSync(path.join(stateDir, stateFile), "utf8")).lastSyncEnd;
    const started = Date.now();
    const p = hook(bob, bRoot, "prompt", { session_id: "bob-s2" }, env);
    assert.equal(p.code, 0);
    assert.ok(Date.now() - started < 5000, "the hook returns without waiting for git");
    let after = before;
    for (let i = 0; i < 60 && after === before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      after = JSON.parse(fs.readFileSync(path.join(stateDir, stateFile), "utf8")).lastSyncEnd;
    }
    assert.notEqual(after, before, "the detached sync finished");
    const news = JSON.parse(hook(bob, bRoot, "prompt", { session_id: "bob-s1" }, { ...env, CLAUDE_TEAM_SYNC_MINUTES: "60" }).out);
    assert.match(news.systemMessage, /Alice: from the background/);
  });
});

test("init --no-auto keeps only the session-start hook", () => {
  const base = tmp("ct-noauto-");
  const carol = person(base, "Carol");
  const root = path.join(base, "carol", "docs");
  fs.mkdirSync(root, { recursive: true });
  const r = runCli(["init", "--hub", path.join(base, "shared"), "--yes", "--no-auto"], { cwd: root, env: carol.env });
  assert.equal(r.code, 0, r.all);
  const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(Object.keys(settings.hooks), ["SessionStart"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".claude", "team-sync.json"), "utf8")).autoSync, false);
});
