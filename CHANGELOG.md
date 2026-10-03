# Changelog

All notable changes to Claude Code team sync are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-03

- Token-lean defaults: the session-start digest shows only what is new since your last session (modes new, full, pointer, off), `/team-load` loads the brief and the recent conversation (about 3K tokens), shares record their size and `resume` warns before re-sending a big conversation, and only `/team-load` stays visible to Claude.
- Fixed: the vendored copy compares real paths when it updates itself (macOS).

## [1.1.0] - 2026-10-03

- Automatic sync: a detached background sync every 5 minutes, notices of teammates' news, and opt-in automatic sharing (`end`, `live`), `claude-team auto`, `claude-team watch`, `/team-auto`, `init --no-auto`.
- Fixed: notes written in the same minute were reported out of order.

## [1.0.0] - 2026-10-03

- First release: hubs on a branch, a separate repository or a synced folder; share, list, search, show, resume, notes, TEAM.md; redaction and path placeholders; the session-start digest and four skills.
- Fixed: path placeholders on macOS and Linux (caught by CI).

[1.2.0]: https://github.com/nrzz/claude-code-team-sync/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nrzz/claude-code-team-sync/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-team-sync/releases/tag/v1.0.0
