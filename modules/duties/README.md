# Helper duties

Parents (or the players themselves) sign up for duties at home games and special events: cake and bar, timekeeping, washing shirts. Coaches choose templates per team, organisers of special events plan their own duties. Reminders go by push, e-mail or, with the SMS module, text message.

- **Stores:** who takes on which duty at which game or event, optional notes (e.g. which cake), duty preferences and "I can do this" skills, approvals by admins (e.g. youth referees, also for children) and the links that grant them (hashed), the duties every home game of an age group gets, which reminders were sent. Tables `duty_types`, `duty_templates`, `duty_template_items`, `event_duties`, `duties`, `skill_consents`, `skill_grants`, `skill_grant_links`, `age_class_duties`, `duty_notifications`.
- **Who sees it:** the helpers of the team see names as "First name L."; coaches and admins in full. The personal calendar link only contains one's own duties and those of one's children.
- **Deleted:** at the season change.

## Helpers tab

Without a selection the tab lists the events of all the person's teams together (`GET /api/duties?teamIds=1,2`, an event of several teams only once), each with its team badge; a tap on a team filters, a second tap clears it, as in the events list. The youth referee view is a list of its own. Top helpers only show for a single team. A link from an event (`/helfer?mannschaft=<team>&spiel=<event>`) selects that team and scrolls to the event.

## Qualifications

Duties that need prior knowledge are approved by the person ("I can do this") or by an admin; duties approved by admins can be taken by the approved people from all teams, such as youth referees for the home games of the youngest age groups. See docs/dev/design.md, Qualifications. Routes in `worker/qualifications.ts` (approvals, links, the list per duty type), pages in `app/approvals.tsx` (*Administration → Approvals*, the link page `/freigabe`).

## Deleting a duty type

Admins delete a duty type only when it is used nowhere: in no template and in no time block of any event, past ones included, since those rows and the helpers' entries would go with it (`DELETE /api/admin/duty-types/:id`, 409 `duty_type_in_use` otherwise; the youth referee duty never, `referee_type`). Consents to it go with it. `GET /api/duty-types` tells admins where each type is used (`usage`).

## Part of the core

The helper plan shows up in many core screens: one's duties on event cards and in the calendar, "helpers needed" on the event page, the duty blocks of special events. These rules and the live channel therefore live in the core and work while the module is on:

| Core file | What |
| --- | --- |
| `worker/domain/duties.ts` | duty types, blocks, who may take or manage a duty, one's duties, helpers needed |
| `worker/duties/hub.ts` | Durable Object `DutyHub`: live updates of the plan (binding in `wrangler.jsonc`) |
| `src/duties.tsx`, `src/duty-blocks.tsx` | duty chips on event cards, editing the blocks of an event |
| `worker/routes/setup.ts` | duty types and templates of the sport profile (setup wizard) |

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/index.ts` | routes, reminders (cron), export tables |
| `worker/routes.ts` | `/api/duties/...`, `/api/duty-types`, `/api/duty-templates`, `/api/admin/duty-...`, `/api/profile/duty-prefs` |
| `worker/notify.ts` | reminders three days and one day before, "helpers wanted", "<duty> wanted" for approved people |
| `worker/qualifications.ts` | approvals by admins, links, the list per duty type taken from all teams |
| `app/index.tsx` | "Helpers" tab, admin entry |
| `app/helpers.tsx` | the helper plan |
| `app/admin.tsx` | duty types and templates |
| `app/approvals.tsx` | Administration → Approvals, the link page |
| `test/` | API and reminder tests |
