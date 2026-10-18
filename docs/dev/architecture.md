# Architecture

How the parts of Kabine fit together, for contributors who want to know where a request goes before they change something. Rules and commands: [AGENTS.md](../../AGENTS.md). Why things behave as they do: [design.md](design.md) and [decisions.md](decisions.md).

## One installation, one club

Every club deploys its own copy into its own Cloudflare account: one Worker with static assets, one D1 database, one KV namespace, one queue, two Durable Object classes. There is no shared server and no tenant column; code may assume exactly one club. The club profile (name, colours, region, time zone, sport, modules) lives in the database (`app_meta`, `worker/domain/club.ts`) and is loaded at the start of every request and cron run.

```
browser (PWA, Preact)  ──HTTP /api/*──▶  Worker (Hono)  ──▶  D1 (all data)
        │                                   │  ├──▶  KV (logo, maintenance switch, rate counters)
        │                                   │  ├──▶  Queue ──▶ Worker queue handler ──▶ Web Push
        └──WebSocket──────────────────────▶ │  ├──▶  Durable Object ChatRoom (one per team, EU jurisdiction)
                                            │  └──▶  Durable Object DutyHub (live helper plan)
                    Cron (hourly) ─────────▶ │
```

## A request through the worker

`worker/index.ts` builds the app and mounts the routes of the core (`worker/routes/`) and of every module (`modules/<id>/worker/`). The middleware in `worker/app.ts` runs first, in this order:

1. Fill missing keys (`ensureInstanceSecrets`) and load the club profile (`enterClubContext`).
2. Pick the language: the account's, else the app's header, else the club default (`worker/i18n.ts`). Server texts are rendered in it; texts for others (push, mail) in the recipient's language.
3. CSRF: write requests and WebSockets must come from the app's own origin.
4. Session cookie → `Actor` (`worker/auth/actor.ts`): the person, their teams and roles, children, admin flag. Every permission check uses the actor and the helpers next to it (`requireCoach`, `isCoachOf`, `actsFor`, `requireAdmin`).
5. Maintenance mode (only admins get through) and admin views (`worker/auth/view-as.ts`, read-only).
6. Module gate: a path that belongs to a switched-off module answers 404 (`moduleOfPath`, from the manifests).

Routes validate input with Zod (`worker/lib/http.ts`), query D1 through the thin helpers in `worker/lib/db.ts`, and keep rules in `worker/domain/`. Lists start from a candidate set and use indexes; `test/query-plans.test.ts` checks the hot queries.

## Time

Events are stored as local wall-clock time of the club's time zone (`YYYY-MM-DDTHH:MM`), not UTC. `worker/lib/time.ts` converts to instants only where "now" is compared (deadlines, reminders). Trainings are generated from training plans (`worker/domain/generate.ts`) for the weeks ahead, skipping public holidays of the club's region.

## Sign-in

Passkeys (WebAuthn, `worker/auth/webauthn.ts`) are the main way in. People get access through personal or team invitation links (`worker/routes/join.ts`); the first admin uses the setup link with `ADMIN_BOOTSTRAP_TOKEN`. Optional fallbacks: a code by e-mail, or by SMS with the SMS module. Sessions are random tokens, stored hashed (`worker/auth/session.ts`).

## Background work

- **Cron** (`worker/cron.ts`, hourly): generate events, sync automatic squads, reminders, attendance, cleanup at 3:00, plus the `cron` hook of every module that is on.
- **Notifications** (`worker/domain/notify.ts`): decide who gets what (topics, per-person settings, parents for children) and put push jobs on the queue; `worker/queue.ts` sends them with Web Push (VAPID). E-mail goes through `worker/domain/mail.ts` (Cloudflare Email Sending or the club's SMTP server).
- **Durable Objects**: `ChatRoom` (`worker/chat/room.ts`) keeps one team chat in SQLite storage and pushes messages over WebSockets; `DutyHub` (`worker/duties/hub.ts`, exported from `worker/index.ts` because Wrangler binds it) broadcasts live changes of the helper plan.

## The app

`src/main.tsx` starts a Preact app with `preact-iso` routing (`src/app.tsx`). Pages load lazily (`lazyPage` in `src/update.tsx`); data comes through `useQuery` with a small cache (`src/store.ts`) that also serves the last state offline, together with the service worker (`public/sw.js`). `src/update.tsx` compares the build with `/version.json` and offers a reload when a new version is deployed. Texts go through Lingui (`src/i18n.ts`, catalogs in `locales/`).

## Modules

A module is a folder `modules/<name>/` with a manifest (`module.ts`), an optional worker part and an optional app part. The core never imports a module directly: `worker/modules.ts` and `src/modules.ts` collect them, and the core calls their hooks at fixed places.

| Hook (worker) | Called from |
| --- | --- |
| `routes` | `worker/index.ts`, behind the module gate |
| `cron` | `worker/cron.ts` |
| `eventSummaries`, `eventDetail` | event list and detail (`worker/routes/events.ts`, `worker/domain/event-page.ts`), as `modules.<id>` in the response |
| `participantsLeft`, `participantsDropped` | declines, squad changes, stand-ins, automatic squads |
| `personLeaves`, `exportTables` | leaving the club and the data export (`worker/routes/season.ts`) |
| `texts`, `fixtures` | SMS provider, fixture connector |

| Hook (app) | Shown in |
| --- | --- |
| `routes`, `tab`, `adminMenu` | router, tab bar, administration menu |
| `eventCardLine`, `gameLinks`, `eventSection` | event cards on the start page, the event page |

Data hooks only run while the module is on; cleanup hooks always run. The full contract and how to add a module: [modules.md](modules.md). Game schedule sources are modules of kind `fixtures` with a connector; the core does the linking and syncing (`worker/domain/fixtures.ts`): [connectors.md](connectors.md). Sports are data files in `sports/`: [sports.md](sports.md).

## Tests

- `test/` and `modules/*/test/`: Vitest in the Workers pool (`@cloudflare/vitest-pool-workers`), against a fresh D1 per test file. API tests go through the real app (`test/helpers.ts`: `freshDb`, `loginAs`, `api`).
- Contract tests (`test/modules-contract.test.ts`, `test/fixtures-contract.test.ts`, `test/sports-contract.test.ts`) run for every module, connector and sport, including the ones added later.
- `e2e/`: Playwright against a local build with its own database and invented data. `screenshots/`: the README pictures, from the demo club.
