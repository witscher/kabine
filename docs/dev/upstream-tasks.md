# Tasks from the original club app

Kabine started as the app of one handball club, which is still developed on its own. New features and bug fixes made there are listed here so they can be brought into Kabine. Whoever works on Kabine takes an open entry, ports it the Kabine way (English source, Lingui, club profile instead of club data, modules, tests) and moves it to "Done" with the Kabine commit.

Entries describe the change, not the club: no names, domains or data of the club.

Format per entry: date, title, what changed and why, where in the code (file and function names are the same in both code bases unless noted), and anything that needs adapting for Kabine.

## Open

_Nothing open._

## Done

- **2026-10-19 Parent invitation: own name, not the child's.** Bold hint under the first name, warning with a confirm button when the first name is a child's of the team, passkey and e-mail code wait until confirmed. Kabine: `c8a56cd`.
- **2026-10-19 Picking players from other teams: filter by team, core squad marked, correct source teams in the hints.** Shared candidate list with team filter chips and a core squad badge in the three pickers; hints name lower-ranked teams of the same age class and the next younger youth team. Kabine: `8c96fdb`.
- **2026-10-18 Holiday plans in the timeline.** Notes "Autumn holidays, 26 Oct to 30 Oct: no training for wD" in the event overview. Kabine: `b3b1eb2`.
- **2026-10-18 Optional joint training.** Per team and training mandatory or optional, players accept by hand. Kabine: `ccc0934`, `13d83be`.
