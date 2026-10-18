// Automatic squad: for teams with auto_squad the core squad counts as
// nominated for all future games whose squad the coach has not edited
// (squad_manual = 0). The nominations are kept as real rows so that
// visibility, overlaps and reminders work as with hand-picked squads.
import { list, stmt } from "../lib/db";
import { nowLocal, utcIso } from "../lib/time";
import { moduleParticipantsDropped } from "../modules";

/** Future games with an automatic squad (?1 now, ?2 teams or NULL for all) and the target line-up. */
const AUTO = `
  auto_games(event_id, team_id) AS (
    SELECT e.id, et.team_id FROM events e
      JOIN event_teams et ON et.event_id = e.id
      JOIN teams t ON t.id = et.team_id
     WHERE t.auto_squad = 1 AND e.kind = 'game' AND e.cancelled_at IS NULL AND e.squad_manual = 0 AND e.starts_at > ?1
       AND (?2 IS NULL OR t.id IN (SELECT value FROM json_each(?2)))
  ),
  target(team_id, person_id, is_helper) AS (
    SELECT cs.team_id, cs.person_id,
           NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = cs.team_id AND tm.person_id = cs.person_id AND tm.role = 'player')
      FROM core_squad cs JOIN persons p ON p.id = cs.person_id
     WHERE p.is_active = 1 AND p.is_former = 0
  ),
  stale(event_id, person_id) AS (
    SELECT n.event_id, n.person_id FROM nominations n JOIN auto_games g ON g.event_id = n.event_id
     WHERE NOT EXISTS (SELECT 1 FROM target t WHERE t.team_id = g.team_id AND t.person_id = n.person_id)
       -- Accepted help requests stay
       AND NOT EXISTS (SELECT 1 FROM help_requests h WHERE h.event_id = n.event_id AND h.person_id = n.person_id AND h.status = 'accepted')
  )`;

/** Syncs the automatic squads. teamIds = null: all teams. Without push. */
export async function syncAutoSquads(db: D1Database, teamIds: number[] | null, now = Date.now()): Promise<void> {
  const params = [nowLocal(now), teamIds ? list(teamIds) : null] as const;
  await db.batch([
    stmt(
      db,
      `WITH ${AUTO}
       INSERT OR IGNORE INTO nominations (event_id, person_id, is_helper)
       SELECT g.event_id, t.person_id, t.is_helper FROM auto_games g JOIN target t ON t.team_id = g.team_id`,
      ...params,
    ),
    stmt(db, `WITH ${AUTO} DELETE FROM responses WHERE (event_id, person_id) IN (SELECT event_id, person_id FROM stale)`, ...params),
    ...moduleParticipantsDropped(db, { with: `WITH ${AUTO}`, select: "SELECT event_id, person_id FROM stale", params: [...params] }),
    stmt(db, `WITH ${AUTO} DELETE FROM nominations WHERE (event_id, person_id) IN (SELECT event_id, person_id FROM stale)`, ...params),
    stmt(
      db,
      `WITH ${AUTO} UPDATE events SET squad_published_at = coalesce(squad_published_at, ?3) WHERE id IN (SELECT event_id FROM auto_games)`,
      ...params,
      utcIso(now),
    ),
  ]);
}
