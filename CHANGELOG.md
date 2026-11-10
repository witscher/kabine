# Changelog

Release notes per version. The update workflow of a club's copy (`.github/workflows/update.yml`) shows the section of the new version in its pull request.

Changes that are merged but not released yet go under *Unreleased*, one line each, written for the people who run a club's installation. On a release the section becomes `## vX.Y.Z`, with an entry in `shared/changelog.ts` for the app (`test/changelog.test.ts`).

## Unreleased

- Security: a personal link on an existing access no longer sets an e-mail address for sign-in; it sets up a new passkey as before. If the address of an access may not be the person's own, admins switch on *Also remove the e-mail address for sign-in* in the person's sheet before creating the link: using the link removes the address, and the person can enter a new one. The protocol shows when a personal link was used on an existing access.
- Security: the limit for sign-in codes no longer shows whether an address belongs to someone in the club; unknown addresses are counted the same way (as a hash, nothing is sent).
- Security: restoring an export can no longer move an existing access to another person, which another admin could have used against the owner of the installation.

## v0.8.0

- Statistics: coaches see *Team → Statistics* for the last 4 weeks or the season: training participation, appearances in games, a table per training and game, and each player's events. With the helper plan also the helper duties per family, with a button to remind the families without a duty. Players and parents see their own figures under *Profile → My statistics* (for parents per child), with the family's helper duties.
- Qualifications: a duty type that needs prior knowledge can now be approved by an admin instead of by the person (e.g. tournament management). Admins approve people in the person sheet, on the new page *Administration → Approvals* or with a link; people without the approval do not see such a duty. The youth referee role is now such an approval of the youth referee duty: existing youth referees, links and the youth referee group are taken over by the update. The separate module "Youth referees" is gone; its duty is part of the helper duties. Under *Administration → Age groups* admins tick which home games get it, and other duties of approved people work the same way (e.g. referees in other sports).
- Admins can delete a duty type that is used nowhere (no template, no age group, no time block at any event, past ones included); its approvals go with it. A duty type in use can still only be archived; the sheet says where it is used.
- *Who takes it* of a duty type can now be changed later. The youth referee can thus become a duty of the team like the others: put it into the home game template of the teams that need it (e.g. a template "Home game E youth"); age groups no longer add it on their own, approvals stay.
- New installations: the youth referee is a duty of the team, approved by an admin, and in no template; a further template "Home game adults" with only washing the shirts goes to the adult teams. Existing installations keep their duty types and templates.
- Security: sign-in codes by e-mail or SMS can no longer be guessed with many parallel tries; at most five codes per address and hour and ten per day.
- Security: the role next to a name in the chat (e.g. "Coach") can no longer be faked by a modified app.
- Security: open chats follow rights at once. Whoever is removed from a team, leaves the club, loses a parent link, admin rights or a device, or whose parents switch off the chat, is disconnected; the app reconnects with the rights that are left.
- New *Administration → Protocol* for admins: who removed an access, created a personal link, recorded a leaving, deleted a person, changed admin rights, members, parent links or game schedules, cancelled or deleted events, changed the season or downloaded the export, and when. Everyday things are not listed. Emptied by the season change, not in the export; the privacy page lists it.
- New team setting *Whole team at games* (*Team → Settings*, off by default): every player takes part in every game and declines if they cannot come; the nomination only decides who plays. Players who are not nominated see "Squad follows" and later "Not nominated" and can join carpools; game notifications still go to the nominated players only.
- Info buttons: settings explain themselves behind a small "i" with an example, instead of long lines under every switch (team settings, groups, administration, profile, duty types).
- Past events count who was really there (accepted or recorded as present by the coach): the event page shows "Were there", and the events list shows coaches the number of people present instead of the acceptances.
- When a coach marks a child as unexcused after an event, the child's linked parents get a push at once that their child did not arrive (once per event and child, cannot be switched off). The attendance list tells the coach.
- Helpers tab: without a selection it lists the events of all your teams together, each with its team; a tap on a team filters, a second tap clears the filter, as in the events list. Before, the first team was always selected.
- The helper plan link on an event opens the Helpers tab at that event's team and scrolls to the event, highlighted for a moment. Before, it opened the first team.
- Youth referee group: admins are no longer added as leads automatically. Admins assign the leads by hand like in any group; whoever is a lead now stays one.
- An admin in coach mode who no longer coaches any team is an admin again, instead of being stuck without the switch back.

## v0.7.0

- Coaches now see what is new for them after an update too, in the same card as the admins' release notes; admins see both.
- Coach buttons: whatever only coaches and other leads can do is marked in views that players and parents see too, in the club's main colour with a whistle (event page, carpools, helper plan, events list).
- Chat list: the number of unread messages instead of "new", rooms with news on top, and "3 new messages · 20 min. ago". In the chat a divider marks the first unread message, and the chat opens there.

## v0.6.0

- Saving works the same everywhere: switches and choices save at once and show "Saved" right at the switch; text fields have a button in their own card that appears once something changed. Administration → Club no longer has one button for the whole page: every card saves on its own. When editing a training plan, name, period and deadline have their own "Save plan" button, as training times already saved at once.
- New page under Administration for the game schedule sync (named after the source, e.g. "handball4all"): every team with its link, last sync, last error and upcoming games, with "Sync now". Admins choose when coaches are reminded to sync: after 15, 30 or 60 days, or never. The default is now 15 days (before: 14).

## v0.5.0

- Hints for coaches at the top of the events list: a game in the next 3 days without a meeting point ("Enter" opens it), and a game schedule not synced for 14 days ("Sync now"). Only for the coach's own teams; a hint goes away once it is done.
- The person search for helper duties and organisers no longer puts the typed name into the address: request logs (Workers Logs) record addresses, so names no longer end up there.
- Legal notice and privacy policy: the club profile now has a link for each (*Administration → Club*, the old combined link stays as the privacy policy). The app shows both under every screen, in the page itself and under every e-mail; admins see a warning until both are entered. The club is the provider of its installation, see `docs/privacy.md`.
- Demo: profile pictures, the club logo upload and the game schedules from handball4all are switched off; the demo links the legal notice and privacy policy of kabine.dev, and visitors cannot change these links.

## v0.4.0

- Children in the app: under *Administration → Age groups* admins set per youth class what children may do themselves (own access, respond, chat none/read/write, stand-in requests); coaches can restrict this further for their team under *Team → Settings*, for example a chat with parents only. Without an own access there is no player link and parents respond and chat for their child. Existing age groups keep everything allowed; new clubs get the sport's defaults (youngest classes without own access).
- Groups can include parents: under the group's settings an admin switches on *Include parents*, for example for a youth group across teams. Linked parents then see the group's special events for their children, respond for them and are in the group chat.
- Links with `?lang=en` or `?lang=de` (the demo links on kabine.dev and in the README) no longer reload the app over and over when the account has the other language: the link's language wins and is saved on the account. In the demo the shared accounts keep no language, so each visitor gets the browser's language.

## v0.3.1

- E-mail is off until a club sets it up, and new installations no longer get the Cloudflare Email Sending binding: it needs the Workers Paid plan. Use the club's SMTP server, or add `"send_email": [{ "name": "EMAIL" }]` to `wrangler.jsonc` on a paid plan (*docs/install.md*, E-mail). Existing installations keep their configuration.
- *Administration → Import* is now called *Import / restore*: it takes the club's lists and Kabine backups.
- The update pull request asks to replace changed workflow files only after the update is deployed. Replacing them right before merging could start a deploy of the old version that overlapped with the update, so the update was not installed.

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
