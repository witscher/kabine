# Security rules

Rules every change must keep. Each one has a test that recreates the misuse (`test/security.test.ts`, unless noted). Add a rule and a test when you find a new kind of problem.

Threat model: a club installation has a few hundred people. Most damage would come from a logged-in person (often a coach) reaching beyond their teams, or from anyone holding a link. Nothing may hand out data to people without a login, except what a link is meant to show.

| # | Rule | Where | Test |
| --- | --- | --- | --- |
| 1 | A schedule import only links a game that already belongs to another team when the importer may coach that team too; the league in the data must match the team; games are cancelled by an import only if they belong to the importing team alone. | `worker/routes/games.ts` (`importGames`) | `test/h4a.test.ts` |
| 2 | Training times: teams other than the plan's own are added or removed only by someone who coaches them. | `worker/routes/plans.ts` (`checkRuleInputs`) | 2 |
| 3 | A personal link on an existing account signs out all previous devices and tells the owner by e-mail; it never replaces a confirmed e-mail address. | `worker/routes/join.ts` | 3 |
| 4 | Access of coaches and admins (leaving, removing the account, personal link) is managed by admins only. | `worker/auth/owner.ts` (`assertNotStaffUnlessAdmin`) | 4 |
| 5 | WebSockets only from the app's own origin (the session cookie also travels from other sites of the same parent domain). | `worker/app.ts` | 5 |
| 6 | Logs never contain mail texts or addresses (login codes, feedback, names). | `worker/domain/email-login.ts` | 6 |
| 7 | Read-only admin views change nothing, also not over WebSockets (deleting chat messages). | `worker/chat/room.ts`, `worker/routes/chat.ts` | 7 |
| 8 | Invalid input is a 400 with a message, never a 500: validate with `parse()` from `worker/lib/http.ts`. | `worker/routes/teams.ts` | 8 |
| 9 | Parents act for a child only in teams where parents are involved (`parentsInCharge`), including roles such as referee. | `modules/youth-referees/worker/admin-routes.ts` | 9 |
| 10 | Invitation links show short names ("Lina B.", with the birth year only to tell equal names apart). | `worker/routes/join.ts` | 10 |
| 11 | People outside the coaching staff see other people's children as short names (helper plan). | `modules/duties/worker/routes.ts` | 11 |
| 12 | A push subscription moves to another account only with the same keys, i.e. from the same browser. | `worker/routes/push.ts` | 12 |
| 13 | A child never acts beyond the limits of age class and team (respond, chat, stand-in requests, player and personal links); a team can only restrict further than its age class. | `worker/auth/actor.ts` (`childLimitAllows`), `worker/domain/child-limits.ts` | `test/child-access.test.ts` |

General rules, also checked by the existing tests: permissions on the server only; names and decline reasons leave the API only to coaches and admins; the owner's access cannot be taken by other admins (`test/owner-protection.test.ts`); unsafe requests need the app's origin (CSRF).
