# handball4all

Game schedules of the German handball associations from [handball4all](https://www.handball4all.de). A coach pastes the link of the team's page in the association's portal; the app reads association (`ogId`), league (`lId`) and team (`tId`) from it, and from then on the team's games, halls, results and the league table come into Kabine by themselves.

- **Access:** the public JSON interface that the portals themselves use (`spo.handball4all.de/service/if_g_json.php`). It is protected against automated access and allows browsers (CORS), so the coach's device fetches it (`fetchFrom: "device"`), like the portal page in a browser. The server never calls handball4all.
- **Data:** games, halls, results and the league table (`content.score`, with `scoreComments` as the note) of the league. No personal data. The table comes with the schedule, no extra fetch.
- **Links in the app:** league table, live ticker while a game is played and the game report afterwards (`app/live.tsx`); both are looked up only when tapped, from the device, without cookies or referrer.
- **Samples:** `samples/schedule.json` is an invented response in the format of the interface; `samples/links.json` holds a portal link and an API link.

## Linking a team

A coach of the team or an admin copies the address of the team's page in the association's portal once:

1. Open the portal of the association on handball4all.de (the association's website links to it, usually from its game schedules or results), choose the league, then the team, for example by tapping its name in the table.
2. Copy the address from the browser's address bar. It looks like this, with the association's portal name and three numbers (the ones here are invented):

   `https://www.handball4all.de/home/portal/example-hv#/league?ogId=123&lId=45678&tId=901234`

   What counts are the three numbers: `ogId` (association), `lId` (league) and `tId` (team), behind `#` or `?`. A link of the league without `tId` is not enough. Any address on handball4all.de with these numbers works, also the interface link `https://spo.handball4all.de/service/if_g_json.php?cmd=ps&og=123&cl=45678&ct=901234`.
3. In Kabine open *Team → Settings → Game schedule*, paste it into *Link from the handball4all portal* (with several sources switched on, choose *handball4all* as the source first), tap *Link schedule* and then *Sync now*.

A team in a new league (for example after the season change) gets the new link the same way.

## How the sync works

- **In the coach's browser, not on the server.** The app on the phone or computer of a coach of the team fetches the team's schedule, one request, and hands it to the club's server, which checks it like anything else from a browser. The server has no timer that fetches and never calls handball4all itself.
- **Once a week**, when a coach of the team opens the app and the last sync is 7 days or more ago (`autoSyncDays: 7`), for moved and new games. Only while the team has games ahead; after the last game of the season it stops.
- **After a game without a result:** once kick-off plus the age group's playing time plus an hour have passed, at most twice per game and at least 3 hours apart (`autoSyncResults`). Then it waits for the next game. Any sync also counts as the weekly one, so in a week with a game there is usually only the one after the game.
- **The button** ("Sync now") is for games moved or cancelled at short notice: coaches at most once an hour per team, admins at most every 10 minutes per team.
- **Several coaches cause one fetch, not one each.** Whether a sync is due is stored on the team and the game, and one device at a time gets a reservation for 10 minutes (`fixture_claimed_at`). Admins without a coach role never trigger the sync by themselves, or they would fetch for every team.
- **When it fails** (the interface is not reachable), the error shows under *Team → Settings* and *Administration → Game schedules*, and the next start of the app by a coach tries again. There is no alert and no retry loop.

The rules are the same for every source that syncs by itself (`docs/dev/connectors.md`, `worker/domain/fixtures.ts`). They were the club's wish in November 2026 (`docs/dev/decisions.md`); before that, handball4all synced only at the press of a button.

## How much it fetches

Very little. Each sync is **one request** for one team: the same JSON a browser loads when someone opens the team's page in the portal.

- **Per team and week in the season:** usually one request (after the game, or the weekly one). At most one weekly request plus two per game, and only when a coach opens the app. Results that are there on the first try need no second one.
- **A large club with 50 teams** causes about **50 requests a week**, plus a few when results come in late, spread over the week by when coaches open the app. A small club with 10 teams: about 10.
- **Live ticker and game report:** when someone taps the button, their device loads the team's schedule once to find the game's ticker or report and opens it. Nothing is fetched without a tap, and nothing polls.
- **Outside the season,** once every game is played, nothing is fetched by itself.

That is far from automated scraping: no crawler, no server fetching on a timer, no fetching of other teams or leagues, and about as much traffic per team as one person who looks at the team's page in the portal once a week.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/connector.ts` | links, request, parsing (`parseSchedule`, `parseTable`), league check |
| `worker/index.ts` | registers the connector |
| `app/index.tsx`, `app/live.tsx` | live ticker and game report buttons |
| `test/handball4all.test.ts` | parsing, matchdays, sync, reservation, foreign games |
