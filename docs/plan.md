# Kabine – Plan

Kabine is a free team app for sports clubs: events, attendance (yes/no), squads, team chat, push notifications, helper duties, carpools. One installation per club, in the club's own Cloudflare account, installed with a "Deploy to Cloudflare" button. Licence AGPL-3.0.

Kabine started as a rebuild of the app of a German handball club (2026). It takes over the code and the experience, without the club's data and history.

## Decisions (October 2026)

| Topic | Decision |
| --- | --- |
| Name | Kabine (the place where every team meets, in every sport). |
| Licence | AGPL-3.0-only. Changes must stay open, also when run as a service. |
| Repository | `witscher/kabine`, private until the security checklist is done and no club data is left, then public (the deploy button needs a public repo). |
| Platform | Cloudflare Developer Platform only (Workers with static assets, D1, KV, Durable Objects, Queues, Cron). Exceptions chosen by the club: external SMTP server for e-mail, SMS provider for the SMS module. |
| Installation | One installation per club in the club's own Cloudflare account. No multi-tenant hosting. |
| Languages | English and German from the start. Source language in code is English, German is the first translation. Lingui with ICU MessageFormat and `.po` catalogs. |
| Translation | Written by AI during development, never at runtime. Machine translations carry the translator comment `# ai`; a human who checks or corrects an entry removes the marker, and the AI does not touch unmarked entries again unless the English source changes. CI fails on missing translations or mismatched placeholders. |
| Language per person | Accounts have a language. Push, e-mail and calendar texts follow the recipient, not the sender. The club sets a default in the setup wizard. Dates and numbers via `Intl`. |
| Profiles | Three layers: base, profiles (sport, region, club) as data, modules. |
| Sport profile | Age classes without gender (D youth, U13); a team is age class + gender (female, male, mixed) + level. Game duration per age class. Terms (game, squad, kick-off, scorers' table) and default duty types come from the profile, per language. Handball is the first profile. |
| Region profile | Country and state for school holidays and public holidays (OpenHolidays), time zone, season period. Trainings are not generated on public holidays. |
| Club profile | Name, short name, logo, colours, privacy text, invitation texts, owner. Stored in the database and edited in the setup wizard, not in code. |
| E-mail | Mail adapter: Cloudflare Email Sending or an SMTP server entered by the club (TCP sockets, STARTTLS, AUTH). Test mail in the wizard. |
| SMS | Module with a provider adapter. First provider: seven.io (German company, EU servers, simple HTTP API). Used for login codes and, if chosen per person, notifications. |
| Setup wizard | Three parts. 1. Installation (admin, first start): club, region, sport, language, modules, e-mail, owner passkey, first teams, privacy template; can be reopened later. 2. First steps for new players, coaches, parents: install app, push, language, optional profile picture (with parental consent for minors), link children, short tour; every step skippable, resumable. 3. Onboarding for coaches and admins: create teams, invitation links with ready text, parent links, CSV import (first name, last name, birth year), overview of who has no access or no push yet. |
| Modules | Switch per module under administration. Base modules with switch: helper duties, carpools. Optional modules: fixture connectors (handball4all first), SMS. Later: player eligibility, guest players, documents and emergency contacts, polls, statistics. |
| Fixtures | Base: games by hand and iCal/CSV import. Connectors per system are modules; handball4all is ported, others (Handball360, nuLiga, SAMS) need API access from the associations. |
| Updates | The deploy button creates a copy (not a fork) in the club's GitHub account. A GitHub Action in that copy checks for new Kabine releases and opens a pull request; merging it deploys via Workers Builds. Migrations run in the deploy script and must be safe for every club. |
| Read load | Queries designed for few D1 rows read (candidate pre-selection, indexes, paged event list). Query plans checked in tests. |

## Milestones

Each milestone ends with typecheck, unit tests and e2e green, a commit on `main` and an entry in this file.

- **K0 Import** – code taken over without history, seed, videos and club scripts; one consolidated initial migration without legacy columns; tests green.
- **K1 Club profile** – settings table, club profile instead of club literals in code, owner from setup instead of hard-coded e-mail, neutral icons and splash, neutral demo seed.
- **K2 Security checklist** – the twelve findings of the old app fixed, each with a test (see `docs/security.md`).
- **K3 Languages** – Lingui, English source, German catalog, language per account, server texts per recipient, `Intl` formatting, CI check.
- **K4 Sport and region profiles** – age classes without gender, team gender, game duration and referee age classes as data, handball profile, holidays and public holidays per state, configurable time zone and season.
- **K5 Modules** – module switches, navigation and API gated per module, helper duties and carpools switchable, handball4all as connector module, iCal/CSV game import.
- **K6 E-mail and SMS** – mail adapter (Cloudflare, SMTP), SMS module (seven.io), channels per person.
- **K7 Setup wizard** – installation, first steps, onboarding for coaches incl. CSV import.
- **K8 Staff role** – team staff (physio, manager): see everything of the team, get change notifications, are not participants.
- **K9 Release** – deploy button, update action, CI (GitHub Actions), docs (install, operation, privacy template, data inventory), demo installation on `yope.de`, README in English and German.

## Progress

- **K0 Import** done: code without history, one initial migration, tests green.
- **K1 Club profile** done: profile in `app_meta` (name, short name, abbreviation, colours, logo in KV, privacy link and text, contact, owner), page *Verwaltung → Verein*, dynamic manifest, owner set by the first admin, neutral icons and splash, demo seed with invented names. Explainer videos removed (see open points).
- **K2 Security checklist** done: twelve rules with a test each, see `docs/security.md`. Personal links on existing accounts always sign out the old devices (the switch in the UI is gone).

## Open points

- Home screen icons from the club logo: render them in the browser from logo and colours (canvas) when the logo is saved, store in KV, point the manifest to them. Until then the neutral Kabine icons are used. (K7)
- AGPL source offer: the link under Help points to the upstream repository. A club running changed code must point it to its own copy; make the URL a setting (wizard, K7/K9).
- The owner handover exists in the API (`PUT /api/admin/club/owner`), the UI follows with the wizard (K7).

- Explainer videos: generate from the demo with Playwright in both languages instead of recording real data.
- Federation of club teams across installations (later).
