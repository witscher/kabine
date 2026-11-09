# Tasks from the original club app

Kabine started as the app of one handball club, which is still developed on its own. New features and bug fixes made there are listed here so they can be brought into Kabine. Whoever works on Kabine takes an open entry, ports it the Kabine way (English source, Lingui, club profile instead of club data, modules, tests) and moves it to "Done" with the Kabine commit.

Entries describe the change, not the club: no names, domains or data of the club.

Format per entry: date, title, what changed and why, where in the code (file and function names are the same in both code bases unless noted), and anything that needs adapting for Kabine.

## Open

## Parked

Notes on changes in the club app that the maintainer does not want in Kabine yet. Do not port and do not add to the roadmap; the maintainer moves an entry to "Open" when it is wanted.

## Done

- **2026-11-09 Statistics for coaches, players and parents; helper duties per family.** Ported with the helper part in the helper duties module: core statistics (`worker/domain/stats.ts`, `src/pages/stats.tsx`) and the module's view through the new app hooks `teamStats` and `myStats` (`modules/duties/worker/stats.ts`, `/duties/teams/:id/stats`, `/duties/stats/me`); migration `202611100100_core_attendance-nominated.sql` (docs/dev/decisions.md). Club app: the Kabine export can keep `attendance.nominated` now. Kabine: `621c4f5`.
- **2026-11-09 Briefing: qualifications instead of a youth referee role.** Done as briefed: `skill_grant`/`skill_grants` (club app names), duty types taken by approved people from all teams (`who_referees`, `whoQualified` in the code), required duties per age group (`age_class_duties`), a list per duty type in the Helpers tab, links (`skill_grant_links`, `/freigabe`), the automatic group (`teams.auto_skill`), "<duty> wanted". The youth referee module is gone; migration `202611092330_core_qualifications.sql` takes the role over, old tables stay for the previous release. Club app: the Kabine export can keep `skill_grant` and `skill_grants`; the referee role maps to grants of the duty with `who_referees = 1`. Kabine: `b2b8c7d`.
- **2026-11-09 Duty types approved by an admin are hidden from people without the approval.** Part of the qualifications. Kabine: `b2b8c7d`.
- **2026-11-09 Duty types whose prior knowledge an admin approves.** Part of the qualifications; approvals also on *Administration → Approvals*. Kabine: `b2b8c7d`.
- **2026-11-09 Delete a duty type, only when it is used nowhere.** In the duties module; usage also counts age groups and, for duties taken from all teams, approvals. Kabine: `8658bd9`.
- **2026-11-09 Team setting "Whole team at games".** Migration `202611092300_core_game-all-players.sql`; carpools module opens for all participants. Club app: the Kabine export can keep `game_all_players`. Kabine: `2b359e3`.
- **2026-11-09 Info buttons instead of explanation texts next to settings.** Core texts in `src/help-texts.ts`; modules pass their own texts, no registry (docs/dev/decisions.md). Kabine: `6f3b4d5`.
- **2026-11-09 Real attendance count on past events.** Kabine: `82e67f7`.
- **2026-11-09 Parents are told at once when their child is marked unexcused.** Push per recipient language. Kabine: `b71c902`.
- **2026-11-09 Event page: coaches see all coaches incl. themselves.** Kabine already listed everyone, the own entry as "You"; nothing to port.
- **2026-11-09 Helper tab: all teams by default, team filter like the events list.** Kabine: `bb251a8`.
- **2026-11-09 Youth referee group: leads by hand instead of all admins.** Kabine: `d1c3951` (the group follows the qualification since `b2b8c7d`).
- **2026-11-09 Fix: coach mode only while the admin is a coach somewhere.** Kabine: `2c15c64`.
- **2026-11-08 Fix: the helper plan link on an event opens that team and that event.** Kabine: `665ecb1`.

