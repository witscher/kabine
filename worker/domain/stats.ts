// Statistics: attendance from the record (attendance). Only events where someone was expected count: away
// long-term and inactive never count as missing. Helper duties per family are added by the helper duties module.
// See docs/dev/design.md, Statistics.
import type { AttendanceCounts, MyStats, PersonRef, StatsEventRow, StatsRange, TeamStats } from "../../shared/types";
import type { Actor } from "../auth/actor";
import { all, first, list } from "../lib/db";
import { addDays, todayLocal } from "../lib/time";

export const STATS_RANGES: StatsRange[] = ["4w", "season"];

/** First day of the range: 4 weeks ago (28 days including today) or the start of the season. */
export async function rangeFrom(db: D1Database, range: StatsRange, today = todayLocal()): Promise<string> {
  if (range === "4w") return addDays(today, -27);
  return seasonStart(db);
}

export async function seasonStart(db: D1Database): Promise<string> {
  const s = await first<{ starts_on: string }>(db, "SELECT starts_on FROM seasons WHERE is_current = 1");
  return s?.starts_on ?? "2000-01-01";
}

export function emptyCounts(): AttendanceCounts {
  return { expected: 0, present: 0, declined: 0, late: 0, unexcused: 0, open: 0, standing: 0, inactive: 0, played: 0, presentNotNominated: 0 };
}

interface AttendanceRow {
  person_id: number;
  team_id: number | null;
  event_id: number;
  kind: "training" | "game";
  status: StatsEventRow["status"];
  is_late: number;
  is_helper: number;
  nominated: number;
  starts_at: string;
}

function count(c: AttendanceCounts, r: Pick<AttendanceRow, "kind" | "status" | "is_late" | "nominated">): void {
  switch (r.status) {
    case "present":
      c.expected++;
      c.present++;
      if (r.kind === "game") {
        if (r.nominated) c.played++;
        else c.presentNotNominated++;
      }
      break;
    case "declined":
      c.expected++;
      c.declined++;
      if (r.is_late) c.late++;
      break;
    case "unexcused":
      c.expected++;
      c.unexcused++;
      break;
    case "open":
      c.expected++;
      c.open++;
      break;
    case "standing":
      c.standing++;
      break;
    case "inactive":
      c.inactive++;
      break;
  }
}

const ATTENDANCE_COLUMNS = "a.person_id, a.team_id, a.event_id, a.kind, a.status, a.is_late, a.is_helper, a.nominated, e.starts_at";

/** Opponent of a game or title of a training, for lists. */
const titleOf = (e: { kind: string; title: string | null; is_home: number | null; home_team: string | null; guest_team: string | null }) =>
  e.kind === "game" ? (e.is_home === 0 ? e.home_team : e.guest_team) : e.title;

/** A team's statistics for its coaches and admins (the route checks the permission). */
export async function loadTeamStats(db: D1Database, teamId: number, range: StatsRange, now = Date.now()): Promise<TeamStats> {
  const today = todayLocal(now);
  const from = await rangeFrom(db, range, today);
  const [team, rows, players, events] = await Promise.all([
    first<{ name: string; helper_plan: number }>(db, "SELECT name, helper_plan FROM teams WHERE id = ?", teamId),
    all<AttendanceRow>(
      db,
      `SELECT ${ATTENDANCE_COLUMNS} FROM attendance a JOIN events e ON e.id = a.event_id
        WHERE a.team_id = ?1 AND a.kind IN ('training', 'game') AND e.starts_at >= ?2 AND e.cancelled_at IS NULL`,
      teamId,
      `${from}T00:00`,
    ),
    all<{ id: number; first_name: string; last_name: string | null }>(
      db,
      `SELECT p.id, p.first_name, p.last_name FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
        WHERE tm.team_id = ? AND tm.role = 'player' AND p.is_former = 0 ORDER BY p.first_name, p.last_name`,
      teamId,
    ),
    all<{ id: number; kind: "training" | "game"; starts_at: string; title: string | null; is_home: number | null; home_team: string | null; guest_team: string | null }>(
      db,
      `SELECT e.id, e.kind, e.starts_at, e.title, e.is_home, e.home_team, e.guest_team FROM event_teams et JOIN events e ON e.id = et.event_id
        WHERE et.team_id = ?1 AND e.kind IN ('training', 'game') AND e.starts_at >= ?2
          AND e.attendance_recorded_at IS NOT NULL AND e.cancelled_at IS NULL
        ORDER BY e.starts_at DESC`,
      teamId,
      `${from}T00:00`,
    ),
  ]);
  const byPerson = new Map(players.map((p) => [p.id, { training: emptyCounts(), games: emptyCounts() }]));
  let nominatedRows = 0;
  // Per event who was really there (stand-ins included): present after response and recorded attendance
  const perEvent = new Map(events.map((e) => [e.id, emptyCounts()]));
  for (const r of rows) {
    if (r.kind === "game" && r.nominated) nominatedRows++;
    const ev = perEvent.get(r.event_id);
    if (ev) count(ev, r);
    if (r.is_helper) continue;
    const c = byPerson.get(r.person_id);
    if (!c) continue;
    count(r.kind === "training" ? c.training : c.games, r);
  }
  const trainings = events.filter((e) => e.kind === "training").length;
  const games = events.filter((e) => e.kind === "game").length;
  const earliest = rows.reduce<string | null>((m, r) => (m == null || r.starts_at < m ? r.starts_at : m), null)?.slice(0, 10) ?? null;
  return {
    teamName: team?.name ?? "",
    range,
    from,
    dataSince: range === "season" && earliest != null && earliest > from ? earliest : null,
    trainings,
    games,
    events: events.map((e) => {
      const c = perEvent.get(e.id)!;
      return { eventId: e.id, startsAt: e.starts_at, kind: e.kind, title: titleOf(e), present: c.present, expected: c.expected, late: c.late, unexcused: c.unexcused };
    }),
    avgSquad: games ? nominatedRows / games : null,
    players: players.map((p) => ({ person: { id: p.id, firstName: p.first_name, lastName: p.last_name }, ...byPerson.get(p.id)! })),
    helperPlan: team?.helper_plan === 1,
  };
}

