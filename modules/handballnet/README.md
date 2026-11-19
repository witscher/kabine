# handball.net

Game schedules of the German handball associations that run their games in Handball360, from [handball.net](https://www.handball.net) (operated by the Deutscher Handballbund). It works like the handball4all module: a coach pastes the link of the team's page (`https://www.handball.net/team/<id>?…`) or of its calendar (`webcal://www.handball.net/kalender/team/<id>.ics`), and syncs at the press of a button.

- **Access:** the public calendar subscription that handball.net offers for every team ("Kalender abonnieren" on the team page, `https://www.handball.net/kalender/team/<id>.ics`). It is meant for calendar apps (it announces a refresh every 6 hours) and allows browsers (`Access-Control-Allow-Origin: *`). The internal interface of the website (`/api/new/…`) is closed to other sites and is not used. Terms of use: [handball.net](https://www.handball.net/nutzungsbedingungen).
- **Fetched by:** the coach's or admin's device (`fetchFrom: "device"`), like a calendar app on the phone, only at the press of a button and at most every 10 minutes per team. The server never calls handball.net. The calendar is read as text (`format: "text"`) and checked on the server: every game must name the calendar's team.
- **Data:** per game the id, game number, date and kick-off (local time), home and guest, hall with address, result. Games without a time (00:00) are skipped, cancelled games (`STATUS:CANCELLED`) are left out, so Kabine cancels them. No personal data.
- **Links in the app:** the game's page on handball.net (live ticker, report, result) and the team's page as the table; plain links, nothing is fetched.
- **Samples:** `samples/schedule.json` is an invented calendar (as a JSON string) in the format of handball.net, `samples/links.json` holds a team link, a calendar link and an old team link.

Open: a team in several leagues may show all of them in one calendar; whether the team id stays the same in the next season is not known yet.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/connector.ts` | links, calendar URL, iCal parsing (`parseCalendar`), team check |
| `worker/index.ts` | registers the connector |
| `app/index.tsx` | link to the game on handball.net |
| `samples/` | links and an invented calendar for test/fixtures-contract.test.ts |
| `test/handballnet.test.ts` | links, parsing, sync, device fetch as text |