- **2026-11-07 News banner (MOTD): several at once, optionally for coaches only, with an example and a closing paragraph.** Ported as the maintainer wanted: no hand-written banner, but coach notes in the release notes (`coaches` in `shared/changelog.ts`, optional `example: "coach-buttons"`), shown to coaches and admins in the news card (`src/news.tsx`, `worker/domain/news.ts`); migration `202611071900_core_coach-news.sql` marks existing accounts at 0.6.0 so existing coaches see the next release's coach notes. The first coach note (the coach buttons) goes into the next release entry. Kabine: `0b54f31`.
- **2026-11-07 Unread chat messages: count in the chat list, unread rooms first, "New messages" divider in the chat.** `unreadCount` in `GET /chat/rooms`, `lastReadId` in the room's `hello`, count, order and divider in `src/pages/chat.tsx`; "1 day ago" as a plural. Kabine: `a9f9ab5`.
- **2026-11-07 Coach buttons: marked with a whistle (design rule).** In Kabine in the club's main colour instead of yellow (light tint, border in the main colour), as the maintainer decided; rule in docs/dev/design.md (Coach buttons). Kabine: `a9f9ab5`.
- **2026-11-05 Fixture sync reminder: threshold setting and overview of all teams.** Admin page "handball4all" (or "Game schedules" with several sources) under Administration: reminder after 15, 30 or 60 days or never (default 15), every team with source, last sync, error, upcoming games, whether coaches are reminded, "Sync now" and the link. Setting in the club profile (`scheduleReminderDays`), page for every connector (docs/dev/decisions.md). Kabine: `43cb182`.
- **2026-11-04 Coach hints on the home screen: fixture schedule not synced, meeting point missing.** Hints at the top of the events list for the coach's own teams, with the button that does it; meeting point missing for games in the next 3 days ("Enter" opens the meeting sheet), schedule not synced for 14 days ("Sync now"). In the core for every connector instead of a module hook, since syncing is core code in Kabine (docs/dev/decisions.md). Kabine: `8fe597f`.
- **2026-10-26 Children in the app: limits per age class, plus a coach override per team.** Age class (admins) and team (coaches, Kabine only) limit own access, responding, chat (none/read/write) and stand-in requests; each level only restricts, parents decide within. Same `age_classes.child_*` columns as the club app, nullable `teams.child_*` for the team level, sport profiles bring defaults for new clubs. Club app: regenerate `test/kabine-schema.json` so its export carries the age class columns. Kabine: `393de5e`.
- **2026-10-26 Groups can include parents.** "Include parents" switch in the group settings (admins, off by default, not for the youth referee group); parents see the group's special events for their children, respond and are in the chat; no parent links for groups. Kabine: `69fcbf5`.
- **2026-10-20 Only admins change their own name.** Ported as a fixed rule, not a club setting (the maintainer's decision: names are identity in a small, invitation-only club app with many children). Profile hint, coaches rename parents of their teams. Kabine: `4671b55`.
- **2026-10-20 Player invitation link while signed in: no name choice, only "Straight to the app".** Server refuses with 409 `signed_in` (options, e-mail code, verify, late code redemption); invalid links show signed-in people the box. Kabine: `f7031db`.
- **2026-10-20 Cancelled events read "Not taking place" and are struck through in the detail view.** Wording in app, push, calendar feed and conflict messages; struck-through hero. Kabine: `a70a3f2`.
- **2026-10-19 Invitation links are for setup only; "Straight to the app" when opened again.** Share texts and join page say the link is needed once; signed-in parents (and players) who open it again get "Straight to the app". Kabine: `f710472`.
- **2026-10-19 Record attendance after an event: present, excused, unexcused.** Coaches record per participant after the start, the response decides without an entry; coaches until the end of the following day, admins the whole season. Migration `202610192200_core_attendance-marks.sql` copies the unexcused marks; `unexcused_absences` is dropped in a later release. Kabine: `4c44e6f`.
- **2026-10-19 Coaches, group leads and organizers can say "I'm not there".** Leaders (coaches, group leads, team staff, creator and organisers of a special event) mark themselves absent with an optional note; other leaders get a push, the team only on request and without the note. New migration `202610192140_core_leader-absences.sql`. Kabine: `7435ac2`.
- **2026-10-19 Parent invitation: own name, not the child's.** Bold hint under the first name, warning with a confirm button when the first name is a child's of the team, passkey and e-mail code wait until confirmed. Kabine: `c8a56cd`.
- **2026-10-19 Picking players from other teams: filter by team, core squad marked, correct source teams in the hints.** Shared candidate list with team filter chips and a core squad badge in the three pickers; hints name lower-ranked teams of the same age class and the next younger youth team. Kabine: `8c96fdb`.
- **2026-10-18 Holiday plans in the timeline.** Notes "Autumn holidays, 26 Oct to 30 Oct: no training for wD" in the event overview. Kabine: `b3b1eb2`.
- **2026-10-18 Optional joint training.** Per team and training mandatory or optional, players accept by hand. Kabine: `ccc0934`, `13d83be`.
