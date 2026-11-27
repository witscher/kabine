# Decisions

Decisions not covered by `docs/dev/roadmap.md`, with reasons. Newest first.

## Event list on home: team buttons, kind chips, ball (November 2026)

Ported from the original club app into the core (docs/dev/design.md, Event list on home). Where Kabine differs:

- **Filter inside the query:** the team selection and the kind go into the batch query of `visibleEventBatch` and into `ownCandidates` (`listFilterSql`), not only into a check after loading, so a team with few events does not make the page loop through the whole season. `teams=none` reads nothing. The older `team=<id>` stays as an alias for apps still cached on devices.
- **Club-wide events** stay in the list as long as any team is on; they belong to every team. The club app hides them when not all teams are on.
- **Stored per device by team id** (`kabine-home-list` in localStorage, with the kind chip), not by name, so renaming a team keeps the selection. The former team filter in sessionStorage is gone; the privacy texts list the new entry.
- **Short title with the club abbreviation** (`clubAbbr`, as in the full game title) instead of the club's short name, which often carries the sport ("SVM Handball").
- **Short codes in the ball from the sport profile** (`teamShorts`, words in every language clubs name their teams in, `ADULT_TEAM_SHORTS` for the common adult teams) with initials as the fallback; the club app has them as constants for its own team names.
- **No club button and no fans yet:** the club app's button for all games of the club is not ported. The module "fans" adds its star button and its rows through hooks later; the row of buttons and the list rows are prepared for it (`ListButton`, `ListRow`), the hooks are not.
- **Announcements:** Kabine's announcement on home (`shared/motd.ts`, none set) has no audience and no sign-off, and the release notes for coaches (`NewsCard`) have no sign-off either. So only the button link (`link`) is ported; there was no sign-off to remove.
- **Holiday notes beyond the loaded events** now show at the end of "Coming up" once nothing more follows; the line was in the "Past" section, where it never showed.

## Module folder `shared/` (November 2026)

The polls module builds its Excel export in the browser and tests the file in Vitest. The app and the worker are separate TypeScript projects: `app/` is only in the app's, `test/` only in the worker's, so a test could not import app code. `tsconfig.app.json` and `tsconfig.worker.json` now both include `modules/*/shared`, the module's own counterpart of the core's `shared/`, for pure code both sides use. Code there must run in both: no DOM, no Workers bindings.

## Cached teams and roster for modules (November 2026)

Managers of an order need last names and teams to hand it out (`modules/polls/`). The teams of every player are already in the cache per Worker instance (`worker/lib/cache.ts`), loaded by `loadEventContext`. `worker/domain/events.ts` now exports those two loaders as `cachedTeamInfo` and `cachedRoster` (with the team kind, so groups can be left out) instead of a module running its own query: same cache entry, no extra rows read once the event list has loaded them. No new hook: modules already import core domain helpers, and these return frozen data, so a module cannot change what the core sees.

## Polls: names, photos, payment (November 2026)

Ported from the original club app as the module `modules/polls/` (README there).

- **Names in scheduling polls:** participants see who answered what as "First name L." when the poll is not anonymous. This is an exception to "names only to coaches and admins": finding a date for a party only works when people see who can come. The form says so under the switches. In choice polls participants see counts only, in orders only their own order.
- **Product photos like profile pictures:** in D1, shrunk on the device, served under `/api` with the session and the version in the URL (`private, immutable`). The club app serves them through a signed URL outside `/api`; Kabine keeps one way of serving pictures, and the browser cache makes the extra session check rare.
- **Payment details in the module:** PayPal.me name, account holder, IBAN and a currency (EUR by default) in `app_meta` (`polls_payment`), set under *Administration → Polls*; never a link in code. The demo blocks changing them and uploading photos, as visitors would send every other visitor to their own account.
- **Not in the export:** polls are short-lived and gone at the season change; a restore would need to map units, options and persons.

## Module hooks for the polls module (November 2026)

Polls (`modules/polls/`) need places in the core screens a module could not reach yet. Each hook is generic and as small as the first user needs:

