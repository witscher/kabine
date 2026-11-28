# Fixture connectors

A fixture connector brings a team's game schedule from an association's system into Kabine: handball4all and handball.net (Handball360) today; nuLiga, SAMS (volleyball), basketball-bund.net or others tomorrow. A connector is a module of kind `fixtures` (see [modules.md](modules.md)) that only knows its source. Linking, syncing (by button and by itself), halls, home and away, moved and cancelled games, results, the league table and the notifications are the same for every source and live in the core (`worker/domain/fixtures.ts`, `worker/domain/league-table.ts`, `worker/routes/games.ts`).

## One source per team

A club may switch on several sources (they form the group "Game schedule sources" under *Administration → Club*); each team takes its games from exactly one of them or from none (`teams.fixture_connector`, games by hand or from a table). With one source switched on, the coach only pastes the link; with several, the coach picks the source first. Changing or removing a team's source leaves its games as they are: they keep their `external_ref`, so they are neither changed nor cancelled by the new source, only no longer synced. Switching a source off for the club pauses the sync of its teams; their games stay, and the settings say how many teams are affected before saving. This follows from the kind `fixtures`, a connector needs nothing for it.

## Rules for sources

- **Only permitted access:** an official API, a public export (JSON, iCal, CSV) or written permission of the association. No reading of HTML pages against the terms of use, no getting around protection against automated access. Name the access and link the terms in the module's `README.md`.
- **Fair use:** syncs happen at the press of a button by a coach or admin, at most every `minIntervalMs` per team. A source whose terms allow it may also sync by itself (handball4all and handball.net do both):
  - every `autoSyncDays` (7 for both), for moved and new games, while the team has games ahead;
  - with `autoSyncResults`, after each game: once kick-off plus the age class's playing time plus an hour have passed (at most 7 days back) and the game has no result, at most twice per game and at least 3 hours apart (`events.result_tries`, `result_tried_at`, counted by every sync that does not bring the result).

  When a coach of the team opens the app and a sync is due, the coach's device syncs once in the background (`autoSync` in `GET /api/coach-hints`, `src/coach-hints.tsx`). Only coaches of the team trigger it, also admins who coach it; admins without a coach role never do, they would fetch for every team. The state lives on the team and the game, and the reservation (`fixture_claimed_at`, 10 minutes) is atomic, so several coaches cause one fetch, not one each. The server refuses a sync by itself that is not due (`not_due`), by someone who does not coach the team (`not_coach`) or for a source without these fields (`manual_only`), never fetches or schedules on its own, and a failure only stays as the team's sync error. Where a source syncs by itself, the button is a fallback for games moved or cancelled at short notice: coaches at most once an hour per team, admins as often as `minIntervalMs` allows. After 15 days without a sync (admins choose 15, 30, 60 or never under Administration → game schedule, `scheduleReminderDays` in the club profile), the coaches see a hint with that button at the top of the events list (`worker/domain/coach-hints.ts`), for every source. The same admin page lists every team with its source, last sync and error (`GET /api/admin/fixture-sync`).
- **Where it is fetched:** `fetchFrom: "worker"` when the source allows servers. `fetchFrom: "device"` when it only allows browsers (CORS) and the association agrees to that; the coach's device fetches without cookies or referrer and the server checks the data like anything else from a browser. Add the source's origin to `connect-src` in `public/_headers`, or the app's Content-Security-Policy blocks the fetch.
- **No personal data:** schedules carry teams, halls and results. If a source also lists players or referees, drop them in `parse`.

## What a connector contains

```
modules/<folder>/
  module.ts           defineModule({ kind: "fixtures", vendor: "<name>", sports: [...], status: "beta", defaultOn: false, privacy: () => null, ... })
  worker/connector.ts the FixtureConnector
  worker/index.ts     defineWorkerModule({ manifest, fixtures: connector })
  samples/links.json  links a coach would paste, with the source each one gives
  samples/*.json      recorded responses of the source (invented or public data only)
  test/*.test.ts      tests of anything special about the source
  README.md           the source, the kind of access, the terms, the samples' origin, how often it fetches
  README.de.md        the same for clubs in German
```

