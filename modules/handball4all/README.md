# handball4all

Game schedules of the German handball associations from [handball4all](https://www.handball4all.de). A coach pastes the link of the team's page in the association's portal; the app reads association (`ogId`), league (`lId`) and team (`tId`) from it.

- **Access:** the public JSON interface that the portals themselves use (`spo.handball4all.de/service/if_g_json.php`). It is protected against automated access and allows browsers (CORS), so the coach's device fetches it (`fetchFrom: "device"`). The server never calls handball4all.
- **When:** by itself on the device of a coach of the team when the app is opened, after each game until its result is there (at most twice per game, 3 hours apart, `autoSyncResults`) and once a week (`autoSyncDays: 7`), the club's wish since November 2026 (`docs/dev/decisions.md`). So handball4all gets at most a fetch or two per game and one a week per team, and no coach can make the app fetch on purpose. The button stays for games moved or cancelled at short notice: coaches at most once an hour per team, admins at most every 10 minutes. Rules in `docs/dev/connectors.md`.
- **Data:** games, halls, results and the league table (`content.score`, with `scoreComments` as the note) of the league. No personal data. The table comes with the schedule, no extra fetch.
- **Links in the app:** league table, live ticker while a game is played and the game report afterwards (`app/live.tsx`); both are looked up only when tapped, from the device, without cookies or referrer.
- **Samples:** `samples/schedule.json` is an invented response in the format of the interface; `samples/links.json` holds a portal link and an API link.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/connector.ts` | links, request, parsing (`parseSchedule`, `parseTable`), league check |
| `worker/index.ts` | registers the connector |
| `app/index.tsx`, `app/live.tsx` | live ticker and game report buttons |
| `test/handball4all.test.ts` | parsing, matchdays, sync, reservation, foreign games |
