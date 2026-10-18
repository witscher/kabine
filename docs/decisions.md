# Decisions

Decisions not covered by `docs/plan.md`, with reasons. Newest first.

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

The videos of the original app were screen recordings with real names and the club's design. Kabine shows the steps as text under *Hilfe → Anleitungen*. Videos can come back later, generated from the demo in both languages (see open points in `docs/plan.md`).

## Demo data instead of a seed (K1, October 2026)

A real installation starts empty: the setup wizard creates season, age classes and teams. `seed/demo.sql` is only for local development and the public demo, with invented names, and is protected by the marker `demo_v1` so a second run changes nothing.
