# Modules and extension points

Kabine has a small base (events, responses, squads, chat, push) and **modules** a club switches on or off under *Administration → Club → Modules*. Switched off, a module disappears from the navigation and its API paths answer 404. Everything that is not a module (sports, languages, SMS and mail providers, fixture connectors) has its own extension point, listed below. Contributions are welcome as pull requests: start with [CONTRIBUTING.md](../CONTRIBUTING.md).

## Where to find things

| What | Where |
| --- | --- |
| Registry of all modules (id, default, dependency, API paths) | [`shared/modules.ts`](../shared/modules.ts) |
| Switch texts in administration | [`shared/module-texts.ts`](../shared/module-texts.ts) |
| Setup wizard step "Functions" | uses the same registry, nothing to add |
| Sport profiles (age classes, playing times, helper duties) | [`shared/sports.ts`](../shared/sports.ts) |
| SMS provider adapter | [`worker/lib/sms.ts`](../worker/lib/sms.ts) |
| Mail adapters (Cloudflare Email Sending, SMTP) | `worker/domain/mail.ts`, `worker/lib/smtp.ts` |
| Fixture connector (handball4all) | `worker/domain/h4a.ts`, `worker/routes/games.ts`, `worker/routes/game-import.ts` |
| Languages | [`docs/translation.md`](translation.md) |

## The modules

<!-- Every module of shared/modules.ts needs a row; test/modules.test.ts checks it. -->

| Id | Switch | Default | Code |
| --- | --- | --- | --- |
| `duties` | Helper duties | on | `worker/routes/duties.ts`, `worker/domain/duties.ts`, `worker/domain/duty-notify.ts`, `worker/duties/hub.ts`, `src/pages/helpers.tsx`, `src/pages/duty-admin.tsx` |
| `youthReferees` | Youth referees (needs `duties`) | on | `worker/routes/referees.ts`, `src/pages/referees.tsx` |
| `carpools` | Carpools | on | `worker/routes/carpool.ts`, `worker/domain/carpool.ts`, `src/carpool.tsx` |
| `handball4all` | Game schedule from handball4all | on | `worker/domain/h4a.ts`, `worker/routes/games.ts`, `src/pages/games.tsx` |
| `sms` | SMS | off | `worker/routes/sms.ts`, `worker/domain/sms.ts`, `worker/lib/sms.ts`, `src/pages/sms-settings.tsx` |

## Adding a module

1. **Register it** in `shared/modules.ts`: `id` (camelCase, never renamed later, clubs store it), `defaultOn`, optional `requires`, and the regular expressions of its API paths. The first matching module wins, so a module nested inside the paths of another comes first.
2. **Write its switch text** in `shared/module-texts.ts`. TypeScript fails until every module has one. Add the German translation in the same change (`npm run i18n`, see [translation.md](translation.md)).
3. **Put its code under the paths you registered.** Routes live in `worker/routes/<name>.ts` and are added in `worker/index.ts`. The paths are blocked centrally while the module is off, so the routes need no check of their own. Data that leaves the API through other routes (for example in the session or in an event) must be left out with `isModuleOn("<id>")` (worker) or `useModule("<id>")` (app); see how `carpools` does it in `worker/domain/carpool.ts` and `src/club.tsx`.
4. **Menu entries** of the app are shown only when `moduleOn(club.modules, "<id>")` (see `src/pages/admin.tsx`).
5. **Schema changes** are a new file in `migrations/` (never edit an applied one) that runs safely for every club.
6. **Tests:** an API test that the module works when on and answers 404 when off (copy `test/modules.test.ts`), plus tests for its own logic. Use invented names only.
7. **Docs:** a row in the table above, a line in the README under "Was die App kann" / "What it does", and, if it stores personal data, `docs/privacy.md` and `docs/privacy.de.md`.

`npm run check` and `npm run i18n:check` must pass.

## Other extension points

- **Sport:** add an entry to `SPORTS` in `shared/sports.ts` (age classes, playing times, duty types and templates) and its id to `SportId` and the schema in `worker/routes/club.ts`. No module needed.
- **SMS provider:** extend `SmsConfig.provider` and `sendSms` in `worker/lib/sms.ts`, and offer the provider in `src/pages/sms-settings.tsx`.
- **Fixture connector** for another league system (nuLiga, SAMS, …): a connector is a module. Register it, read the schedule into the same game shape as `worker/domain/h4a.ts` (`H4aGame`), and reuse the import preview of `worker/routes/game-import.ts`. Connectors that need API access from an association are welcome once access exists.
- **Language:** see [translation.md](translation.md).

## Rules every contribution follows

The rules of [CONTRIBUTING.md](../CONTRIBUTING.md) apply: Cloudflare Developer Platform only (no Node-only libraries), permissions checked on the server, data minimisation, fonts and resources self-hosted, English source with a German translation, invented names in tests and fixtures.