- **App:** `homeCards` (cards at the very top of the start page, for something that waits for the person: an open poll), `eventsTabDot` (the dot on the Events tab while such a card is there; a component, so it can load data without breaking the hook order of the tab bar), `profileMenu` (entries on the profile page, like `adminMenu`, for the person's own polls). No hook for the team page: coaches pick the team in the poll form.
- **Worker:** `badgeCount` (adds to the number on the app icon; runs for every push, so one cheap query), `seasonChange` (cleanup in the season change batch: polls are gone with the season), `exportExcluded` (tables a module leaves out of the export on purpose; polls are short-lived and their ids would need a mapping on restore).
- **Chat:** system messages may carry a link to a page of the app (`postSystemMessage(…, link)`), only a plain path such as `/umfragen/12`, checked in the chat room. So the chat note about a new poll opens it.
- **Notification topics:** the CHECK on `notification_settings.topic` listed the core topics and `carpool`. A module topic (`polls`) would have needed a core migration rebuilding the table every time. Migration `202611200100_core_notification-topics.sql` rebuilds it once without that list; the code checks topics (`worker/routes/parents.ts`).
## Home game day (November 2026)

Ported from the original club app as the module `modules/gameday/` (beta, off by default). Where Kabine differs or had to decide:

- **Name:** German "Heimspieltag", English "Home game day". The club app says "Großer Heimspieltag" because a youth matchday at home is also called "Heimspieltag" (`eventTitle`); the maintainer chose the same word for both (November 2026): the hall is open and games are played either way. The card and the push say how many teams play.
- **What "enabled" means:** the module switch turns the card, the tiles and the page on and off; the setting *Message the day before* only the push. The club app's single switch did both, but in Kabine the module switch already exists.
- **Settings cached, days cached:** the list on home asks the module on every page load. Settings (`app_meta` key `gameday`) are cached with version `ref`, the club's upcoming home games with version `duties`; migration `202611230400_gameday_sent.sql` adds triggers so that settings, cancellations and venue changes bump them too, also when changed directly in D1. The club app read the settings and checked the day again on every load.
- **Sent once:** a table `gameday_sent` (one row per day, claimed with `INSERT OR IGNORE` before sending) instead of a single `app_meta` value, so two runs cannot both send and a missed run (maintenance, update) can catch up within three hours of the configured hour, never late at night. Markers older than a week are deleted.
- **Mascot picture:** optional, uploaded by an admin and stored in KV like the club logo; without one no picture is shown. The club app ships its own mascot. The public demo blocks the upload.
- **Coaches and staff** of the playing teams are involved like players (the club app had no staff role); they read their team's name.
- **Fans and duties only with their modules:** followed teams through the hook `follows`, helper duties only while the duties module is on; the page links other games to the fans module's game page only while that module is on.
- **Not ported:** an admin's own text per day and merging the push with the duty reminder (the club app postponed both too).

## Module hooks for the home game day (November 2026)

The module "home game day" (`modules/gameday/`, ported from the original club app) builds on the hooks added for the fans module (home list rows, cron, notification topics, pages, admin menu, `gameLinks` with a `GameRef`). It needed four more places, each generic:

- **A large card on home (app `homeList` → `card`):** the day's card sits in time order with the card of the next event (above it when its day is on or before that event's day), not at the very top like `homeCards`, which are for something that waits for the person. `covers` lists the events the card shows; rows of other modules about them are left out, so a game one follows is not listed twice (the club app's `onGamedayCard`). The covering module decides what it covers: the home game day leaves running games out of `covers`, so their live link stays in the list.
- **Followed teams (worker `follows`):** the home game day tells fans of the playing teams and marks their games, but may not import from the fans module, which it does not require (fans may be off). The fans module answers through the hook; `moduleFollowedTeams` and `moduleFollowers` in `worker/modules.ts` are empty while no module with the hook is on.
- **Push texts per account (`enqueuePushEach` in `worker/domain/notify.ts`):** the existing helper behind `notifyPersons`, now exported. The day's push is not about persons of an event ("you play at 14:00 (Women)", "the U15 boys play at 13:00", "your helper duty starts at 11:00"), so it is built per account and still sent together where texts match.
- **Cache versions on the actor (`Actor.versions`):** read in the same batch as the actor already; with them a hook reads cached data without a query of its own. The home card thereby adds no query for people without a home game day ahead.

## Module hooks for the fans module (November 2026)

The module "fans" (`modules/fans/`, ported from the original club app) shows games of teams one follows in the event list on home, tells fans about games moved or cancelled at short notice, and puts the games into the personal calendar. The core needed places for that; each hook is generic, so the module "home game day" (ported next) uses the same ones:

- **Home list (app `homeList`, worker `eventPage`):** a module adds buttons after the team buttons, query parameters for `GET /events` (`<module>.<key>=…`, the core forwards only these, without the prefix), rows sorted into the list by time, and a line under the greeting. Its data comes in the same request as the page (`EventPage.modules[<id>]`), not in a second one, and inside the page's window (`EventPageQuery.from/to`: up to the last day of the page while the core has more), so "More events" keeps the order. A module that has more rows than it sent says where it stopped (`more`), and the list stops there too. A module can take over the list (`takeover`, the club app's button for all games of the club): the team buttons look off, the chips are hidden, the core lists all its events of one kind; tapping a team gives up the view and brings the earlier selection back with that team on. The selection of a module is kept per device in the core's `kabine-home-list` under `modules.<id>`. `homeList` is a plain function, not a component, because its rows are sorted into the core's list; it is called twice per render: first without data for the query parameters, the takeover and whether its part is on (`active`, so a selection of only the module's rows is not "Nothing selected" while the page loads), then with the page's data for buttons and rows. Rows about an event the core lists itself are shown once, as the event (a fan game one helps at).
- **Game changes (worker `eventChanged`):** after the core has told the teams that an event was cancelled, its cancellation withdrawn, or its start or venue changed (by hand or by a schedule sync), modules may tell others. Changes of the end or the meeting point do not count.
- **Calendar (worker `calendarItems`, app `calendarOptions`):** entries of a module in the personal calendar feed, and its own rows under *Profile → My events*. The module stores the choice itself, so the core's `calendar_tokens` stays as it is.
- **Notification topics only for oneself:** a manifest topic with `self: true` is not offered per child under *Profile → Notifications* (games one follows are per account).
- **Game links for games without an event page:** `gameLinks`, `isLiveWindow` and `GameLinks` take a `GameRef` (id, kind, start, cancellation, game data) instead of a full `EventSummary`, so a fan game, which has no squad or responses, can show the live ticker of the fixture modules.
- The profile entry ("Fan of …") is the existing `profileMenu`; the page of a game is a module route.

## Fans (November 2026)

Ported from the original club app as the module `modules/fans/` (beta, off by default). Where Kabine differs or had to decide:

- **Tables of the module instead of core columns:** `fan_follows` (the club app's `team_follows`), `fan_home_only`, and `fan_calendar` instead of a column `calendar_tokens.fans`, so the core's calendar table stays as it is. Off by default, also for links made before. No migration for the notification topic: `notification_settings` has no CHECK list any more.
- **Season change:** follows stay. Teams keep their ids, only people are reassigned; a follow of a team one now plays in is ignored while one is in it (and comes back into effect if one leaves the team). A deleted team or access takes its follows along.
- **Export:** follows and *Home games only* are in the export and the restore (they are club data like the notification settings, and the restore maps account and team ids by foreign key). The calendar choice is not, like the calendar links. The club app leaves follows out until Kabine has them.
- **Game page for every signed-in person:** `/spiel/:id` shows a game of any team of the club (not of groups) to everyone signed in, as in the club app, because start, venue, opponent and result are public anyway (association schedule, calendar export). The event page, squad, responses and names stay as they were.
- **Push:** parents count as members of the team (no fan push) only where parents are involved, the same rule as for whose teams are one's own; elsewhere a parent may follow the child's team like anyone else. Withdrawing a cancellation at short notice also reaches the fans, as in the club app.
- **Live link:** from the fixture modules' `gameLinks` (phase `live`) for the game's source, not from the handball4all fields of the club app.
- **Not here:** hiding fan games that the home game day card already shows comes with the module "home game day".

## handball.net out of beta, weekly sync from the coach's device (November 2026)

The handball.net module is stable and, like handball4all, on by default for handball clubs; a club with both chooses the source per team, as before. Its schedule also syncs once a week by itself, because coaches forget the button and games are moved during the season. The sync stays where it was: on the coach's device, the same way as "Sync now" (claim, fetch from handball.net, import). The server never fetches, there is no cron and no push, and nothing blocks the app: when a coach of the team opens the app and the last sync (`teams.fixture_synced_at`) is 7 days or more ago, the device syncs once in the background; if no coach opens the app for a week, the next one who does syncs. That is far below what a subscribed calendar app does (every 6 hours), so the calendar is still used as the public export it is.

It builds on the reminder rather than adding a second mechanism. The connector declares `autoSyncDays: 7` (`worker/module-api.ts`); the coach hints (`GET /api/coach-hints`), which the events list loads for coaches anyway, answer with the due teams in `autoSync` next to the hints, from the same query and with the same rule (`scheduleStale`, linked, module on, season not played), so the check costs no extra request and no extra rows. The server refuses an automatic claim that is not due (`not_due`) and keeps the existing reservation (`fixture_claimed_at`), so two devices never sync a team at the same time. handball4all declares no `autoSyncDays` and stays at the press of a button (`manual_only`), because its interface is meant for fair use by hand. The 15-day reminder stays for every source; for handball.net it only shows when the weekly sync has not worked, e.g. after an error, which stays on the team (*Team → Settings*, *Administration → Game schedules*) instead of an alert, and is tried again at the next app start. The device tries each team at most once per app start. Admins sync by themselves only for teams they coach, like their hints.

## Coach hints in the core, without a module hook (November 2026)

Coaches see at the top of the events list what is left to do in their own teams: a game schedule not synced for 15 days (adjustable, see below), a game in the next 3 days without a meeting point (`worker/domain/coach-hints.ts`, `src/coach-hints.tsx`). The club app's note proposed a module hook for the schedule hint, because there the sync belongs to the handball4all code. In Kabine linking and syncing are already the same core code for every connector (`worker/routes/games.ts`, `syncGames`), and every sync starts on a coach's device (by hand, or weekly for handball.net, see above), so the hint works for every source from `teams.fixture_synced_at` without a new interface. A hook for home hints can still come when a module has a hint of its own.

## Reminder to sync: in the club profile, one admin page for every source (November 2026)

The club app keeps the threshold in a loose `app_meta` key and the page is about handball4all only. In Kabine the setting `scheduleReminderDays` (15, 30, 60 or 0 for never, default 15) is part of the club profile, saved with `PUT /api/admin/club` like the other club settings, and read per request with the club context, so the coach hints need no extra query. The admin page covers every fixture connector, because syncing is core code; its menu entry and title carry the source's name when only one is switched on ("handball4all"), otherwise "Game schedules". Whether a team's coaches are reminded is computed on the server with the same rule as their hint (`scheduleStale`).

## Children in the app: limits per age class and team (October 2026)

Ported from the original club app, where the club restricts F and E youth: what players of a youth class may do themselves (own access, respond, chat none/read/write, answer stand-in requests) is a limit per age class, set by admins, because it depends on age, treats all teams of a class alike and moves along with the season change. Kabine adds a second level per team, set by its coaches: some coaches want a chat with parents only even where the club allows more. Each level only restricts; parents' permissions apply within both. Without an own access a child does nothing themselves either (the club app's "variant A").

- **Columns, not JSON:** `age_classes.child_*` with the club app's names, and the same nullable columns on `teams` (NULL = as the age class). Push recipients and the badge need the values in SQL, where `min()` over columns is simpler and cheaper than `json_extract`.
- **A team value looser than its age class is refused** (400), so a coach never believes something is allowed that is not. What applies is still the stricter of both, also when the class becomes stricter later. Team values stay over the season change, as the team does.
- **The team level needs parents in the team:** without parents nobody but the coach could respond. The age class level applies regardless, as in the club app; admins get a hint for such teams.
- **Defaults:** the migration changes nothing for existing clubs (nobody loses a right by an update). The sport profiles bring defaults for new clubs: handball Bambini, Minis and E, football U7 to U11 without own access; the generic profile allows everything.

## Groups can include parents (October 2026)

Groups used to have no parents. A youth group with children, such as goalkeeper training across teams, then showed its events only to children with their own access. Groups now have the "Include parents" switch of teams (admins, off by default); with it on, parents take part as in a team. Groups still have no parent invitation links: parents are linked through the child's team, and a group alone is no reason to bring new parents into the app. The youth referee group follows the role and stays without parents.

## No database of the club's own (October 2026)

Checked whether an installation could use its own PostgreSQL or MySQL server through Cloudflare Hyperdrive (reached through a Cloudflare Tunnel) instead of D1. Not done, and not planned:

- It cannot be a module. The module hooks take `D1Database` and hand `D1PreparedStatement`s into the core's batches (`worker/module-api.ts`), and the module switches themselves live in the database. It would be a rework of the core: about 450 queries in 65 files written in SQLite's dialect (`json_each` lists, `INSERT OR IGNORE`, `RETURNING`, `strftime` defaults, partial unique indexes, `PRAGMA` in the restore), plus migrations, deploy script, admin link, seed and the test setup, all built on Wrangler and D1.
- Every migration and query would have to be kept working on two databases, for good. MySQL would add more gaps (`RETURNING`, `||`, partial indexes).
- Clubs would lose what D1 gives them for free: no server, encryption at rest, and the Time Travel restore point before every update with migrations. They would have to run the server, the tunnel, backups with point-in-time recovery and monitoring themselves. The Worker, KV, queue and chat would still run on Cloudflare, so it buys little independence.

Self-hosting is meant to come through workerd and the official support for Workers on one's own infrastructure. The website says so in the FAQ (“Why not a database on our own server?”) and in the outlook on the board and privacy page.

## Update pull requests without merging Kabine's history (October 2026)

The update workflow of a club's copy used to merge the release tag into the copy (`--allow-unrelated-histories`). That pushes Kabine's whole history, including commits that change `.github/workflows`, and GitHub refuses any push that changes workflow files with the workflow's own token. Now the update is one commit on top of the copy: the release's files, the club's `wrangler.jsonc` and the copy's own workflow files; the pull request lists changed workflow files with links to copy by hand. Copies from before v0.2.0 replace `update.yml` once by hand and switch maintenance mode on for that first update, because the running old version does not know the automatic pause (`docs/operation.md`, Updating an older copy). Releases are tags `vX.Y.Z` with a section in `CHANGELOG.md` and an entry in `shared/changelog.ts`; v0.2.0 is the first tag. Tried end to end on a test installation made with the deploy button: the button does not copy `.github/workflows` at all, so the installation guide adds the update workflow as a step; GitHub refused `gh pr create` (GraphQL) to the workflow's token in that copy while the REST call works, so the workflow uses REST and falls back to an issue with a link.

## Website kabine.dev for search engines (October 2026)

The website has content pages besides the two start pages (`site/src/pages.mjs`: why Kabine, handball, football, youth coaches, board and privacy, three features), the club documentation and release notes as pages (`site/src/docs.mjs`, rendered from `docs/*.md` and `CHANGELOG.md` at build time), a sitemap with language versions, canonical and share tags, structured data and a share image per language (`npm run site:og`). The pages only make statements about Kabine itself: no comparison with other apps by name, because comparative advertising must stay objective and current (§ 6 UWG) and a private publisher would carry that risk. Visitors are no longer redirected to the English page by their browser language; they get a hint instead, because crawlers with an English browser would otherwise never see the German start page. `robots.txt` allows search and AI answers (`Content-Signal: search=yes, ai-input=yes`) and says nothing about AI training. The build fails on dead internal links.

## Controlled updates (October 2026)

Clubs update by merging a pull request, so the deploy itself has to be safe without anyone watching. `npm run deploy` (`scripts/deploy.mjs`) replaces the plain chain of build, migrations and upload. With pending migrations it notes a D1 Time Travel bookmark, sets a mark in `app_meta` (`update_in_progress`, expires after 15 minutes), applies the migrations, uploads and removes the mark; it records the last update in `app_meta` (`last_update`) for *Administration → Updates and maintenance*. While the mark is set the API answers 503 `updating` to everyone, admins included, and the cron run pauses, so nobody writes into a half-migrated database. Without migrations nothing pauses.

The mark is in D1, not in KV like the manual maintenance switch: the script only knows the database binding of the club's `wrangler.jsonc` (the deploy button fills in the KV ID, the script cannot read it reliably), and the Worker reads the mark in the same query as the club profile, so it costs no extra read. Admins get the maintenance switch on the same page.

`0001_init.sql` is frozen from now on: the repository is public and installations run it. Every migration keeps the previous release working (expand now, contract in a later release), because the old Worker runs on the new schema for the seconds between migration and upload and after a rollback in the dashboard. Every migration has an upgrade test (`upgradeFrom` in `test/helpers.ts`), `test/migrations.test.ts` enforces both the hash of `0001_init.sql` and the test.

## Picking players from other teams (October 2026)

When a coach adds a player from another team, picks a permanent stand-in or requests a stand-in for a game, the list can be filtered by the team the people come from (chips only when there is more than one). Whoever is in the core squad of their own team is marked and listed first, since that is usually what the coach wants to know. The hint names the actual source teams instead of "the second team": stand-ins come from lower-ranked teams of the same age class (higher level, e.g. wC3 for the wC2) and the next younger youth team, and players can be added from any other team of the same age class or the next younger one. `teamCandidates` (`worker/routes/squad.ts`) returns `teams: { id, name, core }[]` per person; the list is `src/candidates.tsx`.

## Modules in their own folders, for contributions with coding agents (October 2026)

Before going public, the repository is shaped so that someone with an idea and a coding agent can add a module, a game schedule source or a provider without knowing the core. Every module is a folder `modules/<name>/` with a manifest (`module.ts`: id, kind, status, default, dependency, sports, API paths, texts, privacy), an optional worker part and an optional app part. The core calls hooks (`worker/module-api.ts`, `src/module-api.ts`) instead of knowing the modules: routes, cron, data on event cards and the event page, cleanup when participants drop out or people leave, export tables, tabs, admin entries, game links. Worker and app parts are found by the build (`import.meta.glob`), the manifests are listed in `modules/index.ts` so the module ids stay typed. Contract tests (`test/modules-contract.test.ts`, `test/fixtures-contract.test.ts`) run for every module, and `npm run new` creates a module or connector that passes them. New modules start as beta, switched off. `AGENTS.md` is the entry point every coding agent reads; `CLAUDE.md` imports it and adds the maintainer's notes.

Game schedules are no longer tied to handball4all: a source is a module of kind `fixtures` with a `FixtureConnector` (parse a pasted link, what to fetch, parse the response into normalised games). Linking, the reservation that keeps devices from fetching at the same time, the sync and its notifications are the core's (`worker/domain/fixtures.ts`). The schema stores the source per team as JSON (`teams.fixture_*`) and games and halls by `external_ref` (`"<module>:<id>"`) instead of `h4a_*` columns; `0001_init.sql` was still editable. Only permitted access is accepted (official API, public export or the association's permission); sources may be fetched by the server or, where only browsers are allowed, by the coach's device.

