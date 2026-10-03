// End to end: two people, their own Claude config folders, one project, three kinds of hub.
// Each command runs as a separate process, as it would from a terminal or a hook.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, person, gitc, sh, runCli, writeFakeSession, readTree, SECRETS, isolatedGitEnv } from "./helpers.mjs";

const VENDORED = (root) => path.join(root, ".claude", "team-sync", "claude-team.mjs");

function newProject(base) {
  const env = isolatedGitEnv(base);
  const origin = path.join(base, "remotes", "webapp.git");
  sh("git", ["init", "-q", "--bare", "--initial-branch=main", origin], { env });
  return { origin, env };
}
function cloneProject(origin, dir, env) {
  gitc(["clone", "-q", origin, dir], { env });
  return dir;
}

test("branch hub: share, digest, load, resume and notes between two people", async (t) => {
  const base = tmp("ct-e2e-");
  const { origin, env: genv } = newProject(base);
  const alice = person(base, "Alice");
  const bob = person(base, "Bob");

  // Alice's checkout with a first commit.
  const aRoot = cloneProject(origin, path.join(base, "alice-code", "webapp"), genv);
  fs.writeFileSync(path.join(aRoot, "README.md"), "# webapp\n");
  gitc(["add", "."], { cwd: aRoot, env: genv });
  gitc(["commit", "-q", "-m", "first"], { cwd: aRoot, env: genv });
  gitc(["push", "-q", "origin", "HEAD:main"], { cwd: aRoot, env: genv });

  await t.test("init writes the project files and creates the hub branch", () => {
    const r = runCli(["init", "--hub", "branch", "--yes"], { cwd: aRoot, env: alice.env });
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Team hub set up for webapp/);
    for (const f of [".claude/team-sync.json", ".claude/team-sync/claude-team.mjs", ".claude/team-sync/README.md", ".claude/settings.json",
      ".claude/skills/team/SKILL.md", ".claude/skills/team-share/SKILL.md", ".claude/skills/team-load/SKILL.md", ".claude/skills/team-note/SKILL.md"]) {
      assert.ok(fs.existsSync(path.join(aRoot, f)), `missing ${f}`);
    }
    const cfg = JSON.parse(fs.readFileSync(path.join(aRoot, ".claude/team-sync.json"), "utf8"));
    assert.deepEqual(cfg, { version: 1, project: "webapp", hub: { type: "branch", branch: "claude-team-hub" } });
    const settings = JSON.parse(fs.readFileSync(path.join(aRoot, ".claude/settings.json"), "utf8"));
    assert.equal(settings.hooks.SessionStart[0].hooks[0].args[1], "hook");
    const heads = sh("git", ["ls-remote", "--heads", origin], { env: genv });
    assert.match(heads, /refs\/heads\/claude-team-hub/);
    const files = sh("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", "claude-team-hub"], { env: genv });
    assert.match(files, /README\.md/);
    assert.match(files, /projects\/webapp\/TEAM\.md/);
    // Alice commits the project files so teammates get them.
    gitc(["add", ".claude"], { cwd: aRoot, env: genv });
    gitc(["commit", "-q", "-m", "team hub"], { cwd: aRoot, env: genv });
    gitc(["push", "-q", "origin", "HEAD:main"], { cwd: aRoot, env: genv });
  });

  const s = writeFakeSession({ claude: alice.claude, root: aRoot, home: alice.home });

  await t.test("sessions lists Alice's local session", () => {
    const r = runCli(["sessions"], { cwd: aRoot, env: alice.env });
    assert.equal(r.code, 0, r.all);
    assert.ok(r.out.includes(s.id.slice(0, 8)));
    assert.match(r.out, /Fix login redirect loop/);
  });

  await t.test("a dry run writes a preview and shares nothing", () => {
    const r = runCli(["share", s.id, "--dry-run"], { cwd: aRoot, env: alice.env });
    assert.equal(r.code, 0, r.all);
    assert.ok(fs.existsSync(path.join(alice.claude, "team-sync", "preview", s.id, "transcript.md")));
    const files = sh("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", "claude-team-hub"], { env: genv });
    assert.ok(!files.includes("sessions/"));
  });

  await t.test("share publishes a redacted package with a brief from stdin", () => {
    const brief = "## Goal\nStop the redirect loop.\n\n**Next step**: add a test for /callback\n\nToken in .env was ghp_" + "z".repeat(36) + "\n";
    const r = runCli(["share", s.id.slice(0, 8), "--title", "Fix login redirect loop", "--brief", "-"], { cwd: aRoot, env: alice.env, input: brief });
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Shared "Fix login redirect loop"/);
    assert.match(r.out, /Redacted: .*anthropic-key/);
    const files = sh("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", "claude-team-hub"], { env: genv });
    for (const f of ["meta.json", "brief.md", "transcript.md", "session.jsonl.gz", "tool-results/build-1.txt"]) assert.match(files, new RegExp(`projects/webapp/sessions/[^/]+_alice_${s.id.slice(0, 8)}/${f.replace(".", "\\.")}`));
    // Nothing secret or private anywhere in what was published.
    const check = path.join(base, "check");
    gitc(["clone", "-q", "--branch", "claude-team-hub", origin, check], { env: genv });
    const all = readTree(check);
    for (const secret of [...Object.values(SECRETS), "ghp_" + "z".repeat(36), "acct-1111-2222", "org-3333-4444", alice.home]) assert.ok(!all.includes(secret), `published ${secret}`);
    assert.ok(!all.includes(JSON.stringify(alice.home).slice(1, -1)), "published Alice's home path");
    const meta = JSON.parse(fs.readFileSync(fs.readdirSync(path.join(check, "projects/webapp/sessions")).map((d) => path.join(check, "projects/webapp/sessions", d, "meta.json"))[0], "utf8"));
    assert.equal(meta.next, "add a test for /callback");
    assert.equal(meta.author, "Alice");
    assert.deepEqual(meta.files, ["src/auth.ts"]);
  });

  const bRoot = cloneProject(origin, path.join(base, "bob-code", "webapp"), genv);

  await t.test("Bob's first session start shows the digest without any setup", () => {
    const input = JSON.stringify({ session_id: "bob-1", cwd: bRoot, hook_event_name: "SessionStart", source: "startup" });
    const r = runCli(["hook", "session-start"], { cwd: bRoot, env: bob.env, input, cli: VENDORED(bRoot) });
    assert.equal(r.code, 0, r.all);
    const out = JSON.parse(r.out);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(ctx, /Recently shared sessions/);
    assert.ok(ctx.includes(s.id.slice(0, 8)) && ctx.includes("Alice") && ctx.includes("Fix login redirect loop"));
    assert.match(ctx, /next: add a test for \/callback/);
    assert.ok(ctx.length <= 3000);
  });

  await t.test("resume and compact sources add nothing", () => {
    for (const source of ["resume", "compact"]) {
      const r = runCli(["hook", "session-start"], { cwd: bRoot, env: bob.env, input: JSON.stringify({ cwd: bRoot, source }), cli: VENDORED(bRoot) });
      assert.equal(r.code, 0);
      assert.equal(r.out, "");
    }
  });

  await t.test("Bob lists, searches and loads the shared session", () => {
    const list = runCli(["list"], { cwd: bRoot, env: bob.env, cli: VENDORED(bRoot) });
    assert.equal(list.code, 0, list.all);
    assert.match(list.out, /Fix login redirect loop/);
    const search = runCli(["search", "redirect", "loop"], { cwd: bRoot, env: bob.env, cli: VENDORED(bRoot) });
    assert.match(search.out, new RegExp(s.id.slice(0, 8)));
    const show = runCli(["show", "--for-context", "redirect loop"], { cwd: bRoot, env: bob.env, cli: VENDORED(bRoot) });
    assert.equal(show.code, 0, show.all);
    assert.match(show.out, /^<team-session id="/);
    assert.match(show.out, /## Brief[\s\S]*Stop the redirect loop[\s\S]*## Conversation \(condensed\)/);
    assert.match(show.out, /Read `src\/auth\.ts`/);
    assert.ok(!show.out.includes("{{"));
    const none = runCli(["show", "--for-context", "nothing like this"], { cwd: bRoot, env: bob.env, cli: VENDORED(bRoot) });
    assert.equal(none.code, 0);
    assert.match(none.out, /No single shared session matched/);
  });

  await t.test("resume rebuilds the transcript with Bob's paths for claude --resume", () => {
    const r = runCli(["resume", s.id.slice(0, 8)], { cwd: bRoot, env: bob.env, cli: VENDORED(bRoot) });
    assert.equal(r.code, 0, r.all);
    const file = path.join(bob.claude, "team-sync", "imports", `${s.id}.jsonl`);
    assert.ok(r.out.includes(`claude --resume "${file}" --fork-session`), r.out);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!text.includes("{{"), "a placeholder survived");
    assert.ok(!text.includes(JSON.stringify(aRoot).slice(1, -1)) && !text.includes(JSON.stringify(alice.home).slice(1, -1)), "Alice's paths survived");
    const recs = text.trim().split("\n").map((l) => JSON.parse(l));
    for (const rec of recs) if (rec.cwd) assert.equal(rec.cwd, bRoot);
    assert.ok(recs.some((rec) => JSON.stringify(rec).includes(JSON.stringify(path.join(bRoot, "src", "auth.ts")).slice(1, -1))));
    const tr = fs.readFileSync(path.join(bob.claude, "team-sync", "imports", s.id, "tool-results", "build-1.txt"), "utf8");
    assert.ok(tr.includes(path.join(bRoot, "dist", "app.js")) && !tr.includes(SECRETS.aws));
    // Every record still parses and the conversation chain is whole.
    const uuids = new Set(recs.filter((x) => x.uuid).map((x) => x.uuid));
    for (const rec of recs) if (rec.parentUuid) assert.ok(uuids.has(rec.parentUuid));
  });

  await t.test("notes from both people arrive, quotes and all", () => {
    let r = runCli(["note", "we use pnpm, not npm"], { cwd: aRoot, env: alice.env });
    assert.equal(r.code, 0, r.all);
    r = runCli(["note", "--stdin"], { cwd: bRoot, env: bob.env, input: `API v2 is live; don't call "v1" & stop`, cli: VENDORED(bRoot) });
    assert.equal(r.code, 0, r.all);
    r = runCli(["notes"], { cwd: aRoot, env: alice.env });
    assert.match(r.out, /Alice {2}we use pnpm, not npm/);
    assert.match(r.out, /Bob {2}API v2 is live; don't call "v1" & stop/);
  });

  await t.test("Alice's next session start announces what is new", () => {
    // Alice has not run the hook before, so seed her last visit, then run it again.
    runCli(["hook", "session-start"], { cwd: aRoot, env: alice.env, input: JSON.stringify({ cwd: aRoot, source: "startup" }) });
    runCli(["note", "--stdin"], { cwd: bRoot, env: bob.env, input: "staging deploy is frozen until Monday", cli: VENDORED(bRoot) });
    const r = runCli(["hook", "session-start"], { cwd: aRoot, env: alice.env, input: JSON.stringify({ cwd: aRoot, source: "clear" }) });
    const out = JSON.parse(r.out);
    assert.match(out.systemMessage, /1 new note/);
    assert.match(out.hookSpecificOutput.additionalContext, /staging deploy is frozen/);
  });

  await t.test("re-sharing the same session updates it in place", () => {
    const r = runCli(["share", s.id, "--title", "Fix login redirect loop (done)"], { cwd: aRoot, env: alice.env });
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Updated/);
    const list = runCli(["list"], { cwd: bRoot, env: bob.env, cli: VENDORED(bRoot) });
    assert.equal((list.out.match(new RegExp(s.id.slice(0, 8), "g")) || []).length, 1);
    assert.match(list.out, /\(done\)/);
  });

  await t.test("status reports a healthy setup", () => {
    const r = runCli(["status"], { cwd: bRoot, env: bob.env, cli: VENDORED(bRoot) });
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Synced: +yes/);
    assert.match(r.out, /session-start digest on/);
    assert.match(r.out, /\/team \/team-share \/team-load \/team-note/);
  });
});

