# Kabine – guide for contributors and coding agents

Kabine is a free team app for amateur sports clubs (PWA): events with yes/no responses, squads, team chat, push notifications, helper duties, carpools, passkey sign-in. Every club runs its own installation in its own Cloudflare account. Licence AGPL-3.0.

Contributions with the help of a coding agent are welcome. A person sends the pull request, has run it locally and answers questions about it; the pull request says which agent helped. This file is what you (or your agent) need to read first.

## Where to add what

| You want to add | Where | Guide |
| --- | --- | --- |
| A function clubs can switch on (polls, documents, statistics, …) | a module: `modules/<name>/` | [docs/modules.md](docs/modules.md) |
| Game schedules from another association system (handball360, nuLiga, SAMS, basketball-bund, …) | a fixture connector module | [docs/connectors.md](docs/connectors.md) |
| Another sport (age classes, playing times, typical helper duties) | a file in `sports/` | [docs/sports.md](docs/sports.md) |
| Another SMS provider | `modules/sms/worker/provider.ts` | `modules/sms/README.md` |
| A language or a better translation | `locales/` | [docs/translation.md](docs/translation.md) |
| A fix or improvement of the core | `worker/`, `src/`, `shared/` | this file, `docs/design.md` |

Start a module or connector with the generator; it creates the folder, registers it and adds a row in the docs, and `npm run check` passes right after:

```sh
npm run new -- module polls --label "Polls" --label-de "Umfragen"
npm run new -- connector nuliga --vendor "nuLiga" --domain nuliga.example --sport handball
npm run new -- sport basketball --name "Basketball" --name-de "Basketball"
npm run i18n && npm run check
```

New modules start as `status: "beta"`, switched off. Modules never change core files except through the hooks in `shared/module-api.ts`, `worker/module-api.ts` and `src/module-api.ts`; if your module needs a new hook, add it in its own pull request with a reason.

## Map

| Path | What |
| --- | --- |
| `worker/` | the API on Cloudflare Workers (Hono): `routes/` per area, `domain/` rules, `auth/` sign-in and permissions, `lib/` helpers, `cron.ts` hourly jobs, `chat/` and `duties/` Durable Objects |
| `src/` | the app (Preact): `pages/` screens, `ui.tsx` components, `styles.css` design system |
| `shared/` | types and rules used by worker and app (club profile, sports, module registry) |
| `modules/` | switchable modules, one folder each; `modules/index.ts` lists them |
| `migrations/` | D1 schema |
| `locales/` | translations (gettext `.po`, German entries filled from `locales/de/*.json`) |
| `test/` | Vitest in the Workers pool, incl. the contract tests every module and connector must pass |
| `e2e/` | Playwright tests against a local build with invented data |
| `docs/` | for clubs: install, operation, privacy; for contributors: modules, connectors, design, security, translation, decisions |

## Rules

**Platform**
- Cloudflare Developer Platform only: Workers with static assets, D1, KV, Durable Objects, Queues, Cron Triggers, Email Sending. Exceptions only where the club chooses them: its own SMTP server, an SMS provider, the fixture connectors it switches on.
- Code runs in the Workers runtime: Web Crypto instead of Node `crypto`, no libraries with Node dependencies. TypeScript.
- The D1 schema changes only through migrations that run safely for every club. Until the first release `migrations/0001_init.sql` is edited directly; after that every change is a new file named `YYYYMMDDHHMM_<area>_<what>.sql` ([migrations/README.md](migrations/README.md)).
- No secrets in code or in the repository. No club-specific data in code: names, domains, e-mail addresses, logos and texts of a club belong in the club profile (database).

**People and data**
- Check permissions on the server, with the helpers in `worker/auth/actor.ts` (`requireCoach`, `isCoachOf`, `isCoachOfAny`, `actsFor`, `requireAdmin`). Names and decline reasons leave the API only to coaches and admins of the team, unless a team switches on "responses visible to all" (then players and their parents see names and status, never reasons).
- Data minimisation: of players and parents only first name, last name, birth year. Exceptions: e-mail address on the account (sign-in, optional notifications, feedback reply), phone number only with the SMS module and only if the person enters it, optional profile picture (minors only with parental consent), the hidden "club member" marker (admins only). New personal data needs a reason in the pull request, the module's `privacy()` and an entry in `docs/privacy.md`.
- Most users are children: no tracking, no ads, no external scripts, fonts or images at runtime.
- Tests, fixtures, samples and the demo use invented names only.

**Code**
- Times are stored and computed as local time in the club's time zone (`worker/lib/time.ts`), not UTC.
- Every text a person reads goes through Lingui (`t`, `<Trans>`, plurals via ICU), English source, German translation in the same change (machine translations in `locales/de/*.ai.json`, marked `# ai`). Identifiers and comments in English. See [docs/translation.md](docs/translation.md).
- Keep D1 reads low: start queries from a candidate set, use indexes, page lists. `test/query-plans.test.ts` checks the hot queries.
- Match the surrounding code: its naming, comment density and idioms. Short comments that say why.

## Before you start

- Look for an issue first, or open one with the matching form (module idea, fixture connector, sport profile, bug). For a connector, the issue states the permitted access: official API, public export or the association's permission. No reading of HTML pages against the terms of use.
- Security problems never go into issues or pull requests: see [SECURITY.md](SECURITY.md).
- Changes to the core areas in `.github/CODEOWNERS` (sign-in, permissions, migrations, the module interfaces) are reviewed by the maintainer; keep them in their own pull request with a reason.

## Definition of done

- `npm run check` passes (typecheck, all tests including the module and connector contract tests, translations complete).
- New behaviour has a test; screens that change are covered by `npm run e2e` where it matters.
- The module's `README.md` and the docs say what it does and what it stores.
- One topic per pull request, with a short description of what changes for whom.

## Commands

Node.js 22 or newer.

| Purpose | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Local secrets (once) | `npm run secrets:generate -- --dev` |
| Local database with migrations and the invented demo club | `npm run db:reset:local` |
| Dev server | `npm run dev` (http://localhost:5173) |
| New module, connector or sport | `npm run new -- module <name> --label "…"` / `connector <name> --vendor "…" --domain …` / `sport <id> --name "…"` |
| Extract texts and fill German translations | `npm run i18n` |
| Typecheck, tests, translations | `npm run check` |
| End-to-end tests (Playwright) | `npm run e2e` |
| Screenshots of the demo club | `npm run screenshots` |

The first admin of a local installation signs in at `/einrichtung#<ADMIN_BOOTSTRAP_TOKEN>` (see `.dev.vars`).
