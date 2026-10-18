# Kabine

Free team app for sports clubs. Events with yes/no responses, squad nominations, team chat, push notifications, helper duties, carpools and passkey login, as an installable web app (PWA) for players, parents and coaches.

Each club runs its own installation in its own Cloudflare account. The free plan is enough for a typical club.

> Status: in development. The deploy button and the setup wizard follow with the first release (see `docs/plan.md`).

## Features

- Events: trainings generated from training plans, games, special events; yes/no with reason, visible to coaches only.
- Squads: nominations for games, core squad, guest players from other teams.
- Team chat with mentions and announcements, in real time.
- Push notifications on all devices, including iPhone (installed app).
- Parent accounts with consent for minors, profile pictures only with parental approval.
- Helper duties for home games and special events, carpools for away games.
- Calendar feed per person, data export for backups, season change with preview.
- Data minimisation: of players and parents only first name, last name and birth year.

## Development

Node.js 22 or newer.

```sh
npm ci
npm run secrets:generate -- --dev   # local secrets in .dev.vars
npm run db:reset:local              # local database with invented demo data
npm run dev                         # http://localhost:5173
npm run check                       # typecheck and tests
npm run e2e                         # end-to-end tests (Playwright)
```

The first admin is set up at `/einrichtung#<ADMIN_BOOTSTRAP_TOKEN>` (see `.dev.vars`).

## Licence

AGPL-3.0-only, see `LICENSE`. If you run a changed version for others, you must offer them its source code.
