# Changelog

All notable changes to Claude Code team sync are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0] - 2026-10-28

- `claude-team list` and `claude-team search` take `--since <when>`: hours, days or weeks back (`12h`, `7d`, `2w`) or a date (`YYYY-MM-DD`, local midnight). A shared session is kept when its `sharedAt` is at or after that moment; any other value is an error that says what is accepted.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#4](https://github.com/nrzz/claude-code-team-sync/pull/4), for the good first issue [#3](https://github.com/nrzz/claude-code-team-sync/issues/3).
- The README's test count is the runner's again: 57 automated tests (58 with the helper file the runner lists). It had said 54. Its option table also lists `notes` for `--limit`, which it takes (default 30).

## [1.2.1] - 2026-10-04

- Privacy fixes from an audit: the session title is redacted like the conversation (a key in the first prompt reached the hub), the whole value of a tool input field named like a secret (`password`, `token`, `api_key` ...) is redacted, and a key named just `token` and a URL password with no user name are caught.
- `init` leaves a `.claude/settings.json` that is not valid JSON exactly as it was, as its message says (it used to replace it).
- `auto skip --session` takes the short id that `claude-team sessions` prints; before, a short id never matched and the session was still shared.
- A flag that needs a value but got none, or a flag that does not exist, is a one-line error instead of a stack trace or silence.
- The hub README and the `TEAM.md` template say when `TEAM.md` is shown (a first session and after a change), and the README now matches the code throughout: `--no-raw`, `--keep-thinking` and `--keep-images`, path placeholders, the offline notice, hook timings, Node 18 in CI.

## [1.2.0] - 2026-10-03

- Token-lean defaults: the session-start digest shows only what is new since your last session (modes new, full, pointer, off), `/team-load` loads the brief and the recent conversation (about 3K tokens), shares record their size and `resume` warns before re-sending a big conversation, and only `/team-load` stays visible to Claude.
- Fixed: the vendored copy compares real paths when it updates itself (macOS).

## [1.1.0] - 2026-10-03

- Automatic sync: a detached background sync every 5 minutes, notices of teammates' news, and opt-in automatic sharing (`end`, `live`), `claude-team auto`, `claude-team watch`, `/team-auto`, `init --no-auto`.
- Fixed: notes written in the same minute were reported out of order.

## [1.0.0] - 2026-10-03

- First release: hubs on a branch, a separate repository or a synced folder; share, list, search, show, resume, notes, TEAM.md; redaction and path placeholders; the session-start digest and four skills.
- Fixed: path placeholders on macOS and Linux (caught by CI).

[1.3.0]: https://github.com/nrzz/claude-code-team-sync/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/nrzz/claude-code-team-sync/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/nrzz/claude-code-team-sync/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nrzz/claude-code-team-sync/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-team-sync/releases/tag/v1.0.0