test("folder hub: works without git, through any synced folder", () => {
  const base = tmp("ct-folder-");
  const shared = path.join(base, "OneDrive - Acme", "Claude Hub");
  const carol = person(base, "Carol");
  const dave = person(base, "Dave");
  const cRoot = path.join(base, "carol", "reports");
  fs.mkdirSync(cRoot, { recursive: true });
  let r = runCli(["init", "--hub", shared, "--yes", "--project", "Quarterly Reports"], { cwd: cRoot, env: carol.env });
  assert.equal(r.code, 0, r.all);
  const cfg = JSON.parse(fs.readFileSync(path.join(cRoot, ".claude/team-sync.json"), "utf8"));
  assert.deepEqual(cfg, { version: 1, project: "quarterly-reports", hub: { type: "folder", label: "Claude Hub" } });
  assert.ok(fs.existsSync(path.join(shared, "README.md")) && fs.existsSync(path.join(shared, "projects/quarterly-reports/TEAM.md")));

  const s = writeFakeSession({ claude: carol.claude, root: cRoot, home: carol.home, title: "Q3 revenue summary" });
  r = runCli(["share", "--last"], { cwd: cRoot, env: carol.env });
  assert.equal(r.code, 0, r.all);
  assert.ok(fs.readdirSync(path.join(shared, "projects/quarterly-reports/sessions"))[0].endsWith(`_carol_${s.id.slice(0, 8)}`));

  // Dave has a copy of the project folder; his synced folder sits somewhere else on his machine.
  const dRoot = path.join(base, "dave", "reports");
  fs.cpSync(cRoot, dRoot, { recursive: true });
  r = runCli(["hook", "session-start"], { cwd: dRoot, env: dave.env, input: JSON.stringify({ cwd: dRoot, source: "startup" }) });
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).systemMessage, /join --folder/);
  r = runCli(["join", "--folder", shared], { cwd: dRoot, env: dave.env });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /Dave is connected .* 1 shared session,/);
  r = runCli(["show", "Q3"], { cwd: dRoot, env: dave.env });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /Q3 revenue summary/);
  assert.match(r.out, /Written automatically by claude-team/);
});

