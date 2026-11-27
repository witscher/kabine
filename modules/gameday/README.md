# Home game day

On a day when many teams of the club play at home, the hall is full all day. This module invites everyone involved to come early or stay longer and cheer for the other teams. Ported from the original club app (`docs/dev/upstream-tasks.md`, 2026-11-23), where it is called "Großer Heimspieltag". In Kabine it is simply "Heimspieltag", like a youth matchday at home (`docs/dev/decisions.md`): the card and the push say how many teams play.

- **The day rule:** a day counts when at least *N* teams (not groups) have a home game that takes place (`is_home = 1`, not cancelled). *N* is set by admins, 2 to 20, default 5. Two games of one team count once.
- **Push the day before** (topic *Home game day*, only for the account itself): at the configured hour (12, 18 or 20 o'clock, club time), from the hourly run, once per day (`gameday_sent`). A run missed by maintenance catches up within three hours. One push per account, personal and in the recipient's language: "you play at 11:30 (wD)", "Lena plays at 11:30 (wD)", "Lena (wD) at 11:30 and Ben (wB) at 14:30 play", "the mC play at 13:00", "your helper duty starts at 09:30". Who plays: before the squad is published everyone, afterwards the nominated (with *whole team at games* everyone); the others read their team's name.
- **Who is involved:** players, helpers, coaches and staff of the teams that play; parents of their players where parents are involved; fans of these teams (only while the fans module is on, through the hook `follows`); whoever has a helper duty at an event that day (only while the helper duties module is on). Admins may open the page of the day but get no push for that. Not: inactive or former persons, disabled accounts, people who switched the topic off.
- **Start page:** a large card from three days ahead (on the day itself until two hours after the last kick-off) for the first such day the person is involved in: the day, the number of teams, the hall with the most games, first to last kick-off, one line per own or followed team with its first kick-off, *See all games*, "Come along and cheer!" and the mascot picture if the club has one. It sits in time order with the card of the next own event (hook `homeList` → `card`). Games one follows that stand on the card are left out of the list, except while they run (their live link is there). Later days the person is involved in are small white tiles at the kick-off of the first home game, with the mascot and no further details.
- **Page of the day** (`/heimspieltag/:date`): every home game of the day with kick-off, title and venue; own games marked and linked to their event page, followed games marked; with the fans module on, other games open the fans module's game page. A running game shows *In progress* and the live links of the fixture modules (`gameLinks`). Open helper slots of the day the person could take, with a link to the helper plan. Only for the people involved and admins; game data only.
- **Administration → Home game days** (`/verwaltung/heimspieltage`): the push on or off, from how many teams, the hour, the mascot picture, and the next home game day in the next 90 days with when the push goes out and to how many accesses.

## Privacy

- **Stores:** no personal data. The settings (`app_meta` key `gameday`: push on/off, minimum teams, hour, version of the picture), the days whose push went out (`gameday_sent`, a date), and the mascot picture (KV key `gameday-mascot`, like the club logo, at most 256 KB, uploaded by an admin; blocked in the public demo).
- **Who sees it:** the page and the card only the people involved and admins, with game data that is public anyway (kick-off, venue, opponent); no squads, responses or names. Whom a push reaches is worked out at sending time from teams, parent links, follows and duties, and not stored.
- **Deleted:** the sent markers after a week (hourly run and season change); the picture when an admin removes it. `gameday_sent` is not in the export.

## Read load

The days come from the cache per Worker instance: the club's upcoming home games are read once per version of `duties` (index `events_kind_starts`), which migration `202611230400_gameday_sent.sql` also bumps on cancellations and venue changes. The settings are cached with version `ref`, bumped by a trigger on `app_meta`. With the versions read together with the actor (`Actor.versions`), the list on home reads nothing for someone without a home game day ahead. With a day ahead: the followed teams (fans module) and, for days not settled by teams, the person's duties in one query. The push reads the day's coaches, squads, followers, duties and accounts, each from the day's games or teams; players and parent links come from the cache. `test/reads.test.ts` checks the query plans.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest, privacy, notification topic `gameday` (`self: true`) |
| `types.ts` | settings and API shapes |
| `worker/domain.ts` | settings, day rule (`gamedaysOf`, `loadGameday`), `involvement`, `homeData`, `recipients`, `gamedayPush`, `sendGamedayNotice` |
| `worker/routes.ts` | `/api/gameday/days/:date`, `/api/gameday/settings`, `/api/gameday/mascot` |
| `worker/index.ts` | hooks `eventPage`, `cron`, export, season change |
| `app/list.tsx` | hook `homeList`: the card and the tiles |
| `app/pages.tsx` | page of the day, administration |
| `app/gameday.css` | styles |
| `test/gameday.test.ts`, `test/reads.test.ts` | day rule, who is involved, push texts, sending once at the hour in club time, page, card, settings, picture, upgrade, query plans |