`FixtureConnector` ([`worker/module-api.ts`](../../worker/module-api.ts)):

| Member | Does |
| --- | --- |
| `name` | brand name of the source, the same as the manifest's `vendor` |
| `fetchFrom`, `minIntervalMs` | see the rules above |
| `autoSyncDays` | optional: sync by itself from a coach's device once the last sync is this many days old (see the rules above); leave it out for button-only sources |
| `autoSyncResults` | optional: also sync by itself after each game until its result is there (see the rules above); only for sources that deliver results |
| `format` | `"json"` (default) or `"text"`, how the response is read before `parse`, e.g. an iCal calendar (`modules/handballnet/`) |
| `linkField()` | label, hint and placeholder of the link field in *Team → Settings* (Lingui) |
| `parseLink(input)` | the team's settings at the source from a pasted link, or null; the first switched-on connector that recognises a link takes it |
| `describe(source)` | short text for the coach, e.g. "Association 216, league 555, team 999" |
| `request(source)` | URL (and headers) to fetch |
| `parse(data, source)` | the games as `FixtureGame` (id, number, date, time, home, guest, venue, goals), and the league table as `table` if the same response carries one (rows with position, team, games, won/drawn/lost, goals, plus and minus points, the linked team's row marked `own`); throw `FixtureFormatError` with a readable reason when the data does not fit, e.g. belongs to another league |
| `tableUrl(source)` | optional link to the league table at the source |

## What the core does with a sync

- **Games:** new ones are created, moved ones updated, future games of the team alone that are no longer delivered count as cancelled ("no longer in the schedule"), and come back if they reappear. Fields coaches maintain (meeting point, notes) are never overwritten.
- **Pushes**, the same by button or by itself, in each recipient's language: a move to the team (players, parents, staff) and to the coaches with old and new time; a game no longer in the schedule and one back in it to the team and the coaches, naming the source, because games sometimes vanish there only for a while; fans of the game (fans module, hook `eventChanged`) at short notice; new games only to the coaches, and not on a team's first sync. Results come without a push.
- **League table:** stored per team (`league_tables`, the rows as JSON with the league name, the source's note and the time of the sync) without an extra fetch; checked again before it is stored (at most 40 rows, numbers only), kept when a response has none, deleted when the team's source changes and at the season change. Shown collapsed on the game page and on the fan game page (`src/league-table.tsx`) to everyone who sees the game, since it is public data of the source. `teamsWithLeagueTable` / `hasLeagueTable` (`worker/domain/league-table.ts`) tell whether a team's league has a table.

The core stores games with `events.external_ref = "<module id>:<game id>"` and halls with `locations.external_ref`, so ids only have to be unique within a source.

## Samples and the contract test

`test/fixtures-contract.test.ts` runs for every connector: every link in `samples/links.json` must give its source, other links must give null, every recorded response must parse into valid games (dates `YYYY-MM-DD`, times `HH:MM`, unique ids, names) and, if it carries a table, into rows the core keeps as they are, and the texts must be there. Record a real response of a public schedule, replace anything personal, and keep it small (a few games are enough). Live tickers or game reports of a source are app links of the module (`gameLinks`, see `modules/handball4all/app/`).

## Adding one, step by step

1. Ask the association or check the documentation for a permitted access; note it for the README.
2. Copy the structure above (or use the generator, see `AGENTS.md`), `status: "beta"`, `defaultOn: false`.
3. Write `parseLink`, `request`, `parse`, record samples, run `npm run check`.
4. If the sport has no profile yet, add one first (`npm run new -- sport <id>`, see [sports.md](sports.md)); the connector names its sports in its manifest (`sports`).
