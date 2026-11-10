# Security rules

Rules every change must keep. Each one has a test that recreates the misuse (`test/security.test.ts`, unless noted). Add a rule and a test when you find a new kind of problem.

Threat model: a club installation has a few hundred people, many of them children. Nothing may hand out data to people without a login, except what a link is meant to show.

## Trust model

A club rests on trust, above all in its coaches, and the app reflects that.

- Coaches are trusted with their teams, admins with the club. Everyday flows carry no general distrust of coaches: adding stand-ins, managing them and shared trainings stay simple.
- Closed in any case:
  - whatever a person without a login, or any logged-in user (often a child), could exploit;
  - whatever a hijacked account could use to take over another person's access or to reach far beyond the hijacked role;
  - whatever happens easily by accident with a large effect (a wrong schedule link, club-wide actions that cannot be undone).
- Highest priority for every security change: people who use the app in good faith notice no difference. Before shipping a new rule, check who it would hit in a real club (for example coaches without an account who joined through their team's player link).
- Prefer a narrow guard on the risky step plus clear wording ("please agree with the coach of …", "an admin enters this") over removing a feature.
- Clubs may choose stricter rules for themselves; they are not Kabine defaults. Kabine's own import rule 1 stays.

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
| 9 | Parents act for a child only in teams where parents are involved (`parentsInCharge`), including approvals such as youth referee. | `modules/duties/worker/qualifications.ts` | 9 |
| 10 | Invitation links show short names ("Lina B.", with the birth year only to tell equal names apart). | `worker/routes/join.ts` | 10 |
| 11 | People outside the coaching staff see other people's children as short names (helper plan). | `modules/duties/worker/routes.ts` | 11 |
| 12 | A push subscription moves to another account only with the same keys, i.e. from the same browser. | `worker/routes/push.ts` | 12 |
| 13 | A child never acts beyond the limits of age class and team (respond, chat, stand-in requests, player and personal links); a team can only restrict further than its age class. | `worker/auth/actor.ts` (`childLimitAllows`), `worker/domain/child-limits.ts` | `test/child-access.test.ts` |
| 14 | One-time codes by e-mail or SMS: an attempt is booked before the comparison, in one statement, so parallel guesses cannot pass the limit of five; the limit per address (5 per hour, 10 per day) is checked in the statement that creates the code; hashes are compared in constant time. | `worker/domain/email-login.ts` | `test/email.test.ts` |
| 15 | A WebSocket connect passed on to a Durable Object carries only the client's upgrade headers (`upgradeHeaders`); person, role label and rights are set by the server. | `worker/lib/http.ts`, `worker/routes/chat.ts`, duty hub connects | `test/chat.test.ts` |
| 16 | Chat rights are checked at connect, so every change of them closes the open sockets of the people concerned (`revalidateChatAccess`, `reconnectChats`, code 4004): removed from or added to a team, leaving the club, a child's chat permission, guardianship, account removed, device signed out, personal link, admin rights, person deleted, approval of an automatic group, season change, child limits of age classes. Not on one's own logout. | `worker/domain/chat.ts`, `worker/chat/room.ts` | `test/chat.test.ts` |

General rules, also checked by the existing tests: permissions on the server only; names and decline reasons leave the API only to coaches and admins; the owner's access cannot be taken by other admins (`test/owner-protection.test.ts`); unsafe requests need the app's origin (CSRF).