The helper duties stay partly in the core: one's duties on event cards, in the calendar and on the event page, the duty blocks of special events and the live channel (Durable Object) are core screens and rules that check whether the module is on. Moving them behind hooks would have touched most of the event code for little gain. The duties module holds its API, reminders, the Helpers tab and the admin page. The SMS module provides a text channel (`worker/domain/texts.ts`) that the core uses for sign-in codes and reminders; the phone number in the profile and the SMS sign-in stay core screens. Games entered by hand and the club member marker were base routes that had lived in module files; they moved back to the core.

The developer documents stay in `docs/` next to the club documents for now; the READMEs link them by these paths.

## No variables in the club's configuration (October 2026)

`wrangler.jsonc` has no `vars` for a club installation. The "Deploy to Cloudflare" button shows every variable as a field, and `RP_ID`, `ORIGIN` and `MAIL_FROM` had no explanation there although the app does not need them: it takes its address from the request (and remembers it for push and mail), and the mail sender from the setup wizard. They stay available as optional Worker variables (`docs/operation.md`, Optional variables). The demo environment sets them, because it runs on one fixed domain.

## Public demo and project website (October 2026)

`handball.kabine.dev` is the environment `demo` of `wrangler.jsonc` (Worker `kabine-demo`, own D1, KV, queue, Durable Objects; `APP_ENV=demo`). Visitors sign in by link per role (`/api/demo/login/<player|parent|coach|admin>?lang=de|en`), without passkeys. Four shared accounts, so everything that could lock others out or leave the demo (passkeys, e-mail, SMS, owner handover, invitations, feedback) is blocked (`worker/demo/routes.ts`). At 3:00 Berlin time the cron wipes database, KV and chats and fills them again from `seed/demo.sql` plus scenes made through the app's own API (`worker/demo/reset.ts`), so games and responses are always dated relative to today and the season moves on by itself. The cron runs hourly and checks the Berlin hour, which covers summer and winter time. Secret `DEMO_RESET_TOKEN` allows a manual reset (`npm run demo:reset`). The demo is deployed from `main` by `.github/workflows/deploy-demo.yml` (needs the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEMO_RESET_TOKEN`), so it always runs the latest version.

