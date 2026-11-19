# Polls

Coaches ask their team or group, admins the whole club (all teams, no groups). Three kinds:

- **Choice:** a question with fixed answers, one or several.
- **Find a date:** yes, maybe or no per date, like a scheduling poll.
- **Order:** items with price, optional sizes and a product photo; everyone says how many. Payment by PayPal.me and/or bank transfer with a QR code (GiroCode, euros only), set by an admin under *Administration → Polls* for the whole club.

Who votes: players (group members), parents (teams with parents only), coaches (group leads), combinable. For children in teams with parents the parents vote too; for orders only the parents. *One vote per family*: everyone linked through parent links (parents, children, siblings, patchwork) shares one vote that any of them can change. Votes can be changed and withdrawn until the end. Results are visible right away or only after the end; creator, coaches of the team and admins always see them.

Where it shows: a card at the very top of the start page while a vote is missing (orders: "Order" or "Ignore"), a dot on the Events tab, the number on the app icon, a note with a link in the team chat when a poll starts, a push at the start and once 24 hours before the end to those who have not voted (notification topic `polls`). Lists under *Profile → Polls* and *Administration → Polls*.

- **Stores:** polls, their answers or items (`polls`, `poll_options`), who may vote for which person or family (`poll_voters`, synced hourly while a poll runs), the votes (`poll_ballots`, `poll_answers`), for orders the order number, the confirmed and the reported amount with who reported it, product photos (`poll_option_images`, shrunk on the device to at most 800 px), who ignores an order (`poll_ignores`). The club's PayPal.me name, account holder, IBAN and currency in `app_meta` (`polls_payment`).
- **Who sees it:** answers with names: the creator, the team's coaches and admins, unless the poll is anonymous (then nobody, the vote is only kept so it can be changed and reminders go only to who is missing). Participants see the result without names, except in scheduling polls ("First name L.", a decision in `docs/dev/decisions.md`). Orders: each family sees only its own order, never totals or counts; the creator, coaches and admins see all orders. Product photos: everyone who sees the poll. Payment details: admins, coaches and everyone who ordered.
- **Deleted:** with the poll (its creator, a coach of the team or an admin deletes it), at the latest at the season change. Someone who leaves the club is removed from running polls; their given votes stay with the unit. Not in the data export.

Payment: the app cannot know whether someone paid. The family taps "I have paid", the creator (admins as fallback) ticks "paid"; both store the order's amount at that moment, so after a top-up order the rest stays open and a shortened order shows "paid too much". A paid order cannot be withdrawn, only changed. The bank reference is the title and the order number, without names; the PayPal note adds the players' names because PayPal cannot be matched otherwise.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest (switch, privacy, notification topic `polls`) |
| `types.ts` | API shapes, payment rules (`paymentState`, `paymentReference`, `epcPayload`, IBAN and PayPal checks) |
| `worker/index.ts` | hooks: routes, hourly sync and reminder (`runPolls`), app icon count, cleanup when leaving and at the season change, export exclusion |
| `worker/domain.ts` | voters (`computeVoters`, `syncVoters`), views (`pollDetail`, `listPolls`, `openPolls`), recipients |
| `worker/routes.ts` | `/api/polls…` |
| `app/index.tsx` | pages, start page card, tab dot, entries under Profile and Administration |
| `app/home.tsx` | card at the top of the start page, dot on the Events tab |
| `app/pages.tsx` | list, form with preview, vote, result, managing, payment |
| `app/settings.tsx` | *Administration → Polls* with the payment details |
| `app/shrink.ts` | product photos made smaller on the device |
| `test/*.test.ts` | API tests: choice, scheduling, orders, visibility, payments, photos, ignoring, migration, season change |

Migration: `migrations/202611200110_polls_tables.sql`. The core hooks the module needs are described in `docs/dev/modules.md` and `docs/dev/decisions.md`.
