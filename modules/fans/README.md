# Fans

Everyone with an access can follow other teams of the club and see their games, for example a youth player who wants to watch the women's first team, or parents of an under-13 player who follow the under-15s. Ported from the original club app (`docs/dev/upstream-tasks.md`, 2026-11-23).

- **Profile → Fan of …** (`/profil/fan`): all teams of the club (no groups). Own teams (any role) and the children's teams where parents are involved are fixed: their events are there anyway. A star follows a team. Switches: *Home games only* (list, push and calendar; unknown home or away counts as away) and *Button "SVM" in the event list* (per device, see below).
- **Start page:** a star after the team buttons switches on the games of all followed teams (games only, never trainings). They are rows of their own in the list, sorted in by time, with the team in an outlined ball and a yellow *Home* tag. Games that are over drop out of *Upcoming*. A game in progress is a taller tile with the slow light sweep of today's events (off with reduced motion), *Game in progress* with a pulsing dot and the live links of the fixture modules (`gameLinks`, phase `live`, for the game's source). Selecting the button with the club's abbreviation shows all games of the club: own ones as usual events, the others as fan games; it switches the other buttons off, turning it off brings the previous selection back, tapping another button ends it.
- **Game page** (`/spiel/:id`): start, venue, opponent, result, whether it takes place, live ticker or game report. Any signed-in person may open it for a game of a team of the club (that data is public anyway); never the event page, squad, responses, names, meeting point, reason of a cancellation, carpools or chat.
- **Push** (topic *Games as a fan*, only for the account itself, not per child): when an upcoming game is cancelled, its cancellation withdrawn, or its start or venue changes (by hand or by a schedule sync), and the earlier of the old and new start that is still ahead is at most 72 hours away. Without the reason. Not to members of the game's teams or their parents where parents are involved (they get the team's push). With *Home games only* only for home games. Texts per recipient language (`worker/domain/notify.ts`).
- **Calendar:** a checkbox *Games as a fan* under *Profile → My events*, off by default, also for links made before. Game data only, with *Home games only*, the same UID as an own event (`event-<id>@…`).

## Privacy

- **Stores:** per access the followed teams (`fan_follows`), whether *Home games only* is on (`fan_home_only`, one row means on) and whether the games go into the calendar (`fan_calendar`). On the device: the star and the view of all games in `kabine-home-list`, the club button in `kabine-fans-club-button` (no personal data).
- **Who sees it:** only the person. There is no route that reads someone else's follows. Followers see only game data (`worker/domain.ts`: `fanGames`, `fanGame`, a narrow query that starts from `event_teams` of the followed teams and leaves out games of one's own teams).
- **Deleted:** when the person unfollows or switches it off, leaves the club (hook `personLeaves`), or the team or access is deleted (foreign keys).
- **Season change:** follows stay. Teams keep their ids over the season change, only the people are reassigned; a follow of a team one now plays in is ignored while one is in it.
- **Export:** `fan_follows` and `fan_home_only` are in the admin's export and restore (categories memberships and people), like the notification settings. `fan_calendar` is not, like the calendar links.

## Read load

The data for the start page comes with the page of the event list (worker hook `eventPage`), not in a second request: one indexed read of the account's follows, and with the star on the games of the followed teams inside the page's window (`event_teams_team`), at most one page of them. The push starts at the game's teams (`fan_follows_team`). Team names come from the cache per Worker instance. `test/reads.test.ts` checks the query plans.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest, privacy, notification topic `fans` (`self: true`) |
| `types.ts` | API shapes |
| `worker/domain.ts` | follows, settings, `fanGames`, `fanGame`, `notifyFans` |
| `worker/routes.ts` | `/api/fans/follows`, `/api/fans/settings`, `/api/fans/games/:id` |
| `worker/index.ts` | hooks `eventPage`, `eventChanged`, `calendarItems`, `personLeaves`, export |
| `app/list.tsx` | hook `homeList`: star, club button, rows |
| `app/pages.tsx` | *Fan of …* and the game page |
| `app/calendar.tsx` | hook `calendarOptions` |
| `app/fans.css` | styles |
| `test/fans.test.ts`, `test/reads.test.ts` | what fans see, push rules, calendar, cleanup, upgrade, query plans |

Not ported: the club app's handball4all fields (`liveUrl`, `h4aGameId`, `tableUrl`); the live link comes from the fixture modules. Hiding fan games that the *home game day* card already shows comes with that module.
