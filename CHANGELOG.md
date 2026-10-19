# Changelog

Release notes per version. The update workflow of a club's copy (`.github/workflows/update.yml`) shows the section of the new version in its pull request.

Changes that are merged but not released yet go under *Unreleased*, one line each, written for the people who run a club's installation. On a release the section becomes `## vX.Y.Z`, with an entry in `shared/changelog.ts` for the app (`test/changelog.test.ts`).

## Unreleased

- Controlled updates: a release with database changes puts the app into "being updated" for about a minute while the migrations run (admins included, reminders pause) and notes a restore point first. The update pull request says whether the release changes the database.
- *Administration → Updates and maintenance*: installed version, last update with its restore point and the command to go back, maintenance switch.
- "I'm not there" for coaches, group leads, staff and organisers: the event takes place, the others in charge get a push with an optional note, the team only if asked (without the note). If no coach is left, the event page suggests cancelling or a stand-in. Database change: new table `leader_absences`.
- Attendance after an event replaces the "absent without excuse" switch: coaches record present, excused or unexcused per participant until the end of the following day (admins the whole season); without an entry the response counts, who did not respond is listed first. Players and parents see their own entry where it differs from their response. Database change: new table `attendance_marks`, existing marks are copied.

## v0.1.0

First release.

- Events: trainings from training plans (school holidays and public holidays of the club's region left out), games, special events; accept and decline, reasons only for coaches and admins.
- Squad nominations, core squad, stand-ins from other teams, absent without excuse, attendance statistics.
- Team chat with mentions, reactions and announcements; groups for circles without training and games.
- Parents respond for their children and decide what the children may do; profile pictures of minors need their approval.
- Team staff (physio, team manager): see the team's events, who takes part and the chat, without taking part.
- Push notifications, personal calendar feed, offline use of the last loaded state.
- Modules: helper duties, youth referees, carpools, handball4all, SMS (seven.io); game schedule from a table.
- Setup wizard for the first admin, first steps for new accounts, player list import for coaches.
- English and German, `.po` catalogs for corrections and new languages.
- Installation with the "Deploy to Cloudflare" button; the app creates its own keys; weekly update pull requests.
