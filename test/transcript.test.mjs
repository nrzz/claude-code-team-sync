import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  projectSlug, makeRedactor, pathMapper, importMapper, parseTranscript, sanitizeRecords, summarize,
  renderTranscript, nextStepOf, trimMiddle, mergeHookSettings, mapStrings, readable, parseArgs, promptText,
} from "../claude-team.mjs";
import { tmp, writeFakeSession, SECRETS } from "./helpers.mjs";

test("project folder names follow Claude Code's rule", () => {
  assert.equal(projectSlug("C:\\Users\\alice\\code\\web-app"), "C--Users-alice-code-web-app");
  assert.equal(projectSlug("/home/bob/web app"), "-home-bob-web-app");
  const long = "/srv/" + "very-long-folder-name/".repeat(12);
  const slug = projectSlug(long);
  assert.match(slug, /^.{200}-[0-9a-z]+$/);
  assert.equal(slug, projectSlug(long));
  assert.notEqual(slug, projectSlug(long + "x"));
});

test("redaction catches common secrets and leaves ordinary code alone", () => {
  const redact = makeRedactor();
  const hits = {};
  const j = (...parts) => parts.join(""); // fake secrets built from pieces, so scanners do not flag the source
  const cases = {
    "private-key": j("-----BEGIN RSA ", "PRIVATE KEY-----\nMIIabc\n-----END RSA ", "PRIVATE KEY-----"),
    "anthropic-key": `key ${SECRETS.anthropic}`,
    "openai-key": j("OPENAI sk-", "proj-", "x".repeat(40)),
    "github-token": `token ${SECRETS.github}`,
    "gitlab-token": j("glp", "at-", "abcdefghijklmnopqrstu"),
    "slack-token": j("xo", "xb-", "123456789012-abcdefghij"),
    "aws-access-key": `id ${SECRETS.aws}`,
    "google-api-key": j("AI", "za", "B".repeat(35)),
    "jwt": j("eyJhbGciOiJIUzI1NiJ9", ".eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
    "bearer-token": "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
    "url-password": `postgres://app:${SECRETS.dbPassword}@db:5432/app`,
    "connection-password": "Server=db;Database=app;User Id=sa;Password=S3cret!x;",
    "env-secret": "DATABASE_PASSWORD=correcthorse\nSTRIPE_SECRET_KEY=abcd1234",
    "assigned-secret": 'const config = { apiKey: "a1b2c3d4e5f6g7" }',
    "teams-webhook": j("https://acme.web", "hook.office.com/webhookb2/abc@def/IncomingWebhook/123"),
  };
  for (const [kind, text] of Object.entries(cases)) {
    const out = redact(text, hits);
    assert.match(out, new RegExp(`\\[REDACTED:${kind}\\]`), `${kind} not redacted in: ${out}`);
  }
  assert.ok(!redact(cases["url-password"], {}).includes(SECRETS.dbPassword));
  assert.ok(redact(cases["url-password"], {}).startsWith("postgres://app:"), "the user name stays");

  const benign = [
    "function login(password: string, token: Token) {}",
    "const token = getToken(); const apiKey = process.env.API_KEY;",
    'api_key = "your-api-key-here"',
    "http://localhost:3000/callback?x=1",
    "https://example.com/a:b",
    "commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39 and id 0499592b-bf15-4d64-964f-37ee687597b6",
    "user.Password = model.Password;",
    "PASSWORD=${DB_PASSWORD}",
  ];
  for (const b of benign) assert.equal(redact(b, {}), b, `false positive on: ${b}`);
});

test("custom redaction patterns from the project config apply", () => {
  const redact = makeRedactor(["ACME-[0-9]{6}"]);
  assert.equal(redact("ticket ACME-123456 opened", {}), "ticket [REDACTED:custom] opened");
});

test("paths become placeholders and come back as the receiver's paths", () => {
  const out = pathMapper({ root: "D:\\Work\\webapp", home: "C:\\Users\\alice", slug: "D--Work-webapp", toolResults: "C:\\Users\\alice\\.claude\\projects\\D--Work-webapp\\abc\\tool-results" });
  assert.equal(out("open D:\\Work\\webapp\\src\\a.ts now"), "open {{PROJECT_ROOT}}\\src\\a.ts now");
  assert.equal(out("d:/work/webapp/src/a.ts"), "{{PROJECT_ROOT}}/src/a.ts", "any case, any slash");
  assert.equal(out("D:\\Work\\webapp-old\\x"), "D:\\Work\\webapp-old\\x", "a sibling folder is not the project");
  assert.equal(out("C:\\Users\\alice\\.claude\\projects\\D--Work-webapp\\abc\\tool-results\\b.txt"), "{{TOOL_RESULTS}}\\b.txt");
  assert.equal(out("C:\\Users\\alice\\.claude\\projects\\D--Work-webapp\\memory\\m.md"), "{{HOME}}\\.claude\\projects\\{{PROJECT_SLUG}}\\memory\\m.md");
  assert.equal(out("see D:\\Work\\webapp."), "see {{PROJECT_ROOT}}.", "a full stop after a path still matches");

  const posix = pathMapper({ root: "/tmp/ct-L9eIpn/webapp", home: "/tmp/ct-L9eIpn", slug: "-tmp-ct-L9eIpn-webapp", toolResults: "/tmp/ct-L9eIpn/.claude/projects/-tmp-ct-L9eIpn-webapp/x/tool-results" });
  assert.equal(posix("open /tmp/ct-L9eIpn/webapp/src/a.ts"), "open {{PROJECT_ROOT}}/src/a.ts", "mixed-case POSIX paths match exactly");
  assert.equal(posix("/tmp/ct-l9eipn/webapp/src/a.ts"), "/tmp/ct-l9eipn/webapp/src/a.ts", "POSIX paths are case-sensitive");
  assert.equal(posix("/tmp/ct-L9eIpn/notes.txt"), "{{HOME}}/notes.txt");

  const back = importMapper({ root: "/Users/bob/code/webapp", home: "/Users/bob", slug: "-Users-bob-code-webapp", toolResults: "/Users/bob/.claude/team-sync/imports/abc/tool-results" });
  assert.equal(back("open {{PROJECT_ROOT}}\\src\\a.ts now"), "open /Users/bob/code/webapp/src/a.ts now");
  assert.equal(back("{{TOOL_RESULTS}}\\b.txt"), "/Users/bob/.claude/team-sync/imports/abc/tool-results/b.txt");
  assert.equal(back("{{HOME}}\\.claude\\projects\\{{PROJECT_SLUG}}\\memory"), "/Users/bob/.claude/projects/-Users-bob-code-webapp/memory");
  assert.equal(back("a regex \\d+ stays"), "a regex \\d+ stays");

  const win = importMapper({ root: "E:\\src\\webapp", home: "C:\\Users\\carol", slug: "E--src-webapp", toolResults: "C:\\t" });
  assert.equal(win("{{PROJECT_ROOT}}/src/a.ts"), "E:\\src\\webapp/src/a.ts", "Windows receivers accept forward slashes");
});

test("sanitizing removes private records, thinking, images and secrets, and keeps the chain whole", () => {
  const base = tmp();
  const root = path.join(base, "alice", "webapp");
  const home = path.join(base, "alice");
  const s = writeFakeSession({ claude: path.join(home, ".claude"), root, home });
  const { records, bad } = parseTranscript(fs.readFileSync(s.file, "utf8"));
  assert.equal(bad, 0);
  const counts = {};
  const redact = makeRedactor();
  const toPh = pathMapper({ root, home, slug: projectSlug(root), toolResults: path.dirname(s.trFile) });
  const { records: clean, stats } = sanitizeRecords(records, { mapString: (x) => toPh(redact(x, counts)) });
  const text = clean.map((r) => JSON.stringify(r)).join("\n");

  for (const secret of Object.values(SECRETS)) assert.ok(!text.includes(secret), `leaked ${secret}`);
  for (const id of ["acct-1111-2222", "org-3333-4444", "acct-9999"]) assert.ok(!text.includes(id), `leaked account id ${id}`);
  assert.ok(!text.includes("quotaLimits") && !text.includes("toolUseResult"));
  assert.ok(!JSON.stringify(text).includes(JSON.stringify(root).slice(1, -1)), "absolute project path left in");
  assert.ok(text.includes("{{PROJECT_ROOT}}") && text.includes("{{TOOL_RESULTS}}") && text.includes("{{HOME}}"));
  assert.equal(stats.thinking, 1);
  assert.equal(stats.images, 1);
  for (const t of ["bridge-session", "history-suppression", "artifact-autoreact-ledger", "file-history-snapshot", "mode", "queue-operation"]) {
    assert.ok(stats.dropped[t] >= 1, `${t} not dropped`);
    assert.ok(!clean.some((r) => r.type === t));
  }
  assert.ok(clean.some((r) => r.type === "custom-title"));
  // Every parent link points at a record that is still there.
  const uuids = new Set(clean.filter((r) => r.uuid).map((r) => r.uuid));
  for (const r of clean) if (r.parentUuid) assert.ok(uuids.has(r.parentUuid), "dangling parentUuid");
  const leaf = clean.find((r) => r.type === "last-prompt");
  assert.ok(uuids.has(leaf.leafUuid));
  // Ids and signatures are never rewritten.
  assert.ok(clean.some((r) => r.message?.id === "msg_01"));
  assert.ok(counts["anthropic-key"] >= 1 && counts["url-password"] >= 1 && counts["github-token"] >= 1);
});

test("keep flags keep thinking and images untouched", () => {
  const base = tmp();
  const root = path.join(base, "w");
  const s = writeFakeSession({ claude: path.join(base, ".claude"), root, home: base });
  const { records } = parseTranscript(fs.readFileSync(s.file, "utf8"));
  const redact = makeRedactor();
  const { records: clean, stats } = sanitizeRecords(records, { mapString: (x) => redact(x, {}), keepThinking: true, keepImages: true });
  assert.equal(stats.thinking, 0);
  assert.equal(stats.images, 0);
  const thinking = clean.flatMap((r) => r.message?.content || []).find((b) => b?.type === "thinking");
  assert.equal(thinking.signature, "SIG123");
  assert.ok(thinking.thinking.includes(SECRETS.githubThinking), "signed thinking is never altered");
});

test("the readable transcript names who said what, with relative paths and intact regexes", () => {
  const base = tmp();
  const root = path.join(base, "webapp");
  const s = writeFakeSession({ claude: path.join(base, ".claude"), root, home: base });
  const { records } = parseTranscript(fs.readFileSync(s.file, "utf8"));
  const toPh = pathMapper({ root, home: base, slug: projectSlug(root), toolResults: path.dirname(s.trFile) });
  const { records: clean } = sanitizeRecords(records, { mapString: (x) => toPh(makeRedactor()(x, {})) });
  const sum = summarize(clean);
  assert.equal(sum.prompts, 2);
  assert.equal(sum.toolCalls, 3);
  assert.deepEqual(sum.files, ["src/auth.ts"]);
  const md = renderTranscript(clean, { title: "Fix login", author: "Alice", sharedAt: "2026-10-01T10:00:00Z", branch: sum.branch, prompts: sum.prompts, toolCalls: sum.toolCalls });
  assert.match(md, /### Alice/);
  assert.match(md, /### Claude/);
  assert.match(md, /Read `src\/auth\.ts`/);
  assert.match(md, /Edit `src\/auth\.ts`/);
  assert.ok(md.includes("^/app\\/[a-z]+$"), "backslashes in prose survive");
  assert.ok(md.includes('grep -rn "a\\|b" src'), "backslashes in commands survive");
  assert.ok(md.includes("~/notes.txt"));
  assert.ok(!md.includes("{{"), "no raw placeholders in the readable transcript");
  assert.ok(!md.includes(SECRETS.anthropic));
});

test("prompt text skips plumbing and shows slash commands", () => {
  assert.equal(promptText({ type: "user", message: { content: "<command-name>/compact</command-name><command-args>keep the API plan</command-args>" } }), "/compact keep the API plan");
  assert.equal(promptText({ type: "user", message: { content: "<local-command-stdout>ok</local-command-stdout>" } }), "");
  assert.equal(promptText({ type: "user", isMeta: true, message: { content: "injected" } }), "");
  assert.equal(promptText({ type: "user", message: { content: [{ type: "tool_result", content: "x" }] } }), "");
  assert.equal(promptText({ type: "user", message: { content: "<bash-input>npm test</bash-input>" } }), "! npm test");
});

test("next step is found in the usual brief shapes", () => {
  assert.equal(nextStepOf("**Next step**: write the test for /callback"), "write the test for /callback");
  assert.equal(nextStepOf("- **Next step:** run the migration"), "run the migration");
  assert.equal(nextStepOf("## Next step\n\nShip it to staging.\n## Files"), "Ship it to staging.");
  assert.equal(nextStepOf("We discussed the next step at length."), "");
});

test("trimming keeps the start and most of the end", () => {
  const text = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
  const out = trimMiddle(text, 4000);
  assert.ok(out.length < 4300);
  assert.ok(out.startsWith("line 0"));
  assert.ok(out.trimEnd().endsWith("line 1999"));
  assert.match(out, /omitted/);
  assert.equal(trimMiddle("short", 100), "short");
});

test("the hook is merged into project settings once, next to other hooks", () => {
  const settings = { permissions: { allow: ["Bash(npm test)"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }], Stop: [{ hooks: [{ type: "command", command: "x" }] }] } };
  const once = mergeHookSettings(structuredClone(settings));
  const twice = mergeHookSettings(structuredClone(once));
  assert.deepEqual(twice, once);
  assert.equal(once.hooks.SessionStart.length, 2);
  assert.equal(once.hooks.Stop.length, 2, "the existing Stop hook stays, ours is added");
  assert.equal(once.hooks.UserPromptSubmit.length, 1);
  assert.equal(once.hooks.SessionEnd.length, 1);
  assert.deepEqual(once.permissions, settings.permissions);
  const ours = once.hooks.SessionStart[1].hooks[0];
  assert.equal(ours.command, "node");
  assert.deepEqual(ours.args, ["${CLAUDE_PROJECT_DIR}/.claude/team-sync/claude-team.mjs", "hook", "session-start"]);
  assert.deepEqual(once.hooks.UserPromptSubmit[0].hooks[0].args.slice(1), ["hook", "prompt"]);
  // Without automatic sync only the session-start hook is ours, and turning it off removes the rest.
  const manual = mergeHookSettings(structuredClone(once), { auto: false });
  assert.equal(manual.hooks.SessionStart.length, 2);
  assert.equal(manual.hooks.UserPromptSubmit, undefined);
  assert.equal(manual.hooks.SessionEnd, undefined);
  assert.deepEqual(manual.hooks.Stop, settings.hooks.Stop);
});

test("mapStrings leaves ids, signatures and image bytes alone", () => {
  const rec = { uuid: "u-SECRET", message: { id: "m-SECRET", content: [{ type: "text", text: "SECRET" }, { type: "image", source: { type: "base64", data: "SECRET" } }] } };
  const out = mapStrings(rec, (s) => s.replace("SECRET", "x"));
  assert.equal(out.uuid, "u-SECRET");
  assert.equal(out.message.id, "m-SECRET");
  assert.equal(out.message.content[0].text, "x");
  assert.equal(out.message.content[1].source.data, "SECRET");
});

test("readable() and argument parsing", () => {
  assert.equal(readable("see {{PROJECT_ROOT}}\\src\\a.ts and {{PROJECT_ROOT}}"), "see src/a.ts and .");
  assert.equal(readable("{{HOME}}/x/y"), "~/x/y");
  const a = parseArgs(["abc", "--title", "My title", "--brief", "-", "--dry-run", "--to=/x"]);
  assert.deepEqual(a, { _: ["abc"], title: "My title", brief: "-", "dry-run": true, to: "/x" });
  assert.equal(parseArgs(["--brief"]).brief, "-");
  assert.equal(parseArgs(["--brief", "notes.md"]).brief, "notes.md");
  // A flag that takes a value but got none, or a flag that does not exist, is a clear error, not a crash later.
  assert.throws(() => parseArgs(["--hub"]), /--hub needs a value/);
  assert.throws(() => parseArgs(["--hub", "--yes"]), /--hub needs a value/);
  assert.throws(() => parseArgs(["--yse"]), /--yse is not an option of claude-team/);
});
