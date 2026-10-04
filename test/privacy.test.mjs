// What must never reach a hub, and settings that must never be lost: the session title, tool inputs
// named like secrets, a settings.json that is not valid JSON, and a session the person kept private.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, person, runCli, writeFakeSession, readTree, SECRETS } from "./helpers.mjs";
import { makeRedactor, parseArgs } from "../claude-team.mjs";

function project(prefix) {
  const base = tmp(prefix);
  const me = person(base, "Ana");
  const root = path.join(base, "ana", "app");
  fs.mkdirSync(root, { recursive: true });
  const hub = path.join(base, "hub");
  return { base, me, root, hub };
}

test("a shared session's title and tool inputs named like secrets are redacted", () => {
  const { me, root, hub } = project("ct-priv-");
  let r = runCli(["init", "--hub", hub, "--yes", "--project", "app"], { cwd: root, env: me.env });
  assert.equal(r.code, 0, r.all);
  // No title record, so the title is made from the first prompt, which starts with a key; and a
  // tool call carries a field named password.
  const s = writeFakeSession({ claude: me.claude, root, home: me.home, title: "" });
  const recs = fs.readFileSync(s.file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const first = recs.find((x) => x.type === "user" && typeof x.message?.content === "string");
  first.message.content = `Deploy with ${SECRETS.anthropic} please`;
  const bash = recs.find((x) => x.type === "assistant" && x.message?.content?.[0]?.name === "Bash");
  bash.message.content[0].input.password = "hunter2hunter2";
  fs.writeFileSync(s.file, `${recs.map((x) => JSON.stringify(x)).join("\n")}\n`);

  r = runCli(["share", "--last"], { cwd: root, env: me.env });
  assert.equal(r.code, 0, r.all);
  const published = readTree(path.join(hub, "projects"));
  assert.equal(published.includes(SECRETS.anthropic), false, "the key in the first prompt, which became the title");
  assert.equal(published.includes("hunter2hunter2"), false, "a tool input named password");
  assert.match(published, /REDACTED:anthropic-key/);
  assert.match(published, /REDACTED:named-secret/);
});

test("init leaves a settings.json that is not valid JSON exactly as it was", () => {
  const { me, root, hub } = project("ct-inv-");
  const file = path.join(root, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bad = '{\n  // my notes\n  "permissions": { "allow": ["Bash(ls)"], },\n}\n';
  fs.writeFileSync(file, bad);
  const r = runCli(["init", "--hub", hub, "--yes"], { cwd: root, env: me.env });
  assert.equal(r.code, 0, r.all);
  assert.equal(fs.readFileSync(file, "utf8"), bad);
  assert.match(r.all, /not valid JSON, so it was left alone/);
});

test("auto skip takes the short id that `sessions` prints, and that session is never shared automatically", () => {
  const { me, root, hub } = project("ct-skip-");
  let r = runCli(["init", "--hub", hub, "--yes", "--project", "app"], { cwd: root, env: me.env });
  assert.equal(r.code, 0, r.all);
  const s = writeFakeSession({ claude: me.claude, root, home: me.home, title: "Private work" });
  r = runCli(["auto", "end"], { cwd: root, env: me.env });
  assert.equal(r.code, 0, r.all);
  r = runCli(["auto", "skip", "--session", s.id.slice(0, 8)], { cwd: root, env: me.env });
  assert.equal(r.code, 0, r.all);
  r = runCli(["hook", "session-end"], { cwd: root, env: me.env, input: JSON.stringify({ session_id: s.id, transcript_path: s.file, cwd: root, hook_event_name: "SessionEnd" }) });
  assert.equal(r.code, 0, r.all);
  const sessions = path.join(hub, "projects", "app", "sessions");
  assert.deepEqual(fs.existsSync(sessions) ? fs.readdirSync(sessions) : [], [], "the skipped session was not shared");

  r = runCli(["auto", "skip", "--session", "zzzzzzzz"], { cwd: root, env: me.env });
  assert.equal(r.code, 1);
  assert.match(r.all, /No session on this machine starts with "zzzzzzzz"/);
});

test("an option that does not exist is an error, with or without a value after it", () => {
  assert.throws(() => parseArgs(["--since", "7d"]), /--since is not an option of claude-team/);
  assert.throws(() => parseArgs(["--LIMIT", "3"]), /--LIMIT is not an option/);
  assert.deepEqual(parseArgs(["--limit", "3", "--yes"]), { _: [], limit: "3", yes: true });
});

test("a key named token, and a URL password with no user name, are redacted", () => {
  const redact = makeRedactor();
  assert.equal(redact('token: "abcdef123456"'), 'token: "[REDACTED:assigned-secret]"');
  assert.equal(redact("redis://:s3cretpw@cache:6379/0"), "redis://:[REDACTED:url-password]@cache:6379/0");
  assert.equal(redact("http://example.com:8080/path"), "http://example.com:8080/path", "a port is not a password");
});
