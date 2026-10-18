# Contributing

Thank you for helping. Kabine is AGPL-3.0; by sending a pull request you agree that your contribution is released under the same licence.

Good first contributions: a translation, a sport profile, a fixture connector for another league system, an SMS provider, a new module. Where things live, the rules and the commands are in [AGENTS.md](AGENTS.md), which coding agents read on their own; modules: [docs/modules.md](docs/modules.md), connectors: [docs/connectors.md](docs/connectors.md).

## Pull requests written with a coding agent

Welcome. A person sends the pull request, has run it locally (`npm run check`, and `npm run e2e` for changes to screens) and answers questions about it. Say in the description which agent helped. Changes to the core areas (sign-in, permissions, migrations, the module interfaces) are reviewed by the maintainer.

## Set up

Node.js 22 or newer.

```sh
npm ci
npm run secrets:generate -- --dev
npm run db:reset:local     # database with the invented demo club
npm run dev                # http://localhost:5173
npm run new -- module <name> --label "Name"   # start a module (or: connector, see AGENTS.md)
npm run check              # typecheck, tests, translations complete
npm run e2e                # end-to-end tests (for changes to screens)
```

## What a pull request needs

- One topic per pull request, with a short description of what changes for whom.
- `npm run check` passes (it includes the translation check); a test for new behaviour.
- Every text a person reads goes through Lingui, English source plus the German translation in the same change (machine translations marked `# ai`, see [docs/translation.md](docs/translation.md)).
- Schema changes are new files in `migrations/`; they must run safely for every club.

## Rules of the project

- **Cloudflare only:** Workers, D1, KV, Durable Objects, Queues, Cron, Email Sending. Web Crypto instead of Node `crypto`, no libraries with Node dependencies.
- **Permissions on the server.** Names and decline reasons leave the API only to coaches and admins of the team, unless the team switches on "responses visible to all" (then names and status, never reasons).
- **Data minimisation:** of players and parents only first name, last name, birth year. New personal data needs a reason in the pull request and an entry in `docs/privacy.md`.
- **No club-specific data in code.** Names, domains, addresses and logos belong in the club profile.
- **No external resources at runtime:** fonts and scripts are self-hosted, no tracking.
- **Keep D1 reads low:** start from a candidate set, use indexes, page lists; `test/query-plans.test.ts` checks the hot queries.
- **Invented names** in tests, fixtures and the demo.
- Never commit secrets.

Security problems: please do not open a public issue, see [SECURITY.md](SECURITY.md).
