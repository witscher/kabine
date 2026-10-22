# Changelog

Release notes per version. The update workflow of a club's copy (`.github/workflows/update.yml`) shows the section of the new version in its pull request.

Changes that are merged but not released yet go under *Unreleased*, one line each, written for the people who run a club's installation. On a release the section becomes `## vX.Y.Z`, with an entry in `shared/changelog.ts` for the app (`test/changelog.test.ts`).

## Unreleased

## v0.3.0

- Import teams, coaches and players from the club's lists, in the setup wizard and under *Administration → Import*: Excel files (.xlsx) with one or more sheets, CSV or a pasted table, several lists with the same people combined into one. Only name, birth year, team and role are read, in the browser; the lists are not uploaded, and everything is checked and corrected before anything is created.
- *Administration → Import* also takes back an export of Kabine: tick what to take over (club settings, season, teams, people, assignments, training plans, events, chats). Existing data stays and is skipped; everything ticked on a new installation is a full restore, for example when moving. The export now records the Kabine version.
- The setup wizard starts at step 1 when it is opened again after it was finished, and its last step can start over.
- Only admins change their own name. Players, parents and coaches see "Name wrong? Tell your coach or an admin." in their profile; coaches correct the names of players and now also of parents of their teams.
- `npm run admin:link` is documented as a break-glass operation and gets `--owner` (the rescued person becomes the owner) and `--revoke-all-admins` (compromised accesses: every other admin loses the role and is signed out, with confirmation). Every use is recorded and shown under *Administration → Updates and maintenance*.
- The update pull request shows the release notes of every version since the installed one, so a copy that skipped releases sees all changes, and it closes older update pull requests that are still open.

## v0.2.3

- "KiHaSL/JuHaSL" is now called "Jugendschiedsrichter" (youth referees) everywhere in the app; the English texts say "youth referee". The duty and the automatic group are renamed where the club kept the old name. Database change: renames only.
- The dot for unread release notes and new modules is on the *Events* tab, where the card with the news is, instead of on *Administration*.
- *Administration → Training venues* can add venues: the club's own halls or pitches and other places, with address. A new installation started with an empty page and venues could only be added inside a training plan.

## v0.2.2

- School holidays and public holidays of the region now also come for the current season: when the setup creates the first season, when the region is changed in the club settings, and with "Load holidays of the region" under *Administration → Holidays*. Until now they only came with the season change, so a new installation had none.
- `npm run admin:link` creates an admin link from the command line when nobody can get into Administration any more ([Owner and admins](https://kabine.dev/en/docs/operation/#nobody-can-get-into-administration)).
- The update pull request warns about `wrangler.jsonc` only when the release really changes the configuration; resource IDs and the club's own names no longer count.

## v0.2.1

- A player invitation link opened on a signed-in device (player, parent, coach, admin) only offers "Straight to the app": a child could pick a teammate's free name and set up that teammate's access on the wrong device. The server refuses it too. Expired or invalid links show signed-in people the same way back into the app.
- The update workflow opens its pull request reliably in copies made with the deploy button (in a fresh copy GitHub refused the way it did before), and if GitHub still refuses, it opens an issue with a link instead. Copies on v0.2.0 replace `.github/workflows/update.yml` by hand once; the pull request lists it.
- The deploy button does not copy the update workflow into the club's copy: the installation guide now adds it as a step, with the setting that lets GitHub Actions open pull requests.
- The update pull request lists only workflow files the copy has.

## v0.2.0

The first release with automatic update pull requests. Copies from before it need a few steps once: [Updating an older copy](https://kabine.dev/en/docs/operation/#updating-an-older-copy).

- The update workflow no longer merges Kabine's history into the club's copy and lists changed workflow files to copy by hand (GitHub does not let it change them).
- Controlled updates: a release with database changes puts the app into "being updated" for about a minute while the migrations run (admins included, reminders pause) and notes a restore point first. The update pull request says whether the release changes the database.
- *Administration → Updates and maintenance*: installed version, last update with its restore point and the command to go back, maintenance switch.
- "I'm not there" for coaches, group leads, staff and organisers: the event takes place, the others in charge get a push with an optional note, the team only if asked (without the note). If no coach is left, the event page suggests cancelling or a stand-in. Database change: new table `leader_absences`.
- Attendance after an event replaces the "absent without excuse" switch: coaches record present, excused or unexcused per participant until the end of the following day (admins the whole season); without an entry the response counts, who did not respond is listed first. Players and parents see their own entry where it differs from their response. Database change: new table `attendance_marks`, existing marks are copied.
- An event cancelled for everyone reads "Not taking place" (German "Findet nicht statt") instead of "Cancelled", which was mixed up with a player's own decline; date, time and game are struck through on the event page.
- Plain `http://` requests are redirected to `https://`, also where the club's Cloudflare zone does not force it.
- Invitation links are for setting up only: the share texts and the join page say so, and whoever opens a team link again while signed in gets a "Straight to the app" button instead of the setup form.

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
