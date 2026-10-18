# Fixture connectors

A fixture connector brings a team's game schedule from an association's system into Kabine: handball4all today; handball360, nuLiga, SAMS (volleyball), basketball-bund.net or others tomorrow. A connector is a module of kind `fixtures` (see [modules.md](modules.md)) that only knows its source. Linking, syncing, halls, home and away, moved and cancelled games and the notifications are the same for every source and live in the core (`worker/domain/fixtures.ts`, `worker/routes/games.ts`).

## One source per team

A club may switch on several sources (they form the group "Game schedule sources" under *Administration → Club*); each team takes its games from exactly one of them or from none (`teams.fixture_connector`, games by hand or from a table). With one source switched on, the coach only pastes the link; with several, the coach picks the source first. Changing or removing a team's source leaves its games as they are: they keep their `external_ref`, so they are neither changed nor cancelled by the new source, only no longer synced. Switching a source off for the club pauses the sync of its teams; their games stay, and the settings say how many teams are affected before saving. This follows from the kind `fixtures`, a connector needs nothing for it.

## Rules for sources

- **Only permitted access:** an official API, a public export (JSON, iCal, CSV) or written permission of the association. No reading of HTML pages against the terms of use, no getting around protection against automated access. Name the access and link the terms in the module's `README.md`.
- **Fair use:** syncs happen at the press of a button by a coach or admin, never automatically, at most every `minIntervalMs` per team.
- **Where it is fetched:** `fetchFrom: "worker"` when the source allows servers. `fetchFrom: "device"` when it only allows browsers (CORS) and the association agrees to that; the coach's device fetches without cookies or referrer and the server checks the data like anything else from a browser.
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
  README.md           the source, the kind of access, the terms, the samples' origin
```

`FixtureConnector` ([`worker/module-api.ts`](../worker/module-api.ts)):

| Member | Does |
| --- | --- |
| `name` | brand name of the source, the same as the manifest's `vendor` |
| `fetchFrom`, `minIntervalMs` | see the rules above |
| `linkField()` | label, hint and placeholder of the link field in *Team → Settings* (Lingui) |
| `parseLink(input)` | the team's settings at the source from a pasted link, or null; the first switched-on connector that recognises a link takes it |
| `describe(source)` | short text for the coach, e.g. "Association 216, league 555, team 999" |
| `request(source)` | URL (and headers) to fetch |
| `parse(data, source)` | the games as `FixtureGame` (id, number, date, time, home, guest, venue, goals); throw `FixtureFormatError` with a readable reason when the data does not fit, e.g. belongs to another league |
| `tableUrl(source)` | optional link to the league table |

The core stores games with `events.external_ref = "<module id>:<game id>"` and halls with `locations.external_ref`, so ids only have to be unique within a source.

## Samples and the contract test

`test/fixtures-contract.test.ts` runs for every connector: every link in `samples/links.json` must give its source, other links must give null, every recorded response must parse into valid games (dates `YYYY-MM-DD`, times `HH:MM`, unique ids, names), and the texts must be there. Record a real response of a public schedule, replace anything personal, and keep it small (a few games are enough). Live tickers or game reports of a source are app links of the module (`gameLinks`, see `modules/handball4all/app/`).

## Adding one, step by step

1. Ask the association or check the documentation for a permitted access; note it for the README.
2. Copy the structure above (or use the generator, see `AGENTS.md`), `status: "beta"`, `defaultOn: false`.
3. Write `parseLink`, `request`, `parse`, record samples, run `npm run check`.
4. If the sport has no profile yet, add one first (`npm run new -- sport <id>`, see [sports.md](sports.md)); the connector names its sports in its manifest (`sports`).
