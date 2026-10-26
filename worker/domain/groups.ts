import { t } from "@lingui/core/macro";
// Groups: teams with kind = 'group'. They only have chat and special events (no training, no games,
// no squad, no age class) and remain at the season change. Parents only if an admin includes them.
// See docs/dev/design.md, Groups.
import { all, first, stmt } from "../lib/db";
import { badRequest, notFound } from "../lib/http";

/** SQL condition: t is a real team, not a group. */
export const IS_TEAM_SQL = (alias: string) => `${alias}.kind = 'team'`;

export async function teamKind(db: D1Database, teamId: number): Promise<{ kind: "team" | "group"; autoMembers: "referees" | null }> {
  const row = await first<{ kind: "team" | "group"; auto_members: "referees" | null }>(db, "SELECT kind, auto_members FROM teams WHERE id = ?", teamId);
  if (!row) throw notFound(t`This team does not exist.`);
  return { kind: row.kind, autoMembers: row.auto_members };
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
 * Synchronises groups with automatic members. youth referee: members are all persons with the role,
 * those in charge are all admins. Repeatable, a second run changes nothing.
 */
export async function syncAutoGroups(db: D1Database): Promise<void> {
  const groups = await all<{ id: number }>(db, "SELECT id FROM teams WHERE kind = 'group' AND auto_members = 'referees'");
  if (!groups.length) return;
  await db.batch(
    groups.flatMap((g) => [
      stmt(
        db,
        `DELETE FROM team_memberships WHERE team_id = ?1 AND role = 'player'
           AND person_id NOT IN (SELECT r.person_id FROM referees r JOIN persons p ON p.id = r.person_id AND p.is_former = 0)`,
        g.id,
      ),
      stmt(
        db,
        `INSERT OR IGNORE INTO team_memberships (person_id, team_id, role)
         SELECT r.person_id, ?1, 'player' FROM referees r JOIN persons p ON p.id = r.person_id AND p.is_former = 0`,
        g.id,
      ),
      stmt(
        db,
        `DELETE FROM team_memberships WHERE team_id = ?1 AND role = 'coach'
           AND person_id NOT IN (SELECT id FROM persons WHERE is_admin = 1 AND is_former = 0)`,
        g.id,
      ),
      stmt(
        db,
        `INSERT OR IGNORE INTO team_memberships (person_id, team_id, role)
         SELECT id, ?1, 'coach' FROM persons WHERE is_admin = 1 AND is_former = 0`,
        g.id,
      ),
    ]),
  );
}