`kabine.dev` is a static Worker (`site/`, built by `npm run site:build`, German at `/`, English at `/en/`) with the demo screenshots and links. The publisher's details for the legal notice come from `site/legal.json`, which stays out of the repository.

## Optional joint training (October 2026)

Some coaches let their team join another team's training by choice. In a joint training time ("together with") each team is mandatory or optional; a coach can change it for a single training, and that choice stays when the plan is generated again (`event_teams.optional_manual`). At least one team always trains as usual.

For players whose teams all join optionally: no automatic acceptance (they accept by hand), withdrawing needs no reason and is never "at short notice", no reminders, no "absent without excuse", and they are told about cancellations and moves only once they accepted. In the attendance record and the season statistics they appear only when they accepted, so not joining never counts as missing. A player who is also in a mandatory team of the same training counts as mandatory. The event shows the mark "Optional"; the big "Up next" card only shows an optional training once it is accepted. Coaches see the optional players without acceptance in their own group "Optional, not said yes". If a coach switches a team to mandatory after someone withdrew, that withdrawal counts as a decline.

## README in English first (October 2026, replaces "README in German first")

`README.md` is English and written for developers, `README.de.md` German, each linked at the top of the other. Clubs find Kabine through kabine.dev, which is German first and answers their questions (costs, GDPR, why Cloudflare); people who arrive on GitHub are mostly developers, and they read English. So the README leads with what Kabine is, the demo, a quick start and how it is built, and keeps the club topics short with links. Code, comments and the technical documentation stay in English.

