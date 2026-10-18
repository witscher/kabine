# handball4all

Game schedules of the German handball associations from [handball4all](https://www.handball4all.de). A coach pastes the link of the team's page in the association's portal; the app reads association (`ogId`), league (`lId`) and team (`tId`) from it.

- **Access:** the public JSON interface that the portals themselves use (`spo.handball4all.de/service/if_g_json.php`). It is protected against automated access and allows browsers (CORS), so the coach's device fetches it (`fetchFrom: "device"`), only at the press of a button and at most every 10 minutes per team. The server never calls handball4all.
- **Data:** games, halls, results of the league. No personal data.
- **Links in the app:** league table, live ticker while a game is played and the game report afterwards (`app/live.tsx`); both are looked up only when tapped, from the device, without cookies or referrer.
- **Samples:** `samples/schedule.json` is an invented response in the format of the interface; `samples/links.json` holds a portal link and an API link.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/connector.ts` | links, request, parsing (`parseSchedule`), league check |
| `worker/index.ts` | registers the connector |
| `app/index.tsx`, `app/live.tsx` | live ticker and game report buttons |
| `test/handball4all.test.ts` | parsing, matchdays, sync, reservation, foreign games |
