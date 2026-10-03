// Shared fixtures: throwaway people, git remotes and synthetic Claude Code transcripts.
// Everything lives under the OS temp folder; nothing touches the real ~/.claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { projectSlug } from "../claude-team.mjs";

export const CLI = fileURLToPath(new URL("../claude-team.mjs", import.meta.url));

export function tmp(prefix = "ct-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// git isolated from the machine's own global and system config (credential helpers, hooks,
// autocrlf, signing), so the tests behave the same everywhere.
export function isolatedGitEnv(base) {
  const globalCfg = path.join(base, "gitconfig-empty");
  if (!fs.existsSync(globalCfg)) fs.writeFileSync(globalCfg, "");
  return { GIT_CONFIG_GLOBAL: globalCfg, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
}

export function person(base, name) {
  const home = path.join(base, `${name.toLowerCase()}-home`);
  const claude = path.join(home, ".claude");
  fs.mkdirSync(claude, { recursive: true });
  const env = { ...isolatedGitEnv(base), HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claude, CLAUDE_TEAM_NAME: name, NO_COLOR: "1" };
  delete env.CLAUDE_CODE_SESSION_ID;
  return { name, home, claude, env };
}

export function sh(cmd, args, { cwd, env = {} } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
export const gitc = (args, opts = {}) => sh("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], opts);

export function runCli(args, { cwd, env = {}, input, cli = CLI } = {}) {
  const fullEnv = { ...process.env, ...env };
  delete fullEnv.CLAUDE_CODE_SESSION_ID; // the tests may run inside a Claude Code session
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env: fullEnv, input, encoding: "utf8", windowsHide: true, timeout: 120000 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}

export const SECRETS = {
  anthropic: `sk-ant-api03-${"A1b2C3d4".repeat(6)}`,
  dbPassword: "hunter2secret",
  github: `ghp_${"c".repeat(36)}`,
  githubThinking: `ghp_${"b".repeat(36)}`,
  aws: "AKIAIOSFODNN7EXAMPLE",
};

// A transcript shaped like Claude Code 2.1.x writes them, with every kind of thing a share must
// remove or rewrite: secrets, account ids, thinking, an image, a tool-results file, absolute paths.
export function writeFakeSession({ claude, root, home, id = randomUUID(), title = "Fix login redirect loop" }) {
  const dir = path.join(claude, "projects", projectSlug(root));
  const trDir = path.join(dir, id, "tool-results");
  fs.mkdirSync(trDir, { recursive: true });
  const trFile = path.join(trDir, "build-1.txt");
  fs.writeFileSync(trFile, `build log\naws ${SECRETS.aws} used\noutput at ${path.join(root, "dist", "app.js")}\n`);

  const t0 = Date.parse("2026-10-01T09:00:00Z");
  let n = 0;
  const ts = () => new Date(t0 + n++ * 30000).toISOString();
  const base = { isSidechain: false, userType: "external", entrypoint: "cli", cwd: root, sessionId: id, version: "2.1.286", gitBranch: "fix/login" };
  const recs = [];
  let parent = null;
  const chain = (r) => { const rec = { parentUuid: parent, ...base, uuid: randomUUID(), timestamp: ts(), ...r }; recs.push(rec); parent = rec.uuid; return rec; };
  const side = (r) => { recs.push(r); return r; };
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const assistant = (id2, content, stop = null) => ({ type: "assistant", requestId: `req_${id2}`, message: { id: `msg_${id2}`, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage } });
  const authFile = path.join(root, "src", "auth.ts");

  side({ type: "queue-operation", operation: "enqueue", timestamp: ts(), sessionId: id, content: "Fix the login redirect loop" });
  chain({ type: "user", permissionMode: "default", message: { role: "user", content: `Fix the login redirect loop in ${authFile}. Staging key ${SECRETS.anthropic} and db postgres://app:${SECRETS.dbPassword}@db.internal:5432/app` } });
  side({ type: "bridge-session", sessionId: id, bridgeSessionId: "bridge-1", lastSequenceNum: 3, ownerAccountUuid: "acct-1111-2222", ownerOrganizationUuid: "org-3333-4444" });
  chain({ type: "attachment", attachment: { type: "hook_additional_context", content: ["context from a hook"] } });
  chain({ ...assistant("01", [{ type: "thinking", thinking: `the token ${SECRETS.githubThinking} is in the env`, signature: "SIG123" }]), quotaLimits: { status: "allowed", rateLimitType: "five_hour" } });
  const read = chain(assistant("01", [{ type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: authFile } }], "tool_use"));
  chain({ type: "user", sourceToolAssistantUUID: read.uuid, toolUseResult: { type: "text", file: { filePath: authFile, content: `export const GITHUB_TOKEN = "${SECRETS.github}";` } }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: `export const GITHUB_TOKEN = "${SECRETS.github}";\nredirect(callbackUrl)` }] } });
  const edit = chain(assistant("02", [{ type: "tool_use", id: "toolu_02", name: "Edit", input: { file_path: authFile, old_string: "redirect(callbackUrl)", new_string: "redirect(safe(callbackUrl))" } }], "tool_use"));
  chain({ type: "user", sourceToolAssistantUUID: edit.uuid, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_02", content: `The file ${authFile} has been updated. Full build output saved to ${trFile}` }] } });
  const bash = chain(assistant("03", [{ type: "tool_use", id: "toolu_03", name: "Bash", input: { command: `grep -rn "a\\|b" ${path.join(root, "src")}`, description: "search" } }], "tool_use"));
  chain({ type: "user", sourceToolAssistantUUID: bash.uuid, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_03", content: "src/auth.ts:3: a", is_error: false }] } });
  chain({ type: "user", message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo" + "A".repeat(200) } }, { type: "text", text: "Here is the screenshot of the loop" }] } });
  chain(assistant("04", [{ type: "text", text: `Fixed: the callback is validated now. The route regex is ^/app\\/[a-z]+$ and my notes are in ${path.join(home, "notes.txt")}. Next: add a test for /callback.` }], "end_turn"));
  side({ type: "custom-title", customTitle: title, sessionId: id });
  side({ type: "last-prompt", lastPrompt: "Here is the screenshot", leafUuid: parent, sessionId: id });
  side({ type: "history-suppression", sessionId: id, cause: "restored_owner_mismatch", ts: Date.now(), vetoedAgainstAccountUuid: "acct-9999" });
  side({ type: "artifact-autoreact-ledger", v: 1, sessionId: id, accountUuid: "acct-1111-2222", artifacts: [] });
  side({ type: "file-history-snapshot", messageId: "m", snapshot: { trackedFileBackups: {} }, isSnapshotUpdate: false });
  side({ type: "mode", mode: "normal", sessionId: id });

  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { id, file, trFile, recs, authFile };
}

// Every text file under a folder, gzip files decompressed, as one string.
export function readTree(dir) {
  let out = "";
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.name === ".git") continue;
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".gz")) out += zlibGunzip(p);
      else out += fs.readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}
import zlib from "node:zlib";
const zlibGunzip = (p) => zlib.gunzipSync(fs.readFileSync(p)).toString("utf8");
