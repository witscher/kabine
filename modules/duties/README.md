# Helper duties

Parents (or the players themselves) sign up for duties at home games, special events and club events: cake and bar, timekeeping, washing shirts. Coaches choose templates per team, organisers of special events plan their own duties. Reminders go by push, e-mail or, with the SMS module, text message.

- **Stores:** who takes on which duty at which game or event, optional notes (e.g. which cake), duty preferences and "I can do this" skills, approvals by admins (e.g. youth referees, also for children) and the links that grant them (hashed), the duties every home game of an age group gets, which teams the helpers of a template line or time block come from (and, when teams take turns, which team is in charge and whether its chat was told), which reminders were sent. Tables `duty_types`, `duty_templates`, `duty_template_items`, `event_duties`, `duties`, `skill_consents`, `skill_grants`, `skill_grant_links`, `age_class_duties`, `duty_notifications`.
- **Reads, besides:** the birth year of the person who would do a duty marked "adults only" (no new data).
- **Who sees it:** the helpers of the team see names as "First name L."; coaches and admins in full. The personal calendar link only contains one's own duties and those of one's children.
- **Deleted:** at the season change.

## Helpers tab

Without a selection the tab lists the events of all the person's teams together (`GET /api/duties?teamIds=1,2`, an event of several teams only once), each with its team badge; a tap on a team filters, a second tap clears it, as in the events list. The youth referee view is a list of its own. Top helpers only show for a single team. A link from an event (`/helfer?mannschaft=<team>&spiel=<event>`) selects that team and scrolls to the event.

## Duty types

A duty type says *what*: name, on site or task, note, prior knowledge, and who helps relative to the event's team (parents, players, coaches, members; may stay empty when the helpers come from other teams). Three switches:

