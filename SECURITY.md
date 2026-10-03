# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/claude-code-team-sync/security/advisories/new](https://github.com/nrzz/claude-code-team-sync/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/master/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool can and cannot protect

Redaction of secrets is best effort: share sessions only with people who may see the code they touch. Who can read the hub is decided by the git host or the shared folder. Project hooks run `.claude/team-sync/claude-team.mjs` from the repository, so anyone who can push to the project can change what teammates run, as with any project hook.