## Holiday plans in the timeline (October 2026)

While a holiday plan applies, or before it starts, the event overview shows a note where it begins: "Autumn holidays, 26 Oct to 30 Oct: holiday training times for wD" or, for a plan without training times, "no training for wD". A plan that has already begun stands at the top with "until". So nobody wonders why trainings are at other times or missing. The notes come with the page of events (`breaks`) for the teams one plays, coaches or looks after and the children's teams; plans of several teams with the same name and period appear once. Public holidays and plain school holidays without a holiday plan get no note: trainings simply do not take place on public holidays, and without a holiday plan they go on as usual.

## Team staff see names, not reasons (K8, October 2026)

Physios, team managers and kit managers are members of a team with the role `staff`. They see all events of the team, the chat, and who accepted or declined (as "Kim M.", for games once the squad is published), and they get the event changes of the team (cancellations, moves, new events, training times). They are not participants: no response of their own, not nominated, not counted in squad numbers or statistics, not in the helper plan as players.

Decline reasons stay with coaches and admins. They often name illness or family matters, and staff do not need them to plan. Coaches add staff in the squad tab and hand out a personal link; at the season change staff are removed like coaches and assigned again.

## Reachability for coaches (K7, October 2026)

In the invitations tab coaches see which players nobody can reach yet (no own access, no parent with access) and which have no device with notifications. Whether someone has push on is a technical state, like having an access, and helps the coach find out why messages do not arrive. Which device, when, or what someone switched off per topic stays private.

## Setup wizard and first steps (K7, October 2026)

A fresh installation opens the wizard for admins until it is finished: language and region, club, sport and season, modules, e-mail, first teams, privacy. Every step saves through the normal administration routes, so leaving early loses nothing; "Continue later" postpones it for the browser session, and administration keeps a link to reopen it. The sport step creates the season, the age groups and the helper duty types of the sport profile, but only where nothing exists yet, so running it again on a club in use changes nothing but the duty types of a club that has never used one.

