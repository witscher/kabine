# Decisions

Decisions not covered by `docs/plan.md`, with reasons. Newest first.

## Club abbreviation in game titles (K1, October 2026)

Game titles show the own team with an abbreviation, e.g. "SVM wD – HSG Gegner". The club sets it in the profile; empty means the initials of the short name, or the first word of the short name if it is already an abbreviation ("SVM Handball" → "SVM").

The abbreviation is needed in many synchronous places (titles in lists, push texts, calendar). One installation serves exactly one club, so the worker keeps it in the isolate: every request and cron run loads the profile first (`enterClubContext`, one row by primary key), `saveClub` updates it at once. Passing the profile through every call would touch dozens of signatures for the same value.

## No explainer videos in the repository (K1, October 2026)

The videos of the original app were screen recordings with real names and the club's design. Kabine shows the steps as text under *Hilfe → Anleitungen*. Videos can come back later, generated from the demo in both languages (see open points in `docs/plan.md`).

## Demo data instead of a seed (K1, October 2026)

A real installation starts empty: the setup wizard creates season, age classes and teams. `seed/demo.sql` is only for local development and the public demo, with invented names, and is protected by the marker `demo_v1` so a second run changes nothing.
