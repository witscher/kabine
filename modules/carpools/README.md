# Carpools

Drivers offer seats for away games, players (or their parents) look for one and book a seat. Coaches can sign up others. The chat of the team gets a reminder before the game while people are still looking.

- **For whom:** nominated players of an away game, their parents, the coaches.
- **Stores:** offers (driver, seats), searches (player, companions, booked offer). Tables `carpool_offers`, `carpool_requests`.
- **Who sees it:** the people above; other parents and players see names as “First name L.”.
- **Deleted:** at the season change; future entries when someone declines, leaves the squad or the club.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest (switch, privacy, notification topic `carpool`) |
| `types.ts` | API shapes (`CarpoolInfo`, `CarpoolCount`) |
| `worker/index.ts` | routes and hooks: chat reminders (cron), counts on event cards, the card on the event page, cleanup |
| `worker/routes.ts` | `PUT/DELETE /api/events/:id/carpool/...` |
| `worker/domain.ts` | rules: who may see and sign up, seat counting, notifications |
| `app/index.tsx` | line on event cards, section on the event page |
| `app/card.tsx` | the carpool card with its sheets |
| `test/carpool.test.ts` | API tests |

Decisions: `docs/dev/design.md`, Carpools.