## Club abbreviation in game titles (K1, October 2026)

Game titles show the own team with an abbreviation, e.g. "SVM wD – HSG Gegner". The club sets it in the profile; empty means the initials of the short name, or the first word of the short name if it is already an abbreviation ("SVM Handball" → "SVM").

The abbreviation is needed in many synchronous places (titles in lists, push texts, calendar). One installation serves exactly one club, so the worker keeps it in the isolate: every request and cron run loads the profile first (`enterClubContext`, one row by primary key), `saveClub` updates it at once. Passing the profile through every call would touch dozens of signatures for the same value.

## No explainer videos in the repository (K1, October 2026)

The videos of the original app were screen recordings with real names and the club's design. Kabine shows the steps as text under *Hilfe → Anleitungen*. Videos can come back later, generated from the demo in both languages (see open points in `docs/dev/roadmap.md`).

## Demo data instead of a seed (K1, October 2026)

A real installation starts empty: the setup wizard creates season, age classes and teams. `seed/demo.sql` is only for local development and the public demo, with invented names, and is protected by the marker `demo_v1` so a second run changes nothing.

## Import without AI, restore that merges (October 2026)

The list import reads the club's spreadsheets with fixed rules in the browser. An optional module with Cloudflare's model Clairic was tried and removed again: Clairic is a preview, Cloudflare's terms exclude training only for generative AI, Workers AI cannot be limited to the EU, and most players are children. With only column headers and masked samples it added little over the rules.

Restoring an export merges and never deletes: each row gets a new id, references are mapped, rows that exist already (unique value, people by name and birth year, otherwise the same content) are kept. So one code path serves a full restore into a new installation and taking over parts into a running one, and a second run changes nothing. Admin roles come along only with a full restore, so people taken over from another club's export never become admins here. The browser sends the rows in small chunks, which keeps each request within the CPU limit of the Workers free plan; the schema is read with PRAGMA at run time, so exports of older versions fit.

## Info buttons without a module hook (November 2026)

The club app moved the explanations of its settings behind info buttons, with all texts in one file. Kabine does the same for the core (`src/help-texts.ts`), but modules do not register their texts in a central list: a module passes its `HelpText` object straight to `SwitchRow info={…}` or `InfoButton`. That keeps the texts next to the module's code, needs no new hook in `src/module-api.ts`, and a switched-off module leaves nothing behind. The texts are functions, so they are built in the language active when the sheet opens.

## Qualifications instead of a youth referee role (November 2026)

Kabine had two mechanisms for "only suitable people may take this duty": prior knowledge each person switches on in the profile, and the youth referee role that admins granted, with its own module. A club needed a third case (tournament management, approved by admins), and other sports need referees or licensed timekeepers without a module each. So there is one model in the core: a duty type with prior knowledge says who approves it (the person or an admin), admin approvals are stored per person (children included), and a duty type approved by admins can be taken by the approved people from all teams. The youth referee is such a duty type of the handball profile; required duties per age group, links, the automatic group and the "wanted" notification became properties of that model. The module "Youth referees" went away, its pieces moved into the helper duties module, since approvals are about duty types.

Names: the tables follow the original club app (`skill_grant`, `skill_grants`), so exports between the two stay simple; the column `who_referees` keeps its name until the cleanup release (`whoQualified` in the code). Self approvals stay per account in `skill_consents`: moving them would have changed every existing consent for no gain. The migration keeps the old tables so the previous release keeps working, and a restore of an older export converts them the same way.

## Statistics with module views (November 2026)

The club app's statistics put the helper duties per family into the same page and route as the attendance. In Kabine the helper duties are a module, so the core statistics only know attendance, and the module adds its part through two app hooks (`teamStats`, `myStats` in `src/module-api.ts`) and its own routes under `/duties/...`. A club without the helper duties module gets the statistics without helpers, and other modules (e.g. carpools) can add a view later without touching the core. The core still says whether the team uses the helper plan (`TeamStats.helperPlan`), because that switch is a core column of the team.

## Youth referee as a duty of the team in new installations (November 2026)

Clubs solved the youth referee with their own home game templates per age group ("Home game F youth" with the referee in it) rather than with one list across teams and required duties per age group. New installations therefore get the youth referee as an ordinary duty of the team with an admin approval, in no template, and a second template "Home game adults" that shows how teams get different duties. Existing installations keep their setup; admins can now change *Who takes it* of a duty type later and so turn the youth referee into a duty of the team themselves. The duty type taken by approved people from all teams stays for clubs that want it.

## Personal links and the e-mail address of an access (November 2026)

A personal link takes over an access by design: the coach of a player who lost the phone sends one. An audit found that it could also put an e-mail address on an existing access, which stayed a way in after the passkey was replaced, and which a later link could not remove (a confirmed address was locked). The app never offered that field on an existing access, so the server now refuses it: no one who uses the app as intended notices. Removing an address is the admin's choice per link, not automatic with every link: most people's address is their own and they would lose their e-mail sign-in for nothing. The address goes when the link is used, together with the passkeys and devices, so a link that is never opened changes nothing; the person may enter a new one on the same page. The protocol keeps the new address shortened, enough to ask "is this yours?" without collecting addresses there.

## Push texts per recipient (November 2026)

A push about a person goes to the person and to their parents. With one text for all, parents read "You are in the squad" when their child is meant, and parents with several children or who play themselves cannot tell who is meant. `notifyPersons` therefore builds the text per account: the account's own person is "you", children are named by first name (as the parents see them in the app anyway), several in one push. The sentences are ICU selects with four cases (you, one child, you and children, several) because German conjugates differently for each ("bist", "ist", "seid", "sind"); names are joined with `Intl.ListFormat` in the recipient's language. Accounts with the same text are still sent together, so the queue load stays the same.

## handball.net through the team calendar (November 2026)

