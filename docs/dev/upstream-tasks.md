# Tasks from the original club app

Kabine started as the app of one handball club, which is still developed on its own. New features and bug fixes made there are listed here so they can be brought into Kabine. Whoever works on Kabine takes an open entry, ports it the Kabine way (English source, Lingui, club profile instead of club data, modules, tests) and moves it to "Done" with the Kabine commit.

Entries describe the change, not the club: no names, domains or data of the club.

Format per entry: date, title, what changed and why, where in the code (file and function names are the same in both code bases unless noted), and anything that needs adapting for Kabine.

## Open

- **2026-10-19 Invitation links are for setup only; "Straight to the app" when opened again.** Parents kept opening the team's parent link instead of the app and then found their child greyed out. Three changes, all in the app: (1) The parent link's share text (`inviteMessage` in `src/pages/team.tsx`) gets a line after the install hint: "You only need the link once to set up. From then on, open the app from the icon on the home screen." (2) `src/pages/join.tsx`: a shared text `ONCE` ("You only need this link once. From then on, open the app from the icon on the home screen or at <host>.", host from `location.host`) appears under the form for people who are not signed in, and as a muted second paragraph on the "Done" screen after joining through a team link or linking a child (`Done` gets an optional `note`, `finish(text, note)`). (3) A parent who is already signed in and opens the parent link again sees a box (region "Already in the app"): "You are signed in as <name> and already in the app. <Child> is already linked to you. <ONCE>" with a primary button "Straight to the app" (route `/`). Below it the child list is headed "Link another child, e.g. a sibling", and the "Link child" button becomes secondary. E2e test "Elternlink: einmal einrichten, beim erneuten Öffnen direkt zur App". Kabine: texts through Lingui with German translation; check the player link text too.

_Nothing open._

## Done

- **2026-10-19 Parent invitation: own name, not the child's.** Bold hint under the first name, warning with a confirm button when the first name is a child's of the team, passkey and e-mail code wait until confirmed. Kabine: `c8a56cd`.
- **2026-10-19 Picking players from other teams: filter by team, core squad marked, correct source teams in the hints.** Shared candidate list with team filter chips and a core squad badge in the three pickers; hints name lower-ranked teams of the same age class and the next younger youth team. Kabine: `8c96fdb`.
- **2026-10-18 Holiday plans in the timeline.** Notes "Autumn holidays, 26 Oct to 30 Oct: no training for wD" in the event overview. Kabine: `b3b1eb2`.
- **2026-10-18 Optional joint training.** Per team and training mandatory or optional, players accept by hand. Kabine: `ccc0934`, `13d83be`.
