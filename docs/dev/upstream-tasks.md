# Tasks from the original club app

Kabine started as the app of one handball club, which is still developed on its own. New features and bug fixes made there are listed here so they can be brought into Kabine. Whoever works on Kabine takes an open entry, ports it the Kabine way (English source, Lingui, club profile instead of club data, modules, tests) and moves it to "Done" with the Kabine commit.

Entries describe the change, not the club: no names, domains or data of the club.

Format per entry: date, title, what changed and why, where in the code (file and function names are the same in both code bases unless noted), and anything that needs adapting for Kabine.

## Open

- **2026-10-19 Parent invitation: own name, not the child's.** Parents kept entering their child's name as their own when joining through the parent link. The first-name field now carries a bold hint ("Your own name, not your child's! You pick your child further down."). If the entered first name (first word, case-insensitive) equals the first name of any player listed on the link, a warning appears under the name fields: "Not your child's name! <Name> is also a child of <team>. Put your own name here, so coaches and other parents know who you are." A button "That's right, my name is <Name> too" confirms it, because parents can share a first name with their child. Until confirmed, passkey registration and the e-mail code are blocked with "Please enter your own first name, not your child's." Client side only. Code: `src/pages/join.tsx` (`JoinPage`: `confirmedName`, `nameClash`, `NAME_CLASH`; `JoinByEmail` gets an optional `check`), e2e test "Elternlink: Warnung, wenn der Vorname dem eines Kindes gleicht". Kabine: texts through Lingui with German translation, the e2e test in English.

## Done

- **2026-10-19 Picking players from other teams: filter by team, core squad marked, correct source teams in the hints.** Shared candidate list with team filter chips and a core squad badge in the three pickers; hints name lower-ranked teams of the same age class and the next younger youth team. Kabine: `8c96fdb`.
- **2026-10-18 Holiday plans in the timeline.** Notes "Autumn holidays, 26 Oct to 30 Oct: no training for wD" in the event overview. Kabine: `b3b1eb2`.
- **2026-10-18 Optional joint training.** Per team and training mandatory or optional, players accept by hand. Kabine: `ccc0934`, `13d83be`.
