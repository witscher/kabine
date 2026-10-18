# Security

Kabine holds names of children and teenagers. Please report security problems privately, never in a public issue or pull request.

## Reporting

Write to **david@heidt.biz** with:

- what an attacker could do (for example: see decline reasons of another team, act as another person),
- the steps or a request that shows it, against your own local or test installation,
- the version or commit you tested.

You get a first answer within a week. Please give us time to fix and release before you publish anything; we name you in the release notes if you like.

## Scope

- Only the latest release is supported. Clubs receive fixes through the weekly update pull request in their copy.
- Every installation runs in the club's own Cloudflare account. The maintainers have no access to any club's data and cannot look into a club's installation; a problem in one club's setup (for example a leaked setup password) is the club's to fix, with our help.
- Never test against an installation of a club that is not yours, and never against the public demo with other people's sessions.

The rules every change follows (permissions on the server, data minimisation, who sees names and reasons) are in [AGENTS.md](AGENTS.md); the checks are in `docs/security.md` and `test/security.test.ts`.