- **Assigned by the coach** (`assign_only`): nobody signs up themselves. Coaches, admins and organisers assign people under "Sign someone up", which then lists only people who fit "who helps" or the block's teams (`?block=<id>`); others are refused (400 `not_in_who`). The person (and the parents of a child) is notified at once and may withdraw. No "helpers wanted", not counted as "helpers needed"; coaches still get the open places.
- **Send "helpers wanted"** (`notify_open`, on by default): off for duties where the message would reach too many people. When only one duty is wanted, the push names it ("Wipers wanted · Men 1").
- **Adults only** (`adults_only`): whoever is under 18 by birth year cannot sign up, is not assigned (400 `adults_only`) and gets no "helpers wanted". No birth year counts as adult; whoever does the duty counts (a parent for their child's team, the child when it helps out).

Admins can **merge** a duty type into another of the same kind (`POST /api/admin/duty-types/:id/merge`): template lines, blocks, entries, consents, approvals, approval links, required duties of age groups and automatic groups move, the source is deleted. Not for types taken by approved people from all teams.

## Helpers from

Each template line and time block says where its helpers come from (`helper_mode`, `helper_teams`):

- **As duty type** (`default`): "who helps" of the duty type for the event's team (or, at club events, for all teams).
- **Teams** (`teams`): only the players of these teams, for children the involved parents sign the child up and the child does the duty (the entry names the child). Coaches and admins of the event can still sign up themselves.
- **Taking turns** (`rotate`, templates only): each game gets the next team of the list after the one of the last block of this duty type with the same list, in start order. The team is stored on the block (`rotate_team_id`): moved, cancelled or new games do not reshuffle. Managers change it per game within the list, and see a hint when the team has an event of its own at that time. A week before, the team gets one system message in its chat (`rotate_notified`, again after a change); no push to all parents.

The **Help out** list in the Helpers tab (`GET /api/duties/help-out`, `Me.helpOut`) shows upcoming events of other teams with such blocks that name a team in which oneself or a child plays (taking turns: only when it is that team's turn); template blocks of the next 60 days are generated for it. An entry through "helpers from" (or a duty the coach assigned) makes the other team's event visible to the person, without the participant list.

## Club events

Special events for the whole club (no team) can have time blocks, set when creating the event or added later. Everyone sees all duties; signing up follows "who helps" across all teams (players of a team without parents count as "parents" themselves), and "helpers from" as usual. Admins and the event's organisers manage them, not coaches of single teams. The Helpers tab shows them under **Whole club** (`GET /api/duties/club`, live channel `/api/duties/club/live`, `Me.clubDuties`), and together with the own teams when no chip is chosen. No "helpers wanted" (it would reach the whole club), reminders to those signed up as usual, "helpers needed" on the event card.

## Managing an event's duties

"Manage duties" (Helpers tab) and "Manage helper duties" (event page of a special event) open the same sheet (`src/duty-manage.tsx`, `GET /api/duties/events/:id/manage`): add blocks one after the other, apply a template, change time, slots and "helpers from", sign people up. Without blocks it starts with "Add time slot". Entries show the block's time. A block can be deleted with its entries after a confirmation that says how many go with it; nobody is notified, as when removing a single entry.

## Qualifications

Duties that need prior knowledge are approved by the person ("I can do this") or by an admin; duties approved by admins can be taken by the approved people from all teams, such as youth referees for the home games of the youngest age groups. See docs/dev/design.md, Qualifications. Routes in `worker/qualifications.ts` (approvals, links, the list per duty type), pages in `app/approvals.tsx` (*Administration → Approvals*, the link page `/freigabe`).

## Deleting a duty type

Admins delete a duty type only when it is used nowhere: in no template, in no age group's required duties and in no time block of any event, past ones included, since those rows and the helpers' entries would go with it (`DELETE /api/admin/duty-types/:id`, 409 `duty_type_in_use` otherwise). Consents and admin approvals to it go with it. *Who takes it* can be changed later: a type taken from all teams that becomes a duty of the team loses its required age groups and fits into templates; the way back needs it out of all templates (409 `duty_type_in_template`). `GET /api/duty-types` tells admins where each type is used (`usage`).

## Part of the core

The helper plan shows up in many core screens: one's duties on event cards and in the calendar, "helpers needed" on the event page, the duty blocks of special events. These rules and the live channel therefore live in the core and work while the module is on:

| Core file | What |
| --- | --- |
| `worker/domain/duties.ts` | duty types, blocks, who may take or manage a duty ("helpers from", club events, adults only), rotation, one's duties, helpers needed, `Me.helpOut` and `Me.clubDuties` |
| `worker/duties/hub.ts` | Durable Object `DutyHub`: live updates of the plan (binding in `wrangler.jsonc`) |
| `src/duties.tsx`, `src/duty-blocks.tsx`, `src/duty-manage.tsx` | duty chips on event cards, editing the blocks of an event and "helpers from", the "Manage duties" sheet (also on the event page) |
| `worker/routes/setup.ts` | duty types and templates of the sport profile (setup wizard) |

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/index.ts` | routes, reminders (cron), export tables |
| `worker/routes.ts` | `/api/duties/...`, `/api/duty-types`, `/api/duty-templates`, `/api/admin/duty-...`, `/api/profile/duty-prefs` |
| `worker/notify.ts` | reminders three days and one day before, "helpers wanted", "<duty> wanted" for approved people, "You are assigned", the chat message for teams taking turns |
| `worker/qualifications.ts` | approvals by admins, links, the list per duty type taken from all teams |
| `worker/stats.ts`, `app/stats.tsx`, `types.ts` | statistics: helpers per family with a reminder, the family's duties (hooks `teamStats`, `myStats`) |
| `app/index.tsx` | "Helpers" tab, admin entry |
| `app/helpers.tsx` | the helper plan |
| `app/admin.tsx` | duty types and templates |
| `app/approvals.tsx` | Administration → Approvals, the link page |
| `test/` | API and reminder tests |
