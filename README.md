# Claude Code team sync

[![test](https://github.com/nrzz/claude-code-team-sync/actions/workflows/test.yml/badge.svg)](https://github.com/nrzz/claude-code-team-sync/actions/workflows/test.yml)

Work on one project with your coworkers in Claude Code without starting from zero every time. Share the session you are in with one command, pick up a teammate's session where they left it, and give every new session the team's notes and decisions before anyone types a word.

Each person keeps their own Claude seat (Team, Enterprise, Pro, Max or an API key). Nothing here shares a login. What travels is context.

## Why this exists

Claude Code keeps every conversation on the machine it ran on. A Team plan gives each person a seat, not a shared history, and Claude Code has no built-in way to hand a local session to a teammate. Git already carries the shared parts of a project's setup (`CLAUDE.md`, `.claude/settings.json`, skills). This adds what was missing:

| You want to | Without this | With this |
| --- | --- | --- |
| Hand over a half-done task | Write a long Slack message, or paste the whole chat | `/team-share`: Claude writes the brief, the session goes to the hub |
| Continue a teammate's work | Re-explain everything to a fresh session | `/team-load login bug`: their brief and conversation load into yours |
| Continue their exact session | Not possible | `claude-team resume <id>`: their transcript becomes your own session |
| Keep the team on the same page | Hope everyone reads the wiki | Notes and `TEAM.md` reach every new session by themselves |

## What it costs in tokens

Every team member pays for what this puts in front of Claude, so it is lean by default and says what everything costs:

| Part | Tokens | |
| --- | --- | --- |
| Background sync, automatic sharing, notices of teammates' news | 0 | Separate processes, and lines shown to you, not to Claude |
| Session-start digest (default) | 0 when nothing is new, usually 50 to 300 when something is | Never more than about 375. `claude-team auto digest pointer` makes it one line, `off` removes it |
| Skills | about 22 per session | Only `/team-load`'s one-line description is in Claude's skill list; the other four are user-only and cost nothing until typed |
| `/team-load` | about 3K per load | The brief and the recent conversation, without tool output. `/team-load <id> full` loads up to about 15K |
| `/team-share` | a brief of at most 25 lines, written by Claude | |
| `/team`, `/team-note`, `/team-auto` | one short turn | The terminal command does the same for 0 |
| `claude-team resume` | the whole shared conversation, once | It prints the size first and points to `/team-load` when the session is big |
| Anything run as `claude-team ...` in a terminal | 0 | |

## Set up in 2 minutes

One person per project, in the project folder (Node 18 or newer):

```bash
npx -y github:nrzz/claude-code-team-sync init
```

It asks where the team hub should live, then writes a few small files into `.claude/`. Commit and push them:

```bash
git add .claude && git commit -m "Add Claude team hub" && git push
```

Teammates pull. That is all for a git-based hub: their next Claude Code session in the project connects by itself. On a synced-folder hub, each teammate runs this once, with their own path to the folder:

```bash
node .claude/team-sync/claude-team.mjs join --folder "C:\Users\me\OneDrive - Acme\Claude Hub"
```

Nobody installs anything else: the whole tool is one file, committed with the project at `.claude/team-sync/claude-team.mjs`.

## Where the hub can live

| Hub | Pick it when | Who can see it |
| --- | --- | --- |
| `branch` (default) | The project is on GitHub, GitLab, Azure DevOps or Bitbucket | Everyone with access to the repository. Lives on an orphan branch `claude-team-hub`, so it never touches your code history |
| A separate git repository | Sessions should be visible to fewer people than the code | Whoever you give access to that repository |
| A synced folder | No git, or your office lives in OneDrive, SharePoint, Teams files, Google Drive, Dropbox or a network share | Whoever the folder is shared with |

```bash
npx -y github:nrzz/claude-code-team-sync init --hub branch
npx -y github:nrzz/claude-code-team-sync init --hub https://github.com/acme/claude-hub.git
npx -y github:nrzz/claude-code-team-sync init --hub "C:\Users\me\OneDrive - Acme\Claude Hub"
```

For a Teams channel: open the channel's Files tab, choose "Sync" (or "Add shortcut to OneDrive"), and use that folder.

## Every day, inside Claude Code

| Type | What happens |
| --- | --- |
| `/team-share` | Claude writes a brief of this session (goal, state, decisions, next step, files) and shares it with the conversation |
| `/team-load <id or topic>` | Loads a teammate's shared session into this one: their brief, then the recent conversation without tool output (about 3K tokens; add `full` for more) |
| `/team-note we deploy on Thursdays` | Adds a dated line to the team notes |
| `/team` | Who shared what recently, and the newest notes |
| `/team-auto live` | Your sessions are shared automatically as you work (`end`: when they end, `off`: only by hand, `skip`: not this session) |

When something arrived since your last session (a shared session, a note, a change to `TEAM.md`), your next new session starts with a short digest of just that, and a one-line notice tells you. Each piece of news is shown once; a session that starts with nothing new gets nothing. Rules every session must follow belong in `CLAUDE.md`, which git already shares; `TEAM.md` is for the team's state and news.

## Automatic sync

Nobody has to pull or push. While anyone on the team works in Claude Code, the hub stays in sync by itself:

| What | When | Cost |
| --- | --- | --- |
| Pull teammates' shares and notes, push yours, retry what failed offline | Every 5 minutes while you work, in a background process that never holds up a prompt | Nothing in your context |
| `TEAM.md` edits | Pushed with the next background sync | Nothing |
| A teammate shares a session or adds a note | One line appears under your next prompt: `Team: Alice shared "Fix login" (/team-load 7be317ee) · Bob: staging is frozen` | No tokens (or a few, if you set notices to `context` so Claude is told too) |
| Your own sessions, if you turn it on | `end`: shared when the session ends. `live`: kept up to date every 10 minutes while you work, and at the end | A background process; a brief you wrote with `/team-share` is kept |

Sharing your own sessions automatically is off until you turn it on, per person and per project:

```bash
claude-team auto live                 # or: auto end, auto off
claude-team auto skip --session <id>  # keep one session out (/team-auto skip does it for the session you are in)
claude-team auto notices context      # also tell Claude what is new (notice: only you, off: nothing)
claude-team auto every 2              # sync every 2 minutes
claude-team auto                      # what is set, and when the last sync ran
```

Automatic sharing skips sessions with a single prompt, never shares a session you marked `skip`, and uses the same redaction as `/team-share`. A team can set defaults for everyone in `.claude/team-sync.json` (`"autoShare": "end"`); each person's own choice wins. `init --no-auto` sets up a hub with the session-start digest only.

To keep a hub in sync while Claude Code is closed, leave `claude-team watch` running in a terminal tab: it syncs every 2 minutes and prints what teammates add.

## Every day, in a terminal

`claude-team` below means `node .claude/team-sync/claude-team.mjs` (or install it globally with `npm i -g github:nrzz/claude-code-team-sync`).

```bash
claude-team sessions                  # your sessions in this project
claude-team share --last              # share the newest one
claude-team list                      # what the team shared
claude-team show login bug            # read a brief
claude-team resume 403273f4           # continue a teammate's session as your own
claude-team note "staging is frozen until Monday"
claude-team context                   # read TEAM.md, or --path to edit it; edits go out with the next sync
claude-team sync                      # sync now instead of waiting for the background
claude-team watch                     # keep syncing from this terminal, with news as it arrives
```

`resume` rebuilds the shared transcript with your own paths under `~/.claude/team-sync/imports/` and prints the exact command that opens it, of this form:

```bash
claude --resume "<the printed path to the .jsonl>" --fork-session
```

Claude Code imports it as a new session of yours (`--fork-session` gives it a new id), with the whole conversation, every tool call and its result. Add `--launch` to start it straight away.

## What is shared, and what never leaves your machine

Each shared session becomes a folder in the hub: `brief.md`, `transcript.md` (readable), `meta.json` and `session.jsonl.gz` (the resumable transcript). Before anything is written:

- **Secrets are redacted**: Anthropic, OpenAI, GitHub, GitLab, Slack, AWS, Google, Stripe, npm, Hugging Face and SendGrid keys, JWTs, bearer tokens, private keys, passwords in URLs and connection strings, `.env` style `*_SECRET=`/`*_TOKEN=`/`*_PASSWORD=` lines, quoted `password`/`api_key`/`token` values, and Teams and Slack webhooks.
- **Removed**: Claude's thinking, pasted images and documents, your account and organisation ids, plan usage and rate-limit data, file-history backups, and the bookkeeping records Claude Code keeps for itself.
- **Paths become placeholders**: your project folder, home folder and Claude folder are replaced, and swapped back for the receiver's own paths on `resume`.

Redaction is best effort. Look before you share with `claude-team share --dry-run`, which writes the package to `~/.claude/team-sync/preview/` and shares nothing. `--no-raw` shares only the brief and the readable transcript. Add your own patterns to `.claude/team-sync.json`:

```json
{ "version": 1, "project": "webapp", "hub": { "type": "branch" }, "redact": { "patterns": ["ACME-[0-9]{6}"] } }
```

Share sessions only with people who may see the code and data they touch.

## Settings

| Where | Key | Meaning |
| --- | --- | --- |
| `.claude/team-sync.json` (committed) | `project` | The project's name in the hub; taken from the git remote, so every clone agrees |
| | `hub` | `{"type": "branch", "branch": "claude-team-hub", "remote": "origin"}`, `{"type": "git", "url": "...", "branch": "main"}` or `{"type": "folder", "label": "Claude Hub"}` |
| | `digest` | Team default for the session-start digest: `"new"` (default), `"full"`, `"pointer"` or `"off"` |
| | `digestChars` | Size cap of the digest, default 1500 characters (about 375 tokens) |
| | `redact.patterns` | Extra regular expressions to redact |
| | `autoSync`, `syncMinutes`, `notices`, `autoShare`, `shareMinutes` | Team defaults for automatic sync: `true`, `5`, `"notice"`, `"off"`, `10` |
| `~/.claude/team-sync/config.json` (yours) | `name` | Your name in the hub; defaults to `git config user.name` |
| | `folders` | Where each folder hub is on this machine |
| | `digest`, `projects.<name>.digest` | Your own digest mode, set with `claude-team auto digest`; it wins over the team's |
| | `projects.<name>.autoShare` and the other automatic sync keys | Your own choices, set with `claude-team auto`; they win over the team's |
| Environment | `CLAUDE_TEAM_NAME`, `CLAUDE_TEAM_HUB_DIR`, `CLAUDE_TEAM_HOOK_TIMEOUT_MS` (default 8000), `CLAUDE_TEAM_SYNC_MINUTES`, `CLAUDE_TEAM_SHARE_MINUTES`, `CLAUDE_CONFIG_DIR` | Name, folder hub path, how long a session-start sync may take, interval overrides, and Claude's own config folder |

## How it works

- `init` writes `.claude/team-sync.json`, copies the tool to `.claude/team-sync/`, adds the five skills under `.claude/skills/`, and adds four hooks to `.claude/settings.json` (merged with what is already there): `SessionStart`, `UserPromptSubmit`, `Stop` and `SessionEnd`. Then it creates the hub with a `README.md` and `projects/<project>/TEAM.md`.
- Each hook runs `node "${CLAUDE_PROJECT_DIR}/.claude/team-sync/claude-team.mjs" hook <event>` and returns in about a tenth of a second: anything that needs the network runs in a separate background process, one at a time (a lock keeps two syncs from overlapping). No hook ever prompts for a password or blocks a session. Offline, everything works from the copy on your machine and catches up on the next sync; failures of background work go to `~/.claude/team-sync/logs/auto.log`.
- The session-start digest uses the local copy when it was synced in the last half hour (refreshing it in the background), and syncs first, for at most 8 seconds, when it is older.
- What teammates added is worked out by comparing the hub before and after each sync, so a notice is shown once per session and never for your own shares, nor for updates of a session you already heard about.
- Git hubs live in `~/.claude/team-sync/hubs/` as small working copies. Pushes retry with a rebase when a teammate pushed first. Notes go to one file per person, so two people adding notes never conflict.
- claude-team never writes into Claude Code's own session store. `resume` writes a file under `~/.claude/team-sync/imports/`, and Claude Code itself imports it through `--resume <file> --fork-session`.

## What was verified, and how

Checked on 2026-10-03 against the transcript format of Claude Code 2.1.286, on Windows 11 by hand and on Windows, macOS and Linux with Node 20, 22 and 24 in CI:

- **50 automated tests** (`npm test`), green on all nine OS and Node combinations. The first CI run caught a real bug that Windows alone could not show: on case-sensitive file systems, paths were left in shared transcripts. Fixed, and covered by a test. Unit tests cover redaction (16 secret kinds caught, 8 look-alikes such as `password: string` and `PASSWORD=${DB_PASSWORD}` left alone), the project-folder naming rule, path placeholders both ways (Windows to macOS included), and transcript cleanup: every removed record is re-linked so the conversation chain stays whole, and ids and signatures are never rewritten.
- **End to end, three hub types.** Two people with separate Claude folders and a real local git remote: init creates the hub branch; a share from one person is published with nothing secret or private in it (checked by cloning the hub branch and searching every file, the compressed transcript included); the other person's first session start shows the digest with no setup; `/team-load`'s command finds the session by topic; `resume` rebuilds the transcript with the receiver's paths and no placeholder left; notes with quotes and symbols arrive from both sides; the next session start announces what is new. The same flow runs through a synced folder without git, and through an empty separate repository.
- **Automatic sync, end to end.** Hooks run as Claude Code runs them, as separate processes with JSON on stdin: a teammate's share and note arrive mid-session as one notice, shown once; notices in `context` mode reach Claude and `off` stays silent; a `TEAM.md` edit reaches the other person with no sync command; `live` sharing updates the hub after a turn and not again inside its interval; a brief written with `/team-share` survives automatic updates; `end` sharing shares at session end and leaves a skipped session alone; `watch` prints news. One test runs the real detached background process and checks the hook returned at once while the sync finished behind it. These tests caught a real bug: notes written in the same minute were reported in the wrong order.
- **Token budgets, as tests.** The default digest is empty when nothing is new, under 500 characters for a day's news, and never over 1,500; an update of a session already announced is not news again, and an unchanged `TEAM.md` is not repeated. Only `/team-load` is visible to Claude, every skill description is under 100 characters, and the `/team-share` brief is capped at 25 lines. Loading a 60-turn session by default stays under 16,000 characters with tool output left out and the latest state kept; `full` loads more; `resume` and `list` show the session's size.
- **Speed.** Measured on Windows: the per-prompt hook takes about 110 ms (mostly starting Node) and never waits for the network; a session start with a fresh local copy takes about 160 ms.
- **Resilience.** An unreachable hub leaves the hooks silent and quick (exit code 0), and malformed hook input is ignored.

Not verified yet: opening an imported transcript with `claude --resume <file> --fork-session` in a live Claude Code session. Claude Code documents resuming from a transcript path, and the rebuilt file keeps Claude Code's own record format, but the build session's safety checks did not allow writing a synthetic transcript and loading it into Claude Code. After your first `resume`, a one-line question to the resumed session ("what was the last thing we did?") confirms it on your machine. Also not covered: hubs on network shares with path limits stricter than Windows' default.

## Files

| Path | What it is |
| --- | --- |
| `claude-team.mjs` | The whole tool: CLI, hub sync, automatic sync, redaction, transcript cleanup, the hooks, and the skills it installs |
| `test/` | Unit and end-to-end tests (`npm test`) |

After `init`, a project holds `.claude/team-sync.json`, `.claude/team-sync/claude-team.mjs` (and a README), `.claude/skills/team*/SKILL.md`, and the hooks in `.claude/settings.json`. To update all of it later, run `npx -y github:nrzz/claude-code-team-sync update` in the project and commit.

Related: [claude-code-handover](https://github.com/nrzz/claude-code-handover) keeps your own sessions short with a handover file each new session loads by itself. The two work well together: the handover is for you tomorrow, the hub is for your teammates today.

## License

MIT
