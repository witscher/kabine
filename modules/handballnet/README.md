# handball.net

Game schedules of the German handball associations that run their games in Handball360, from [handball.net](https://www.handball.net) (operated by the Deutscher Handballbund). It works like the handball4all module: a coach pastes the link of the team's page (`https://www.handball.net/team/<id>?…`) or of its calendar (`webcal://www.handball.net/kalender/team/<id>.ics`), and from then on the team's games, halls and results come into Kabine by themselves. Switched on by default for handball clubs, like handball4all.

- **Access:** the public calendar subscription that handball.net offers for every team ("Kalender abonnieren" on the team page, `https://www.handball.net/kalender/team/<id>.ics`). It is meant for calendar apps (it announces a refresh every 6 hours) and allows browsers (`Access-Control-Allow-Origin: *`). The internal interface of the website (`/api/new/…`) is closed to other sites and is not used. Terms of use: [handball.net](https://www.handball.net/nutzungsbedingungen).
- **Checked on the server:** the calendar is read as text (`format: "text"`) and every game must name the calendar's team.
- **Data:** per game the id, game number, date and kick-off (local time), home and guest, hall with address, result. The calendar has no league table. Games without a time (00:00) are skipped, cancelled games (`STATUS:CANCELLED`) are left out, so Kabine cancels them. No personal data.
- **Links in the app:** the game's page on handball.net (live ticker, report, result) and the team's page as the table; plain links, nothing is fetched.
- **Samples:** `samples/schedule.json` is an invented calendar (as a JSON string) in the format of handball.net, `samples/links.json` holds a team link, a calendar link and an old team link.

Open: a team in several leagues may show all of them in one calendar; whether the team id stays the same in the next season is not known yet.

## How the sync works

- **In the coach's browser, not on the server.** The app on the phone or computer of a coach of the team fetches the team's calendar, one request, like a calendar app on the phone, and hands it to the club's server, which checks it. The server has no timer that fetches and never calls handball.net itself.
- **Once a week**, when a coach of the team opens the app and the last sync is 7 days or more ago (`autoSyncDays: 7`), for moved and new games. Only while the team has games ahead; after the last game of the season it stops.
- **After a game without a result:** once kick-off plus the age group's playing time plus an hour have passed, at most twice per game and at least 3 hours apart (`autoSyncResults`). Then it waits for the next game. Any sync also counts as the weekly one, so in a week with a game there is usually only the one after the game.
- **The button** ("Sync now") is for games moved or cancelled at short notice: coaches at most once an hour per team, admins at most every 10 minutes per team.
- **Several coaches cause one fetch, not one each.** Whether a sync is due is stored on the team and the game, and one device at a time gets a reservation for 10 minutes (`fixture_claimed_at`); the server refuses a sync by itself that is not due yet. Admins without a coach role never trigger it, or they would fetch for every team.
- **When it fails,** the error shows under *Team → Settings* and *Administration → Game schedules*, and the next start of the app by a coach tries again. There is no alert and no retry loop. If no coach opens the app for a while, nothing is fetched; the next one who does syncs.

The rules are the same for every source that syncs by itself (`docs/dev/connectors.md`, `worker/domain/fixtures.ts`).

## How much it fetches

Very little. Each sync is **one request** for one team's calendar, the file handball.net offers for subscribing.

- **Per team and week in the season:** usually one request (after the game, or the weekly one). At most one weekly request plus two per game, and only when a coach opens the app.
- **A large club with 50 teams** causes about **50 requests a week**, plus a few when results come in late, spread over the week by when coaches open the app. A small club with 10 teams: about 10.
- **For comparison:** one person who subscribes to the same calendar in a calendar app fetches it every 6 hours, about 28 times a week. Kabine fetches a team's calendar about once a week, for the whole team.
- **Links** to the game's page and the team's page are plain links: handball.net sees a visit only when someone taps one.
- **Outside the season,** once every game is played, nothing is fetched by itself.

That is far from automated scraping: no crawler, no server fetching on a timer, no reading of web pages, and only the calendar handball.net publishes for subscribing.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/connector.ts` | links, calendar URL, iCal parsing (`parseCalendar`), team check |
| `worker/index.ts` | registers the connector |
| `app/index.tsx` | link to the game on handball.net |
| `samples/` | links and an invented calendar for test/fixtures-contract.test.ts |
| `test/handballnet.test.ts` | links, parsing, sync, device fetch as text, weekly sync by itself |
