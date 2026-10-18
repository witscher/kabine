# Helper duties

Parents (or the players themselves) sign up for duties at home games and special events: cake and bar, timekeeping, washing shirts. Coaches choose templates per team, organisers of special events plan their own duties. Reminders go by push, e-mail or, with the SMS module, text message.

- **Stores:** who takes on which duty at which game or event, optional notes (e.g. which cake), duty preferences and "I can do this" skills, which reminders were sent. Tables `duty_types`, `duty_templates`, `duty_template_items`, `event_duties`, `duties`, `skill_consents`, `duty_notifications`.
- **Who sees it:** the helpers of the team see names as "First name L."; coaches and admins in full. The personal calendar link only contains one's own duties and those of one's children.
- **Deleted:** at the season change.

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
| `worker/notify.ts` | reminders three days and one day before, "helpers wanted" |
| `app/index.tsx` | "Helpers" tab, admin entry |
| `app/helpers.tsx` | the helper plan |
| `app/admin.tsx` | duty types and templates |
| `test/` | API and reminder tests |
