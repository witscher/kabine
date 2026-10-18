// Gruppen: Mannschaften mit kind = 'group'. Sie haben nur Chat und Sondertermine (kein Training,
// keine Spiele, kein Kader, keine Eltern, keine Altersklasse) und bleiben beim Saisonwechsel bestehen.
// Siehe docs/entscheidungen.md, Abschnitt Gruppen.
import { all, first, stmt } from "../lib/db";
import { badRequest, notFound } from "../lib/http";

/** SQL-Bedingung: t ist eine echte Mannschaft, keine Gruppe. */
export const IS_TEAM_SQL = (alias: string) => `${alias}.kind = 'team'`;

export async function teamKind(db: D1Database, teamId: number): Promise<{ kind: "team" | "group"; autoMembers: "referees" | null }> {
  const row = await first<{ kind: "team" | "group"; auto_members: "referees" | null }>(db, "SELECT kind, auto_members FROM teams WHERE id = ?", teamId);
  if (!row) throw notFound("Diese Mannschaft gibt es nicht.");
  return { kind: row.kind, autoMembers: row.auto_members };
}

/** Training, Spiele, Kader, Einladungen usw. gibt es nur bei Mannschaften. */
export async function requireTeam(db: D1Database, teamIds: number | number[]): Promise<void> {
  const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
  if (!ids.length) return;
  const groups = await all<{ name: string }>(
    db,
    "SELECT name FROM teams WHERE kind = 'group' AND id IN (SELECT value FROM json_each(?))",
    JSON.stringify(ids),
  );
  if (groups.length) throw badRequest(`${groups.map((g) => g.name).join(", ")} ist eine Gruppe. Gruppen haben nur Chat und Sondertermine.`, "group_not_supported");
}

/**
 * Gruppen mit automatischen Mitgliedern abgleichen. KiHaSL/JuHaSL: Mitglieder sind alle Personen mit
 * der Rolle, Verantwortliche alle Admins. Wiederholbar, ein zweiter Lauf ändert nichts.
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