test("separate git hub: an empty bare repository becomes the hub", () => {
  const base = tmp("ct-gitrepo-");
  const genv = isolatedGitEnv(base);
  const hubRepo = path.join(base, "claude-hub.git");
  sh("git", ["init", "-q", "--bare", "--initial-branch=main", hubRepo], { env: genv });
  const erin = person(base, "Erin");
  const root = path.join(base, "erin", "api");
  fs.mkdirSync(root, { recursive: true });
  gitc(["init", "-q"], { cwd: root, env: genv });
  const r = runCli(["init", "--hub", hubRepo, "--yes"], { cwd: root, env: erin.env });
  assert.equal(r.code, 0, r.all);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, ".claude/team-sync.json"), "utf8"));
  assert.equal(cfg.hub.type, "git");
  assert.equal(cfg.hub.branch, "main");
  const files = sh("git", ["--git-dir", hubRepo, "ls-tree", "-r", "--name-only", "main"], { env: genv });
  assert.match(files, /projects\/api\/TEAM\.md/);
});

test("the hook stays quiet and quick when the hub cannot be reached", () => {
  const base = tmp("ct-offline-");
  const genv = isolatedGitEnv(base);
  const fay = person(base, "Fay");
  const root = path.join(base, "fay", "svc");
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  gitc(["init", "-q"], { cwd: root, env: genv });
  gitc(["remote", "add", "origin", path.join(base, "does-not-exist.git")], { cwd: root, env: genv });
  fs.writeFileSync(path.join(root, ".claude/team-sync.json"), JSON.stringify({ version: 1, project: "svc", hub: { type: "branch" } }));
  const started = Date.now();
  const r = runCli(["hook", "session-start"], { cwd: root, env: fay.env, input: JSON.stringify({ cwd: root, source: "startup" }) });
  assert.equal(r.code, 0, r.all);
  assert.ok(Date.now() - started < 20000);
  if (r.out) assert.doesNotThrow(() => JSON.parse(r.out));
  const bad = runCli(["hook", "session-start"], { cwd: root, env: fay.env, input: "not json" });
  assert.equal(bad.code, 0);
});

test("commands outside a set-up project explain what to do", () => {
  const base = tmp("ct-none-");
  const gus = person(base, "Gus");
  const r = runCli(["list"], { cwd: base, env: gus.env });
  assert.equal(r.code, 1);
  assert.match(r.err, /No team hub is set up/);
  assert.match(r.err, /npx -y github:nrzz\/claude-code-team-sync init/);
});
