# Kabine

Free team app for sports clubs (PWA): events, attendance, squads, team chat, push, helper duties, carpools, passkey login. One installation per club on Cloudflare. Licence AGPL-3.0.

Read `docs/plan.md` before every task: decisions, milestones, open points. Decisions not covered there go into `docs/decisions.md` with a reason.

## Platform

Cloudflare Developer Platform only: Workers with static assets, D1, KV, Durable Objects, Queues, Cron Triggers, Email Sending. Exceptions only where the club chooses them: external SMTP server, SMS provider.

- Code runs in the Workers runtime. Web Crypto instead of Node `crypto`, no libraries with Node dependencies.
- TypeScript, configuration and deployment via Wrangler.
- Change the D1 schema only through migrations. Until the first release `migrations/0001_init.sql` is edited directly; after that every change is a new migration that must run safely for every club.
- Never put secrets in code or in the repository.
- No club-specific data in code: names, domains, e-mail addresses, logos and texts of a club belong in the club profile (database) or the setup wizard.

## Testing on Cloudflare

Test deployments use the maintainer's account with resource names containing `kabine` and domains under `yope.de` only. Never touch other resources in that account (other Workers, databases, KV namespaces, queues, zones and domains).

## Rules

- Check permissions on the server. Names and decline reasons leave the API only to coaches and admins of the team, unless a team switches on "responses visible to all" (then players and their parents see names and status, never reasons).
- Times are stored and computed as local time in the club's time zone (club profile), not UTC.
- Data minimisation: of players and parents only first name, last name, birth year. No further personal fields. Exceptions: e-mail address on the account (login, optional notifications, feedback reply), phone number on the account only with the SMS module and only if the person enters it, optional profile picture (minors only with parental consent), hidden attribute "club member" (admins only).
- Tests, fixtures and the demo use invented names only.
- Source language in code is English. Every user-facing text goes through Lingui (`t`, `<Trans>`, plurals via ICU). Add the German translation in the same change, marked `# ai` if machine-translated. Identifiers in English.
- Fonts self-hosted, no external resources at runtime (except the club's own SMTP/SMS provider and the fixture connectors the club enables).
- Keep D1 reads low: start queries from a candidate set, use indexes, page lists. `test/query-plans.test.ts` checks the hot queries.

## Commands

Node.js 22 or newer.

| Purpose | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Local secrets (once) | `npm run secrets:generate -- --dev` |
| Reset local database with migrations and demo seed | `npm run db:reset:local` |
| Dev server | `npm run dev` (http://localhost:5173) |
| Typecheck | `npm run typecheck` |
| Unit and API tests (Vitest in the Workers pool) | `npm test` |
| End-to-end tests (Playwright, own test database, invented data) | `npm run e2e` |
| Typecheck and tests | `npm run check` |
| Deploy (build, remote migrations, upload) | `npm run deploy` |
| Maintenance mode | `npm run maintenance:on` / `maintenance:off` / `maintenance:status` |
