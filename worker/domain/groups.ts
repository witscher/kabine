import { t } from "@lingui/core/macro";
// Groups: teams with kind = 'group'. They only have chat and special events (no training, no games,
// no squad, no age class) and remain at the season change. Parents only if an admin includes them.
// See docs/dev/design.md, Groups.
import { all, first, stmt } from "../lib/db";
import { badRequest, notFound } from "../lib/http";

/** SQL condition: t is a real team, not a group. */
export const IS_TEAM_SQL = (alias: string) => `${alias}.kind = 'team'`;

/** Kind of a team, and for a group with automatic members the duty type whose approved people are its members. */
export async function teamKind(db: D1Database, teamId: number): Promise<{ kind: "team" | "group"; autoSkill: number | null }> {
  const row = await first<{ kind: "team" | "group"; auto_skill: number | null }>(db, "SELECT kind, auto_skill FROM teams WHERE id = ?", teamId);
  if (!row) throw notFound(t`This team does not exist.`);
  return { kind: row.kind, autoSkill: row.kind === "group" ? row.auto_skill : null };
}

/** Training, games, squad, invitations etc. exist only for teams. */
export async function requireTeam(db: D1Database, teamIds: number | number[]): Promise<void> {
  const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
  if (!ids.length) return;
  const groups = await all<{ name: string }>(
    db,
    "SELECT name FROM teams WHERE kind = 'group' AND id IN (SELECT value FROM json_each(?))",
    JSON.stringify(ids),
  );
  if (groups.length) {
    const names = groups.map((g) => g.name).join(", ");
    throw badRequest(t`${names} is a group. Groups only have chat and special events.`, "group_not_supported");
  }
}

/**
 * Synchronises groups with automatic members (teams.auto_skill): the members are everyone an admin approved for
 * that duty type (e.g. all youth referees), without parents. Admins manage the leads by hand as in any group
 * (before 0.8.0 all admins were leads, so an admin could not leave the group). Repeatable, a second run changes
 * nothing.
 */
export async function syncAutoGroups(db: D1Database): Promise<void> {
  const groups = await all<{ id: number; auto_skill: number }>(db, "SELECT id, auto_skill FROM teams WHERE kind = 'group' AND auto_skill IS NOT NULL");
  if (!groups.length) return;
  await db.batch(
    groups.flatMap((g) => [
      stmt(
        db,
        `DELETE FROM team_memberships WHERE team_id = ?1 AND role = 'player'
           AND person_id NOT IN (SELECT sg.person_id FROM skill_grants sg JOIN persons p ON p.id = sg.person_id AND p.is_former = 0 WHERE sg.duty_type_id = ?2)`,
        g.id,
        g.auto_skill,
      ),
      stmt(
        db,
        `INSERT OR IGNORE INTO team_memberships (person_id, team_id, role)
         SELECT sg.person_id, ?1, 'player' FROM skill_grants sg JOIN persons p ON p.id = sg.person_id AND p.is_former = 0 WHERE sg.duty_type_id = ?2`,
        g.id,
        g.auto_skill,
      ),
    ]),
  );
}