Handball360 has no open interface: the website's own API answers other sites with 403, and the DHB gives API access only on request. handball.net does offer a calendar subscription per team (`/kalender/team/<id>.ics`), meant for calendar apps, refreshed every 6 hours and open to browsers (`Access-Control-Allow-Origin: *`). The connector uses exactly that, from the coach's device and at the press of a button, which is less than any subscribed phone calendar does; so it counts as a public export (docs/dev/connectors.md) and needs no letter to the DHB. Connectors gained `format: "text"` for it, so the core reads the response as text instead of JSON; the calendar is parsed and checked on the server like any data from a browser.

## Cache per Worker instance with version numbers (November 2026)

The original club app measured 4.5 million rows read a day, close to the free plan's 5 million; over a quarter of it were memberships and parent links that every event list read again. Clubs run Kabine on the free plan, so the same cache came over: teams, age-group limits, memberships, parent links and club-wide duty types stay in memory per Worker instance and are reloaded only when a version number changes. Triggers bump the numbers, so direct edits in D1, restores and the demo reset invalidate as well, and no instance shows an old state. The triggers on `teams` list the columns the cached data and the duty generation read, because the schedule sync writes `fixture_synced_at`, `fixture_error` and `fixture_claimed_at` every hour. In the demo before the change, memberships, parent links, teams and limits were about 30 % of the rows read (`npm run d1:stats -- 7d --env demo`). Trade-off: the first request of an instance loads all memberships instead of those of one team; a few hundred rows once, against the same rows on every request before. D1's `meta.changes` counts rows written by triggers too, so the two places that summed it (list import, restore) count with `RETURNING` now.

## Server errors: general message, count in KV, e-mail to the owner (November 2026)

Another project in the same Cloudflare account showed people "D1_ERROR: Your account is generating too much load on D1 DBs. Please back off and try again later." The limit applies to the whole account, so a club's installation can hit it too, and the raw text tells people nothing. Unexpected errors never show their text; overload (messages like "too much load", "overloaded", "back off", "Network connection lost", timeouts) answers 503 `overloaded` with a hint to try again in a few minutes, everything else 500 `internal`; `ApiError` stays as it is and is not counted. The errors of a day go to KV (`server-errors:<local date>`, 14 days), not D1, because D1 is what fails under overload; at most 20 a day, after that not even read, so an error burst cannot use up the KV writes that sign-in and maintenance mode need. Counted without a lock, so approximate under many simultaneous errors. Recorded from `onError`, every failing cron task (modules included), the push queue, the schedule import, the holiday import and the sign-in mail (sending that is not set up is a club setting, not an error). From the third error of a day one e-mail to the owner. The club app mails a fixed address; Kabine has no operator address and keeps the owner as a person in the club profile, so the mail goes to the confirmed address of the owner's access, in its language, and is skipped when there is none; the next error checks again. No other admins: the list is technical, and one recipient keeps it at one mail a day.

## "What's new" from the release notes, with a birth announcement (November 2026)

