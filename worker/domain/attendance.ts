// Attendance record: every event is fixed once after it starts, so that statistics
// do not depend on the current state (team, active, standing absences).
// At the season change the record is condensed into season_stats (see seasonStatsStatements).
import { all, stmt } from "../lib/db";
import { nowLocal, utcIso } from "../lib/time";
import { EVENT_SELECT, type EventRow, loadEventContext, type Participant } from "./events";

export type AttendanceStatus = "present" | "open" | "declined" | "standing" | "inactive" | "unexcused";

/** Status in the record; "unexcused" takes precedence over everything. */
export function attendanceStatus(status: Participant["status"], unexcused: boolean): AttendanceStatus {
  if (unexcused) return "unexcused";
  switch (status) {
    case "yes":
      return "present";
    case "no":
      return "declined";
    default:
      return status;
  }
}

/** At most this many events per run; the rest follows in the next hour. */
const BATCH_EVENTS = 150;

/** Records started, not cancelled events that have no record yet. Returns the number of events. */
export async function recordAttendance(db: D1Database, now = Date.now()): Promise<number> {
  const rows = await all<EventRow>(
    db,
    `${EVENT_SELECT} WHERE e.starts_at <= ? AND e.cancelled_at IS NULL AND e.attendance_recorded_at IS NULL
      ORDER BY e.starts_at, e.id LIMIT ${BATCH_EVENTS}`,
    nowLocal(now),
  );
  if (!rows.length) return 0;
  const ctx = await loadEventContext(db, rows);
  const at = utcIso(now);
  const statements: D1PreparedStatement[] = [];
  for (const e of rows) {
    for (const p of ctx.participants.get(e.id) ?? []) {
      // Optional training: only who accepted is in the record (so missing it never counts as absence)
      if (p.optional && p.status !== "yes") continue;
      statements.push(
        stmt(
          db,
          `INSERT OR REPLACE INTO attendance (event_id, person_id, team_id, kind, status, is_helper, is_late, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          e.id,
          p.person.id,
          p.teamId || null,
          e.kind,
          attendanceStatus(p.status, ctx.unexcused.has(`${e.id}:${p.person.id}`)),
          p.isHelper ? 1 : 0,
          // Short-notice decline: given after the deadline
          p.status === "no" && p.response?.is_late === 1 ? 1 : 0,
          at,
        ),
      );
    }
    statements.push(stmt(db, "UPDATE events SET attendance_recorded_at = ? WHERE id = ?", at, e.id));
  }
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  return rows.length;
}

/** Applies a later "unexcused absence" mark to the record if the event has already been recorded. */
export function attendanceUpdate(db: D1Database, eventId: number, personId: number, status: AttendanceStatus): D1PreparedStatement {
  return stmt(db, "UPDATE attendance SET status = ?, recorded_at = ? WHERE event_id = ? AND person_id = ?", status, utcIso(), eventId, personId);
}

/**
 * Season change: condenses the record and helper duties of the current season into figures per
 * person and team. Runs before the events are deleted.
 * *_total only counts events where the person was expected (not inactive, not permanently absent).
 */
export function seasonStatsStatements(db: D1Database, seasonId: number): D1PreparedStatement[] {
  const teamName = "COALESCE((SELECT t.name FROM teams t WHERE t.id = a.team_id), '–')";
  const fromAttendance = (kind: "training" | "game", metric: string, where: string) =>
    stmt(
      db,
      `INSERT OR REPLACE INTO season_stats (season_id, person_id, team_name, metric, value)
       SELECT ?, a.person_id, ${teamName}, ?, count(*) FROM attendance a
        WHERE a.kind = ? AND ${where}
        GROUP BY a.person_id, ${teamName}`,
      seasonId,
      metric,
      kind,
    );
  // Team of a game: if several, the alphabetically first
  const gameTeam = "COALESCE((SELECT min(t.name) FROM event_teams et JOIN teams t ON t.id = et.team_id WHERE et.event_id = d.event_id), '–')";
  const fromDuties = (metric: string, where: string) =>
    stmt(
      db,
      `INSERT OR REPLACE INTO season_stats (season_id, person_id, team_name, metric, value)
       SELECT ?, d.person_id, ${gameTeam}, ?, count(*) FROM duties d
        WHERE d.person_id IS NOT NULL AND ${where}
        GROUP BY d.person_id, ${gameTeam}`,
      seasonId,
      metric,
    );
  const expected = "a.status NOT IN ('inactive', 'standing')";
  return [
    fromAttendance("training", "training_total", expected),
    fromAttendance("training", "training_present", "a.status = 'present'"),
    fromAttendance("training", "training_unexcused", "a.status = 'unexcused'"),
    fromAttendance("training", "training_late", "a.status = 'declined' AND a.is_late = 1"),
    fromAttendance("game", "game_total", expected),
    fromAttendance("game", "game_present", "a.status = 'present'"),
    fromAttendance("game", "game_unexcused", "a.status = 'unexcused'"),
    fromAttendance("game", "game_late", "a.status = 'declined' AND a.is_late = 1"),
    fromDuties("duties", "d.duty_type_id NOT IN (SELECT id FROM duty_types WHERE who_referees = 1)"),
    fromDuties("referee_duties", "d.duty_type_id IN (SELECT id FROM duty_types WHERE who_referees = 1)"),
  ];
}
