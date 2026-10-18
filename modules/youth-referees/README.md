# Youth referees

Home games of the marked age groups (handball: KiHaSL/JuHaSL, children's and youth referees) get a referee duty in the helper plan. Admins grant the role by link; young referees (or their parents) take the games they want to referee. Needs the helper duties module.

- **Stores:** who has the referee role (`referees`), the links that grant it (`referee_links`, hashed), assignments as helper duties.
- **Who sees it:** the referees and the admins; at the game as a helper duty.
- **Deleted:** the role when an admin removes it or the person leaves the club; assignments at the season change.

Which age groups need a youth referee is a property of the age class (`youth_referee`, sport profile in `shared/sports.ts`). The group chat of all referees is kept in sync by the core (`worker/domain/groups.ts`), and the role shows in the core's actor (`worker/auth/actor.ts`, `refereeRoles` in `worker/domain/duties.ts`).

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest (`requires: "duties"`) |
| `worker/index.ts` | routes, export table |
| `worker/admin-routes.ts` | links and list for admins, redeeming a link |
| `worker/plan-routes.ts` | the referees' view of the helper plan, live updates |
| `app/index.tsx`, `app/referees.tsx` | admin page, link page |
| `test/referees.test.ts` | role, plan, notifications |
