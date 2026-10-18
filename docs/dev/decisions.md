# Decisions

Decisions not covered by `docs/dev/roadmap.md`, with reasons. Newest first.

## Modules in their own folders, for contributions with coding agents (October 2026)

Before going public, the repository is shaped so that someone with an idea and a coding agent can add a module, a game schedule source or a provider without knowing the core. Every module is a folder `modules/<name>/` with a manifest (`module.ts`: id, kind, status, default, dependency, sports, API paths, texts, privacy), an optional worker part and an optional app part. The core calls hooks (`worker/module-api.ts`, `src/module-api.ts`) instead of knowing the modules: routes, cron, data on event cards and the event page, cleanup when participants drop out or people leave, export tables, tabs, admin entries, game links. Worker and app parts are found by the build (`import.meta.glob`), the manifests are listed in `modules/index.ts` so the module ids stay typed. Contract tests (`test/modules-contract.test.ts`, `test/fixtures-contract.test.ts`) run for every module, and `npm run new` creates a module or connector that passes them. New modules start as beta, switched off. `AGENTS.md` is the entry point every coding agent reads; `CLAUDE.md` imports it and adds the maintainer's notes.

Game schedules are no longer tied to handball4all: a source is a module of kind `fixtures` with a `FixtureConnector` (parse a pasted link, what to fetch, parse the response into normalised games). Linking, the reservation that keeps devices from fetching at the same time, the sync and its notifications are the core's (`worker/domain/fixtures.ts`). The schema stores the source per team as JSON (`teams.fixture_*`) and games and halls by `external_ref` (`"<module>:<id>"`) instead of `h4a_*` columns; `0001_init.sql` was still editable. Only permitted access is accepted (official API, public export or the association's permission); sources may be fetched by the server or, where only browsers are allowed, by the coach's device.

The helper duties stay partly in the core: one's duties on event cards, in the calendar and on the event page, the duty blocks of special events and the live channel (Durable Object) are core screens and rules that check whether the module is on. Moving them behind hooks would have touched most of the event code for little gain. The duties module holds its API, reminders, the Helpers tab and the admin page. The SMS module provides a text channel (`worker/domain/texts.ts`) that the core uses for sign-in codes and reminders; the phone number in the profile and the SMS sign-in stay core screens. Games entered by hand and the club member marker were base routes that had lived in module files; they moved back to the core.

The developer documents stay in `docs/` next to the club documents for now; the READMEs link them by these paths.

## Public demo and project website (October 2026)

`handball.kabine.dev` is the environment `demo` of `wrangler.jsonc` (Worker `kabine-demo`, own D1, KV, queue, Durable Objects; `APP_ENV=demo`). Visitors sign in by link per role (`/api/demo/login/<player|parent|coach|admin>?lang=de|en`), without passkeys. Four shared accounts, so everything that could lock others out or leave the demo (passkeys, e-mail, SMS, owner handover, invitations, feedback) is blocked (`worker/demo/routes.ts`). At 3:00 Berlin time the cron wipes database, KV and chats and fills them again from `seed/demo.sql` plus scenes made through the app's own API (`worker/demo/reset.ts`), so games and responses are always dated relative to today and the season moves on by itself. The cron runs hourly and checks the Berlin hour, which covers summer and winter time. Secret `DEMO_RESET_TOKEN` allows a manual reset (`npm run demo:reset`). The demo is deployed from `main` by `.github/workflows/deploy-demo.yml` (needs the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEMO_RESET_TOKEN`), so it always runs the latest version.

`kabine.dev` is a static Worker (`site/`, built by `npm run site:build`, German at `/`, English at `/en/`) with the demo screenshots and links. The publisher's details for the legal notice come from `site/legal.json`, which stays out of the repository.

## Optional joint training (October 2026)

Some coaches let their team join another team's training by choice. In a joint training time ("together with") each team is mandatory or optional; a coach can change it for a single training, and that choice stays when the plan is generated again (`event_teams.optional_manual`). At least one team always trains as usual.

For players whose teams all join optionally: no automatic acceptance (they accept by hand), withdrawing needs no reason and is never "at short notice", no reminders, no "absent without excuse", and they are told about cancellations and moves only once they accepted. In the attendance record and the season statistics they appear only when they accepted, so not joining never counts as missing. A player who is also in a mandatory team of the same training counts as mandatory. The event shows the mark "Optional"; the big "Up next" card only shows an optional training once it is accepted. Coaches see the optional players without acceptance in their own group "Optional, not joining". If a coach switches a team to mandatory after someone withdrew, that withdrawal counts as a decline.

## README in German first (October 2026)

`README.md` is German, `README.en.md` English, each linked at the top of the other. Kabine is made for German clubs (holidays per state, handball4all, the name itself), and the people who find it on GitHub are mostly club admins in Germany. Code, comments and the technical documentation stay in English so others can contribute.

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
