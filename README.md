# Claude Code team sync

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
| `/team-load <id or topic>` | Loads a teammate's shared session into this one: their brief first, then the condensed conversation |
| `/team-note we deploy on Thursdays` | Adds a dated line to the team notes |
| `/team` | Who shared what recently, and the newest notes |

At every session start, the newest notes, `TEAM.md` and the latest shared sessions arrive in a short digest (capped at 3,000 characters, about 750 tokens). When something is new since your last session, a one-line notice tells you, and that notice costs no tokens.

## Every day, in a terminal

`claude-team` below means `node .claude/team-sync/claude-team.mjs` (or install it globally with `npm i -g github:nrzz/claude-code-team-sync`).

```bash
claude-team sessions                  # your sessions in this project
claude-team share --last              # share the newest one
claude-team list                      # what the team shared
claude-team show login bug            # read a brief
claude-team resume 403273f4           # continue a teammate's session as your own
claude-team note "staging is frozen until Monday"
claude-team context                   # read TEAM.md; edit it, then: claude-team sync
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
| | `digest` | `"off"` turns the session-start digest off for everyone |
| | `digestChars` | Size cap of the digest, default 3000 |
| | `redact.patterns` | Extra regular expressions to redact |
| `~/.claude/team-sync/config.json` (yours) | `name` | Your name in the hub; defaults to `git config user.name` |
| | `folders` | Where each folder hub is on this machine |
| | `digest` | `"off"` turns the digest off for you only |
| Environment | `CLAUDE_TEAM_NAME`, `CLAUDE_TEAM_HUB_DIR`, `CLAUDE_TEAM_HOOK_TIMEOUT_MS` (default 8000), `CLAUDE_CONFIG_DIR` | Name, folder hub path, how long the session-start sync may take, and Claude's own config folder |

## How it works

- `init` writes `.claude/team-sync.json`, copies the tool to `.claude/team-sync/`, adds the four skills under `.claude/skills/`, and adds one `SessionStart` hook to `.claude/settings.json` (merged with what is already there). Then it creates the hub with a `README.md` and `projects/<project>/TEAM.md`.
- The hook runs `node "${CLAUDE_PROJECT_DIR}/.claude/team-sync/claude-team.mjs" hook session-start` on new and cleared sessions. It syncs for at most 8 seconds, never prompts for a password, and never blocks a session: offline, it uses the copy on your machine.
- Git hubs live in `~/.claude/team-sync/hubs/` as small working copies. Pushes retry with a rebase when a teammate pushed first. Notes go to one file per person, so two people adding notes never conflict.
- claude-team never writes into Claude Code's own session store. `resume` writes a file under `~/.claude/team-sync/imports/`, and Claude Code itself imports it through `--resume <file> --fork-session`.

## What was verified, and how

Checked on 2026-10-03 on Windows 11 with Node 24 and git 2.55, against the transcript format of Claude Code 2.1.286:

- **31 automated tests** (`npm test`). Unit tests cover redaction (16 secret kinds caught, 8 look-alikes such as `password: string` and `PASSWORD=${DB_PASSWORD}` left alone), the project-folder naming rule, path placeholders both ways (Windows to macOS included), and transcript cleanup: every removed record is re-linked so the conversation chain stays whole, and ids and signatures are never rewritten.
- **End to end, three hub types.** Two people with separate Claude folders and a real local git remote: init creates the hub branch; a share from one person is published with nothing secret or private in it (checked by cloning the hub branch and searching every file, the compressed transcript included); the other person's first session start shows the digest with no setup; `/team-load`'s command finds the session by topic; `resume` rebuilds the transcript with the receiver's paths and no placeholder left; notes with quotes and symbols arrive from both sides; the next session start announces what is new. The same flow runs through a synced folder without git, and through an empty separate repository.
- **Resilience.** An unreachable hub leaves the session-start hook silent and quick (exit code 0), and malformed hook input is ignored.

Not verified yet: opening an imported transcript with `claude --resume <file> --fork-session` in a live Claude Code session. Claude Code documents resuming from a transcript path, and the rebuilt file keeps Claude Code's own record format, but the build session's safety checks did not allow writing a synthetic transcript and loading it into Claude Code. After your first `resume`, a one-line question to the resumed session ("what was the last thing we did?") confirms it on your machine. Also not covered: hubs on network shares with path limits stricter than Windows' default.

## Files

| Path | What it is |
| --- | --- |
| `claude-team.mjs` | The whole tool: CLI, hub sync, redaction, transcript cleanup, the hook, and the skills it installs |
| `test/` | Unit and end-to-end tests (`npm test`) |

After `init`, a project holds `.claude/team-sync.json`, `.claude/team-sync/claude-team.mjs` (and a README), `.claude/skills/team*/SKILL.md`, and the hook in `.claude/settings.json`. To update all of it later, run `npx -y github:nrzz/claude-code-team-sync update` in the project and commit.

Related: [claude-code-handover](https://github.com/nrzz/claude-code-handover) keeps your own sessions short with a handover file each new session loads by itself. The two work well together: the handover is for you tomorrow, the hub is for your teammates today.

## License

MIT