/** A person's single events in a team, newest first. */
export async function loadPersonStatsEvents(db: D1Database, teamId: number, personId: number, range: StatsRange): Promise<StatsEventRow[]> {
  const from = await rangeFrom(db, range);
  const rows = await all<AttendanceRow & { title: string | null; is_home: number | null; home_team: string | null; guest_team: string | null }>(
    db,
    `SELECT ${ATTENDANCE_COLUMNS}, e.title, e.is_home, e.home_team, e.guest_team
       FROM attendance a JOIN events e ON e.id = a.event_id
      WHERE a.person_id = ?1 AND a.team_id = ?2 AND a.kind IN ('training', 'game') AND e.starts_at >= ?3 AND e.cancelled_at IS NULL
      ORDER BY e.starts_at DESC`,
    personId,
    teamId,
    `${from}T00:00`,
  );
  return rows.map((r) => ({
    eventId: r.event_id,
    startsAt: r.starts_at,
    kind: r.kind,
    title: titleOf(r),
    status: r.status,
    late: r.is_late === 1,
    nominated: r.nominated === 1,
  }));
}

/**
 * For whom the actor sees statistics: oneself as a player and the children in teams where parents are in charge.
 * Used by the helper duties module for its part, too.
 */
export function statsPersons(actor: Actor): { person: PersonRef; self: boolean; teamIds: number[] }[] {
  const out: { person: PersonRef; self: boolean; teamIds: number[] }[] = [];
  const own = actor.memberships.filter((m) => m.role === "player").map((m) => m.teamId);
  if (own.length) out.push({ person: { id: actor.personId, firstName: actor.firstName, lastName: actor.lastName }, self: true, teamIds: own });
  for (const child of actor.children) {
    const teams = (actor.childMemberships.get(child.id) ?? []).filter((m) => m.role === "player" && m.parentsEnabled).map((m) => m.teamId);
    if (teams.length) out.push({ person: child, self: false, teamIds: teams });
  }
  return out;
}

/** Statistics of oneself (as a player) and of the children the parents are in charge of. */
export async function loadMyStats(db: D1Database, actor: Actor, now = Date.now()): Promise<MyStats> {
  const today = todayLocal(now);
  const season = await seasonStart(db);
  const fourWeeks = addDays(today, -27);
  const pairs = statsPersons(actor);
  if (!pairs.length) return { persons: [] };
  const personIds = pairs.map((p) => p.person.id);
  const teamIds = [...new Set(pairs.flatMap((p) => p.teamIds))];
  const from = season < fourWeeks ? season : fourWeeks;
  const [rows, teams] = await Promise.all([
    all<AttendanceRow>(
      db,
      `SELECT ${ATTENDANCE_COLUMNS} FROM attendance a JOIN events e ON e.id = a.event_id
        WHERE a.person_id IN (SELECT value FROM json_each(?1)) AND a.kind IN ('training', 'game')
          AND e.starts_at >= ?2 AND e.cancelled_at IS NULL`,
      list(personIds),
      `${from}T00:00`,
    ),
    all<{ id: number; name: string }>(db, "SELECT id, name FROM teams WHERE id IN (SELECT value FROM json_each(?))", list(teamIds)),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const persons: MyStats["persons"] = [];
  for (const p of pairs) {
    const out: MyStats["persons"][number] = { person: p.person, self: p.self, teams: [] };
    for (const teamId of p.teamIds) {
      const team = teamById.get(teamId);
      if (!team) continue;
      const ranges = {
        "4w": { training: emptyCounts(), games: emptyCounts() },
        season: { training: emptyCounts(), games: emptyCounts() },
      };
      for (const r of rows) {
        if (r.person_id !== p.person.id || r.team_id !== teamId) continue;
        const day = r.starts_at.slice(0, 10);
        if (day >= season) count(r.kind === "training" ? ranges.season.training : ranges.season.games, r);
        if (day >= fourWeeks) count(r.kind === "training" ? ranges["4w"].training : ranges["4w"].games, r);
      }
      out.teams.push({ teamId, teamName: team.name, ranges });
    }
    if (out.teams.length) persons.push(out);
  }
  return { persons };
}