The original club app has a hand-written list of changes for players and parents (Help → What's new) since its go-live, and adds an entry with every visible change. Kabine already writes release notes per version for admins (`shared/changelog.ts`, the same versions as `CHANGELOG.md`, checked by a test), so a second list would drift from them. Items that players and parents notice are marked in place with `everyone(…)`, and the page shows only those, grouped by release instead of by month. Coach notes stay out, as in the club app, to keep the list short.

The page counts from the club's start, not from Kabine's first release: a club that started with 0.8.0 should not read about 0.2.0 as news. Kabine did not record that day, so the club profile got `startedOn`, set when the setup wizard is completed; existing installations take the day of their first access (the first admin), which is when they were set up. A club that set up long before it went live sees a few releases too many; an admin field for the go-live day can follow if clubs ask for it.

The club app's later commit adds a "birth announcement" at the end of the list: date, place of birth, size and weight, with twinkling stars. It is ported without club specifics: the club's short name, the start day, "fits on every phone" and "lighter than a sports bag" (the club app's "lighter than a handball" and its town would not fit every sport and club). It appears only when the start day is known, and its stars stand still with reduced motion.

## Helpers from other teams, taking turns and club events (November 2026)

Ported from the club app, where "who helps" first got a list of teams on the duty type and three days later moved to the template line and the time block. Kabine went straight to the second model: the duty type says what, the template line or block says from where (`helper_mode`, `helper_teams`, `rotate_team_id`). Kabine never had teams on duty types, so there is no `duty_type_teams` table and nothing to move; existing template lines and blocks become "as duty type" and behave as before. Differences from the club app:

- **"Manage duties" lives in the core** (`src/duty-manage.tsx`): the core event page opens it ("Manage helper duties"), and the core does not import from modules. The Helpers tab of the module uses the same sheet.
- **Keys of the lists.** Lists of approved people already use negative ids in Kabine (team ids are > 0), so the club list and its live channel use 0, and the app keys its lists as team id, negative id, `"club"` or `"help"` instead of the club app's -1 and -2.
- **The picker for "sign someone up"** takes the block (`?block=<id>`) instead of the duty type: the block knows both the duty type's rules and its "helpers from". The search in the whole club takes it in the body, like the search text, which stays out of URLs.
- **Merging duty types** also moves what Kabine's qualifications hang on a type (approval links, required duties of age groups, automatic groups); types taken by approved people from all teams are not merged, and they cannot be "helpers from" either (they are in no template).
- **Adults only** reads the birth years from the actor (`Actor.birthYear`, `childBirthYears`, loaded in the same query batch as before), so the role checks stay synchronous.
- **The chat message for teams taking turns** is one system message in the club's language, as other system messages in Kabine; per-recipient texts would need a message per person.
- **Restore** maps the team ids in `helper_teams` to the new ids, since a JSON list has no foreign key.
- **Hints on overlaps** compare the times as local `YYYY-MM-DDTHH:MM` strings (`strftime`), because SQLite's `datetime()` writes a space instead of the `T` the app stores.

## No KV write without a login (November 2026)

On the free plan KV allows about 1,000 writes a day for the whole Cloudflare account; Workers requests and D1 rows written allow about 100,000 each. The sign-in page fetched a passkey challenge on every visit and stored it in KV, and every request for a sign-in code counted its network address in KV, so a loop of anonymous requests could use up the writes and break passkey sign-in, the maintenance switch and the server error count. Now the sign-in challenge is stateless: the challenge ID carries challenge, expiry and an HMAC (key derived from `APP_SECRET` with HKDF, like the sealed settings); MAC and expiry are checked before the passkey is even looked up, and only after a valid signature is the challenge booked as used, in D1 with one `INSERT … ON CONFLICT DO NOTHING`, so a replay fails also in parallel (the old KV get-then-delete did not stop that). D1, not KV, because the booking must be atomic and because someone with a passkey could otherwise loop sign-ins against the KV writes. The limit per network address for codes counts in the statement that already creates the code row: no extra write, exact under parallel requests, and IPv6 counts by its /64 prefix, which one connection usually owns. A KV write per anonymous request is a hundred times the request itself in quota; a D1 write per request costs as much quota as the request does, so flooding it is no worse than flooding the Worker. That is also why there is no global brake on codes: the limits per address (5 an hour, 10 a day) and per sender already bound the mail one client can cause, and a global cap would let one attacker block e-mail sign-in for the whole club, which the people of the club would notice. Registration challenges followed later the same month: a team invitation link is shared in a group chat, so anyone holding one could loop `/join/options` against the KV writes. The challenge ID now carries challenge, expiry and the context of the access to be created (names, e-mail address, invitation), sealed with AES-GCM (`worker/lib/secret-box.ts`, its own HKDF purpose), because unlike the sign-in challenge it holds personal data the client must not read or change. A verified passkey books it in the same D1 table, so a registration cannot be replayed either. The challenge ID grows to a few hundred characters; it travels only in request bodies.

## Special events: attendance modes (November 2026)

Ported from the original club app. Special events have three switches for how people respond, at most one on (two at once answer 400 `attendance_conflict`; turning one on turns the others off, in the forms and in the API): **without attendance** (nobody responds; no reminders, counts, attendance or decline deadline; helper duties, organisers and notices stay), **optional attendance** (everyone is optional, as at an optional joint training: whoever wants to join says yes, withdrawing needs no reason, no reminders, cancel and move notices only to those who said yes) and **registration per family** (each family says how many people come, 0 to 30, instead of yes or no per person). Stored responses stay when switching and count again when switching back. One migration for the three columns and the table `event_family_responses` (`202611200300_core_special-event-attendance.sql`); the club app has three.

Families are the participants and their parents, joined through the parent links (siblings, patchwork); whoever has no links is a unit of their own and counts themselves ("2 with my partner"). No family management and no new personal data: one number per family, saved under the smallest person id of the family; on reading it belongs to the family that person is in now, the newer of two wins. The participants' status follows the family's number, so cancel and move notices reach the registered families and the attendance record counts them like accepted optional participants.

Where Kabine differs from the club app:

- Parents belong to the family only where parents are in charge of the child (the team's "Include parents"), as for responses. Without that, the parent does not see the event and the child registers alone.
- A child registers its family within what its parents allow (`may_accept` for a number, `may_decline` for "not coming") and what its age group allows; parents in the family always can. The club app lets every member with an access change it.
- Without attendance there are no participants, so the creation push goes to the active members of the event's teams (all players for a club-wide event), without a request; cancel and move notices reach them too. The club app tells the teams through other code.
- Organisers without coach rights see, with optional attendance, who said yes as "First name L." and, with registration per family, the families with their number ("Kim, Lea and Mona K." in the language of the request). This is an exception to the names rule in `AGENTS.md`, from the club's request: organisers book for those who come. Staff keep their usual view (names and status).
- The table is in the admin export and the restore (category events); the club app leaves it out until Kabine has it.

## Running events stay under "Upcoming" (November 2026)

An event moved to "Past" as soon as it started, so a training in progress disappeared from the top of the list. `EventSummary.isRunning`: started, not cancelled and before its end; without an end, games run for the playing time of the age class (sport profile, as the live card) and everything else for 2 hours. Running events stay in the upcoming page and are left out of the past list; running games also come as `live`, and the app shows them only once. The day mark of the big card says "right now" while the event runs.

## Release candidates (November 2026)

A release is first tried on the maintainer's test installation as a release candidate. Up to v0.8.x the update workflow of a club's copy takes the highest `v*` tag, so a public tag such as `v0.9.0-rc.1` would open an update pull request with the test version in every club's copy. Therefore a release candidate gets no public tag: it is deployed by hand from a commit of `main` to the test installation (with `package.json` set to the candidate's version only in that working copy). From v0.9.0 on the update workflow takes only tags of the form `vX.Y.Z`; once clubs have that workflow (they replace workflow files by hand after an update), release candidates can be tagged.

## Players elsewhere (November 2026)

Ported from the original club app. Coaches asked to know when their players are busy in other teams or groups. Coaches and admins of the team see, on their own event, the events of the players' other teams and groups that day (*Elsewhere the same day*, overlaps with the own event marked; without an end an event counts for 2 hours, as for "running") and, on the team's player page, those of the next two weeks (*Further events of …*). Each entry has time, title, team or group and status, never the reason (it belongs to the people in charge there) and no link, because the coach often may not open that event. Participation and status come from `loadEventContext`, as everywhere: yes by default, standing absences, optional trainings and optional special events only with a yes, games only with a nomination (also with "whole team at games"), inactive people, cancelled events and events without attendance left out. Events with one of the own event's teams (joint trainings) and club-wide events are left out; a club-wide event gets no list at all. Not in the home list, to keep it short for coaches with players in two teams. Nothing new is stored; the privacy texts name who sees the status.
