# Changelog

Release notes per version. The update workflow of a club's copy (`.github/workflows/update.yml`) shows the section of the new version in its pull request.

Changes that are merged but not released yet go under *Unreleased*, one line each, written for the people who run a club's installation. On a release the section becomes `## vX.Y.Z`, with an entry in `shared/changelog.ts` for the app (`test/changelog.test.ts`); items players and parents notice go in `everyone(…)` so that they also appear under *Help → What's new*.

## Unreleased

- Links to the documentation on kabine.dev: *Administration → Club → Modules* links to what each module does and stores, *Administration → Club mascot* to how the pictures should look, and the team's *Game schedule* to how syncing with its source works. Plain links that open in a new tab; the app loads nothing from kabine.dev. The documentation there now has a page per module and the install and operation guides in German and English.
- Notifications close after 24 hours: Web Push never expires a notification once shown, so the app closes older ones after the next push and whenever it is opened (on iOS not on every version).
- New module *Club mascot* (beta, off by default): admins upload pictures of the club's mascot under *Administration → Club mascot*: four faces for results (win, draw, close loss, clear loss; shown once results appear in the event list) and the picture on the large card and the head on the small tiles of the home game day. PNG, WebP or SVG with a transparent or white background, at least 256 pixels, faces square; the app checks and scales them before the upload (at most about 200 KB, SVG is turned into PNG or WebP). Without the module or without a picture nothing is shown. Blocked in the public demo. New table `mascot_images` with the pictures only (privacy texts updated). The home game day module no longer has its own mascot upload.
- New module *Home game day* (beta, off by default): on a day when at least 5 teams play at home (admins set the number under *Administration → Home game days*), everyone involved gets one personal push the day before at 12, 18 or 20 o'clock ("you play at 11:30 (wD)", "Lena plays at …", "your helper duty starts at …", topic *Home game day*): players, parents and coaches of the teams that play, their fans (with the fans module) and whoever has a helper duty that day. A large card on the start page from three days ahead, later days as small tiles in the list, and a page of the day with all home games, live links and open helper slots. With the club mascot module, its pictures appear on the card and the tiles. New table `gameday_sent` with dates only (privacy texts updated).
- New module *Fans* (beta, off by default): everyone can follow other teams of the club under *Profile → Fan of …* and turn on their games with a star on the start page, with start, venue, opponent and result only (no names, squad or responses), and the live ticker while a game runs. A push (topic *Games as a fan*) when a game is moved or cancelled at most 72 hours before it starts, optionally home games only, and a checkbox *Games as a fan* in the personal calendar (off by default). A button with the club's abbreviation for all games of the club can be turned on per device. New tables `fan_follows`, `fan_home_only`, `fan_calendar` (privacy texts updated).
- Events on the start page: the team buttons at the top now each switch their team on and off, and the list shows the sum (all on by default, a new team is on; everything off says "Nothing selected"). Chips under *Upcoming/Past* show only trainings, games or other events. The choice is kept on the device (browser entry `kabine-home-list`, listed in the privacy texts). Games show a short title such as "SVM 2 – HSG Opponent" with the team inside a ball on the right, whose small mark shows your own response; home games carry a yellow "Home" tag. The big card names the team after the date, and an event that starts before it (such as an unconfirmed optional training) now appears above it. Sport profiles have short codes for team names (e.g. "Men 1" → "M1").
- Groups: admins can mark a group as *Training group* in its settings (e.g. a goalkeeper group). Its special events then appear on the start page under the chip *Training* instead of *Other*, and the big card says "Up next: training". Nothing else about these events changes (responses, deadlines and statistics stay those of a special event). New column `teams.training_group`, off for existing groups.
- Polls (orders): creator, coaches and admins see *Quantities* per item with the amount and per size, and can download the orders as an Excel file (quantities, orders with payment state, one line per item). The file is built on their device and contains names; the club is responsible for the copy.
- Polls: creator, coaches and admins read last names and the players' other teams in the order list, "not ordered yet" and results ("Family Kaiser: Ben (U13 boys), Kim"); participants keep first names.
- Polls: fewer database reads. The list counts votes only for managers, and participants of an order load only their own order.
- Game schedules sync by themselves after games: with handball4all and handball.net, when a coach of the team opens the app after a game without a result (kick-off plus playing time plus an hour), the coach's device syncs once in the background, at most twice per game, and once a week otherwise (handball4all used to sync only at the press of a button). Admins without a coach role never trigger it. The button stays for games moved or cancelled at short notice, for coaches at most once an hour per team. Every sync now also tells the coaches when a game moved (old and new time), and the team and the coaches when a game is no longer in the schedule (it counts as cancelled) or is back in it; fans of the game hear of it at short notice; new games go to the coaches only; results come without a push. The league table from handball4all comes with the same fetch and shows collapsed on the game page and the fans module's game page (own position and points, expanded the whole table with "as of"). New table `league_tables` and two columns on games (migration; privacy texts updated).
- Coaches see where their players take part elsewhere: on their own event under *Elsewhere the same day* (events of other teams and groups that day, with time, team and status, overlaps with their own event marked) and on the team's player page under *Further events of …* (next two weeks). Never the decline reason and no link to the other event; games count only with a nomination, optional events only with a yes. Coaches and admins of the team only; nothing new is stored (privacy texts updated).
- Docs: switch off *Builds for Preview branches* in the Worker's build settings (*Settings → Build → Previews Base*). Left on, every update pull request shows a failed check "Workers Builds", although the deploy after merging works (`docs/install.md`, step 1).

