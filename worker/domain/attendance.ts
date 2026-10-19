// Attendance record: every event is fixed once after it starts, so that statistics
// do not depend on the current state (team, active, standing absences).
// At the season change the record is condensed into season_stats (see seasonStatsStatements).
import type { AttendanceMark } from "../../shared/attendance";
import { all, stmt } from "../lib/db";
import { nowLocal, utcIso } from "../lib/time";
import { EVENT_SELECT, type EventRow, loadEventContext, type Participant } from "./events";

export type AttendanceStatus = "present" | "open" | "declined" | "standing" | "inactive" | "unexcused";

/**
 * Status in the record. The coach's entry wins over the response: present -> present, excused -> declined
 * (away long-term and inactive stay so), unexcused -> unexcused. Optional participants are in the record
 * only if they were there (null: no row), so missing an optional training never counts as absence.
 */
export function attendanceStatus(p: Pick<Participant, "status" | "optional">, mark: AttendanceMark | null): AttendanceStatus | null {
  if (p.optional) return (mark ? mark === "present" : p.status === "yes") ? "present" : null;
  if (mark === "present" || mark === "unexcused") return mark;
  switch (p.status) {
    case "yes":
    case "open":
      return mark === "excused" ? "declined" : p.status === "yes" ? "present" : "open";
    case "no":
      return "declined";
    default:
      return p.status;
  }
}

/** The record row of a participant, or none. A short-notice decline is not late if the person came after all. */
function recordStatement(db: D1Database, e: Pick<EventRow, "id" | "kind">, p: Participant, mark: AttendanceMark | null, at: string): D1PreparedStatement | null {
  const status = attendanceStatus(p, mark);
  if (!status) return null;
  return stmt(
    db,
    `INSERT OR REPLACE INTO attendance (event_id, person_id, team_id, kind, status, is_helper, is_late, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    e.id,
    p.person.id,
    p.teamId || null,
    e.kind,
    status,
    p.isHelper ? 1 : 0,
    status === "declined" && p.status === "no" && p.response?.is_late === 1 ? 1 : 0,
    at,
  );
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
      const row = recordStatement(db, e, p, ctx.marks.get(`${e.id}:${p.person.id}`) ?? null, at);
      if (row) statements.push(row);
    }
    statements.push(stmt(db, "UPDATE events SET attendance_recorded_at = ? WHERE id = ?", at, e.id));
  }
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  return rows.length;
}

/**
 * Applies a later attendance entry to the record if the event has already been recorded (attendance_recorded_at);
 * otherwise the hourly run records it with the entry.
 */
export function attendanceSync(
  db: D1Database,
  e: Pick<EventRow, "id" | "kind" | "attendance_recorded_at">,
  p: Participant,
  mark: AttendanceMark | null,
): D1PreparedStatement[] {
  if (!e.attendance_recorded_at) return [];
  const row = recordStatement(db, e, p, mark, utcIso());
  return [row ?? stmt(db, "DELETE FROM attendance WHERE event_id = ? AND person_id = ?", e.id, p.person.id)];
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
