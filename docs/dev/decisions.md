# Decisions

Decisions not covered by `docs/dev/roadmap.md`, with reasons. Newest first.

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

For players whose teams all join optionally: no automatic acceptance (they accept by hand), withdrawing needs no reason and is never "at short notice", no reminders, no "absent without excuse", and they are told about cancellations and moves only once they accepted. In the attendance record and the season statistics they appear only when they accepted, so not joining never counts as missing. A player who is also in a mandatory team of the same training counts as mandatory. The event shows the mark "Optional"; the big "Up next" card only shows an optional training once it is accepted. Coaches see the optional players without acceptance in their own group "Optional, not joining". If a coach switches a team to mandatory after someone withdrew, that withdrawal counts as a decline.

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
