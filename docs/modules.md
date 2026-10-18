# Modules and extension points

Kabine has a small core (events, responses, squads, chat, push) and **modules** a club switches on or off under *Administration → Club → Modules*. A module lives in one folder, `modules/<id>/`. While it is off, it disappears from the app and its API paths answer 404. Contributions are welcome as pull requests: start with [CONTRIBUTING.md](../CONTRIBUTING.md).

## A module folder

```
modules/carpools/
  module.ts          manifest: id, kind, status, default, dependency, sports, API paths, texts, privacy
  types.ts           API shapes shared by worker and app (optional)
  worker/index.ts    worker part: routes and hooks (optional)
  worker/*.ts        the module's own worker code
  app/index.tsx      app part: pages and the places it shows up in core screens (optional)
  app/*.tsx, *.css   the module's own app code and styles
  test/*.test.ts     tests (Vitest in the Workers pool)
  README.md          what it does, for whom, what it stores
```

`modules/index.ts` lists the manifests, one line per module. The worker and app parts are found by the build (`import.meta.glob`), so nothing else in the core needs to change. Code in `worker/` may only import from the worker, `shared/` and the module itself; code in `app/` only from `src/`, `shared/` and the module itself.

### Manifest (`module.ts`, [`shared/module-api.ts`](../shared/module-api.ts))

| Field | Meaning |
| --- | --- |
| `id` | Key in the club profile, camelCase. Never rename it: clubs have it stored. |
| `kind` | `feature`, `fixtures` (game schedules from an association's system) or `provider` (a paid service outside Cloudflare). |
| `status` | `stable`, or `beta`: off by default and marked “Beta” in the settings. New modules start as `beta`. |
| `defaultOn`, `requires`, `sports` | State for a new club, a module it needs, the sports it is offered for. |
| `paths` | Regular expressions of its API paths. The core answers 404 for them while the module is off. |
| `label()`, `description()` | Switch text in administration (Lingui, English with German translation). |
| `privacy()` | What it stores about people, who sees it, when it is deleted; shown on every installation's privacy page. `null` if it stores no personal data. |
| `notificationTopics` | Topics people can switch off under *Profile → Notifications*. |

### Worker part (`worker/index.ts`, [`worker/module-api.ts`](../worker/module-api.ts))

| Hook | Called | Runs while off |
| --- | --- | --- |
| `routes` | Hono routes, mounted under `/api` | no (404) |
| `cron(env, now)` | every hour (`worker/cron.ts`) | no |
| `eventSummaries` | event lists, data lands in `event.modules[<id>]` | no |
| `eventDetail` | event page, data lands in `event.modules[<id>]` | no |
| `participantsLeft` | someone declined or was removed from the squad | no |
| `participantsDropped` | SQL cleanup in the core's batch (automatic squads, withdrawn stand-ins) | yes |
| `personLeaves` | SQL cleanup when someone leaves the club | yes |
| `exportTables` | the module's tables in the admin's data export | yes |

### App part (`app/index.tsx`, [`src/module-api.ts`](../src/module-api.ts))

| Hook | Shows |
| --- | --- |
| `routes` | own pages (lazy with `lazyPage` from `src/update.tsx`) |
| `eventCardLine` | a line on event cards on the start page |
| `eventSection` | a section on the event page |

[`modules/carpools/`](../modules/carpools/) uses all of the event hooks and is the reference module.

## The modules

<!-- Every module of modules/index.ts needs a row; test/modules-contract.test.ts checks it. -->

| Id | Switch | Default | Code |
| --- | --- | --- | --- |
| `duties` | Helper duties | on | `worker/routes/duties.ts`, `worker/domain/duties.ts`, `worker/domain/duty-notify.ts`, `worker/duties/hub.ts`, `src/pages/helpers.tsx`, `src/pages/duty-admin.tsx` (moving to `modules/duties/`) |
| `youthReferees` | Youth referees (needs `duties`) | on | `worker/routes/referees.ts`, `src/pages/referees.tsx` (moving to `modules/youth-referees/`) |
| `carpools` | Carpools | on | `modules/carpools/` |
| `handball4all` | Game schedule from handball4all | on | `worker/domain/h4a.ts`, `worker/routes/games.ts`, `src/pages/games.tsx` (moving to `modules/handball4all/`) |
| `sms` | SMS | off | `worker/routes/sms.ts`, `worker/domain/sms.ts`, `worker/lib/sms.ts`, `src/pages/sms-settings.tsx` (moving to `modules/sms/`) |

## Adding a module

1. Create `modules/<folder>/module.ts` with `defineModule({...})`, `status: "beta"`, `defaultOn: false`, and add the import to `modules/index.ts`.
2. Put routes and hooks in `worker/index.ts` (`defineWorkerModule`), screens in `app/index.tsx` (`defineAppModule`). Every route path must match the manifest's `paths`; the contract test checks that and that each route answers 404 while the module is off.
3. Check permissions on the server with the helpers in `worker/auth/actor.ts` (`requireCoach`, `isCoachOf`, `actsFor`, `requireAdmin`). Names and decline reasons only go to coaches and admins of the team.
4. Schema changes are a new file in `migrations/` that runs safely for every club. List the module's tables in `exportTables` and clean them up in `personLeaves` (and `participantsDropped` if they hang on participants).
5. Texts through Lingui, then `npm run i18n` and the German translation (see [translation.md](translation.md)).
6. Tests in `test/`, invented names only. `test/modules-contract.test.ts` runs for every module.
7. A row in the table above and a `README.md` in the folder.

`npm run check` and `npm run i18n:check` must pass.

## Other extension points

- **Sport:** see `shared/sports.ts` (age classes, playing times, duty types and templates).
- **SMS provider:** `worker/lib/sms.ts`.
- **Fixture connector** for another league system (handball360, nuLiga, SAMS, …): only through permitted access (official API, public export or the association's permission). The connector interface is being built on handball4all.
- **Language:** see [translation.md](translation.md).