## v0.9.0

- New module (beta, off by default): polls. Coaches ask their team or group, admins the whole club: choose an answer, find a date (yes/maybe/no) or collect orders with prices, sizes, product photos and payment (PayPal.me and bank transfer with QR code, set under *Administration → Polls*). Optionally one vote per family, anonymous, results only after the end. An open poll sits at the very top of the start page with a dot on the Events tab and counts on the app icon; orders can be ignored. Participants of an order see only their own order. Polls are deleted at the season change and are not in the export.
- New module, on by default for handball clubs like handball4all: game schedules from handball.net for clubs whose association runs its games in Handball360. The coach pastes the team's link from handball.net (or its calendar link) under *Team → Settings* and syncs with "Sync now"; the device fetches the team's public calendar. The schedule also syncs once a week by itself: when a coach opens the app and the last sync is 7 days or more ago, the coach's device syncs it in the background. Games link to their page on handball.net.
- Helper duties: a duty type can be *assigned by the coach*. Nobody signs up themselves; coaches, admins and organisers assign people who fit "who helps", and the person (or the parents of a child) is told at once and can withdraw.
- Helper duties: each template line and time slot says where its helpers come from: as the duty type, from certain teams (e.g. wipers from the youth at adult games), or, in templates, teams taking turns game by game; the team in charge is told in its chat a week before, and coaches can swap it per game. Helpers from other teams find these duties in the Helpers tab under *Help out*. Admins can merge duplicate duty types. Existing duty types and templates keep working as before.
- Helper duties at club events: special events for the whole club can have time slots too. Everyone who fits "who helps" in any team can sign up; admins and organisers manage them. They show in the Helpers tab under *Whole club* and together with the own teams; there is no "helpers wanted" for them.
- Helper duties: the event page of a special event has *Manage helper duties*, the same sheet as in the Helpers tab (several time slots in a row, templates, assigning people). A time slot with entries can now be removed after a confirmation, and the entries in the sheet show the slot's time.
- Helper duties: two more switches on a duty type: *Send "helpers wanted"* (on by default; when only one duty is wanted, the message names it) and *Adults only* (nobody under 18 by birth year takes it).
- Helper duties: a time slot can take 2.5 hours.
- Special events have three new switches for how people respond, at most one at a time: *Without attendance* (nobody accepts or declines, no reminders; helper duties stay), *Optional attendance* (whoever wants to join says yes, nobody is reminded) and *Registration per family* (each family says how many people come; coaches, admins and organisers see the families with their number). Switching an existing event to registration per family warns how many responses no longer count and tells everyone invited. Organisers without coach rights see who said yes at events with optional attendance.
- *Administration → Special events and games* now lists all upcoming ones, also those the admin already sees under Events.
- Events: an event that has started stays under *Upcoming* until it ends, with "right now" on the big card. When the next event is today, its yellow head gets a calm light sweep and "today" a dark pill (off with reduced motion); the whole head opens the event.
- Wording: the accept button for someone with a standing absence says "Back in"; optional events and trainings say "You did not say yes" instead of "Not joining". The hint to decline in good time shows only where it applies (not for optional participants, standing absences or after declining).
- Notifications: instead of the hint card in the installed app, the home screen now asks once per device "Turn on notifications?", with a button that opens the system prompt directly. It only asks where push works (on the iPhone only in the installed app) and where it is not on or blocked yet; "Later" never asks again on that device. The demo privacy policy lists the new browser entry `kabine-push-asked`.
- New page *Help → What's new* for players and parents: what changed for them in each release since the club started with the app, built from the release notes, with the app's birth announcement at the end. The start is the day the setup wizard was completed; existing installations take the day of their first access (database update).
- Admins who are parents (without coaching a team) now also get *Work as admin* in their profile; switched off, they see the app like other parents.
- Pushes about a person now address the recipient: parents read "Mia is in the squad" or "Is Mia coming?" instead of "You are in the squad"; with several children or when they play themselves, all of them are named in one push.
- Parent link for one child: coaches open a player under *Team → Squad* (admins also under *Administration → People*, which says why there is none, e.g. when parents are switched off in the team) and create a link for the parents of that child, with a text to send. It links only this child, works for both parents and is valid for 7 days, so parents who are not in the group chat no longer need the team's parent link.
- Team links: once more than 5 players (or parents) of a team have an access, creating a new player or parent link shows a hint to send the few still missing a personal link or a parent link for their child instead. Creating the team link stays possible.
- Server errors: people never see the technical error text any more. When Cloudflare is overloaded (e.g. the database limit of the account) the app says that things are busy and to try again in a few minutes. Errors are counted per day, and from the third error of a day the owner of the installation gets one e-mail with the list (needs a confirmed e-mail address in the owner's profile).
- Fewer database reads: teams, memberships, parent links and duty types stay in memory per Worker instance and are reloaded only after a change, and the helper duties of games are checked only when something changed. This keeps clubs further below the daily limit of the free plan. `npm run d1:stats` shows the read load of an installation.
- Sign-in: opening the sign-in page and requesting sign-in codes no longer write to KV, which allows only about 1,000 writes a day for the whole Cloudflare account on the free plan. The passkey challenge is now signed instead of stored, and is booked in the database only after a successful sign-in, so it cannot be used twice. The limit of code requests per network address now counts in the database (a keyed hash, IPv6 by its /64 prefix, emptied after an hour). The update adds a small table and a column (migration).
- Invitations: setting up an access with an invitation link no longer writes to KV either. The passkey registration now carries its data encrypted in the request instead of storing it for five minutes, so a shared team link cannot be used to exhaust the account's daily KV writes.
- Setup wizard: the chosen sport could jump back to handball when the step reloaded its data in the background; the choice now stays.
- Privacy: `docs/privacy.md` now also lists feedback (sent by e-mail, a daily count per access) and the hourly count of sign-in code requests per network address (as a hash). Clubs can add both to their privacy policy.
- Update workflow (`.github/workflows/update.yml`): only releases (`vX.Y.Z`) become update pull requests, never test versions such as `v0.9.0-rc.1`. Replace the file in your copy after the update, as the pull request describes.

## v0.8.0

- Statistics: coaches see *Team → Statistics* for the last 4 weeks or the season: training participation, appearances in games, a table per training and game, and each player's events. With the helper plan also the helper duties per family, with a button to remind the families without a duty. Players and parents see their own figures under *Profile → My statistics* (for parents per child), with the family's helper duties.
- Qualifications: a duty type that needs prior knowledge can now be approved by an admin instead of by the person (e.g. tournament management). Admins approve people in the person sheet, on the new page *Administration → Approvals* or with a link; people without the approval do not see such a duty. The youth referee role is now such an approval of the youth referee duty: existing youth referees, links and the youth referee group are taken over by the update. The separate module "Youth referees" is gone; its duty is part of the helper duties. Under *Administration → Age groups* admins tick which home games get it, and other duties of approved people work the same way (e.g. referees in other sports).
- Admins can delete a duty type that is used nowhere (no template, no age group, no time block at any event, past ones included); its approvals go with it. A duty type in use can still only be archived; the sheet says where it is used.
- *Who takes it* of a duty type can now be changed later. The youth referee can thus become a duty of the team like the others: put it into the home game template of the teams that need it (e.g. a template "Home game E youth"); age groups no longer add it on their own, approvals stay.
- New installations: the youth referee is a duty of the team, approved by an admin, and in no template; a further template "Home game adults" with only washing the shirts goes to the adult teams. Existing installations keep their duty types and templates.
- Security: sign-in codes by e-mail or SMS can no longer be guessed with many parallel tries; at most five codes per address and hour and ten per day.
- Security: the role next to a name in the chat (e.g. "Coach") can no longer be faked by a modified app.
- Security: open chats follow rights at once. Whoever is removed from a team, leaves the club, loses a parent link, admin rights or a device, or whose parents switch off the chat, is disconnected; the app reconnects with the rights that are left.
- Security: a personal link on an existing access no longer sets an e-mail address for sign-in; it sets up a new passkey as before. If the address of an access may not be the person's own, admins switch on *Also remove the e-mail address for sign-in* in the person's sheet before creating the link: using the link removes the address, and the person can enter a new one. The protocol shows when a personal link was used on an existing access.
- Security: the limit for sign-in codes no longer shows whether an address belongs to someone in the club; unknown addresses are counted the same way (as a hash, nothing is sent).
- Security: restoring an export can no longer move an existing access to another person, which another admin could have used against the owner of the installation.
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
