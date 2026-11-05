// What coaches still have to do in their own teams, as hints at the top of the events list (GET /api/coach-hints).
// A hint is a state, not a message: it disappears once the job is done and cannot be dismissed.
import type { CoachHint } from "../../shared/types";
import type { Actor } from "../auth/actor";
import { ownScheduleReminderDays } from "./club";
import { all, list } from "../lib/db";
import { addDays, nowLocal, todayLocal } from "../lib/time";
import { activeConnectors, teamSource } from "./fixtures";

/** This many days before a game the app reminds the coaches of meeting point and time (hint and push). */
export const MEETING_REMINDER_DAYS = 3;

/** Is the team's schedule due for a reminder? `days` from the club profile, 0 = never. */
export function scheduleStale(syncedAt: string | null, days: number, now: number): boolean {
  return days > 0 && (!syncedAt || now - Date.parse(syncedAt) >= days * 86_400_000);
}

/** The opponent of a game for texts: the other team, or the title of a game without home/away. */
export function gameOpponent(g: { is_home: number | null; home_team: string | null; guest_team: string | null; title: string | null }): string | null {
  return g.is_home === 1 ? g.guest_team : g.is_home === 0 ? g.home_team : (g.title ?? g.guest_team);
}

/** Hints for the teams the person coaches; admins only for their own teams. */
export async function loadCoachHints(db: D1Database, actor: Actor, now = Date.now()): Promise<CoachHint[]> {
  const teamIds = actor.coachTeamIds;
  if (!teamIds.length || actor.readOnly) return [];
  const [schedules, meetings] = await Promise.all([staleSchedules(db, teamIds, now), missingMeetingPoints(db, teamIds, now)]);
  return [...schedules, ...meetings];
}

async function staleSchedules(db: D1Database, teamIds: number[], now: number): Promise<CoachHint[]> {
  const connectors = activeConnectors();
  const days = ownScheduleReminderDays();
  if (!connectors.length || !days) return [];
  const teams = (
    await all<{ id: number; name: string; fixture_connector: string; fixture_source: string | null; fixture_synced_at: string | null }>(
      db,
      `SELECT id, name, fixture_connector, fixture_source, fixture_synced_at FROM teams
        WHERE id IN (SELECT value FROM json_each(?)) AND fixture_connector IS NOT NULL ORDER BY name`,
      list(teamIds),
    )
  ).filter((t) => {
    if (!connectors.some((c) => c.id === t.fixture_connector) || !teamSource(t)) return false;
    return scheduleStale(t.fixture_synced_at, days, now);
  });
  if (!teams.length) return [];
  // A team with only past games left has played its season: nothing to sync
  const games = await all<{ team_id: number; upcoming: number; n: number }>(
    db,
    `SELECT et.team_id, max(e.starts_at > ?) AS upcoming, count(*) AS n
       FROM json_each(?) j CROSS JOIN event_teams et ON et.team_id = j.value CROSS JOIN events e ON e.id = et.event_id
      WHERE e.kind = 'game' AND e.cancelled_at IS NULL GROUP BY et.team_id`,
    nowLocal(now),
    list(teams.map((t) => t.id)),
  );
  return teams
    .filter((t) => {
      const g = games.find((x) => x.team_id === t.id);
      return !g || g.upcoming === 1;
    })
    .map((t) => ({
      kind: "schedule" as const,
      teamId: t.id,
      team: t.name,
      source: connectors.find((c) => c.id === t.fixture_connector)!.name,
      days: t.fixture_synced_at ? Math.floor((now - Date.parse(t.fixture_synced_at)) / 86_400_000) : null,
    }));
}

/** Games in the next days without a meeting time: the same rule as the push (sendMeetingReminders). */
async function missingMeetingPoints(db: D1Database, teamIds: number[], now: number): Promise<CoachHint[]> {
  const games = await all<{ id: number; starts_at: string; is_home: number | null; home_team: string | null; guest_team: string | null; title: string | null; team_name: string }>(
    db,
    `SELECT e.id, e.starts_at, e.is_home, e.home_team, e.guest_team, e.title, t.name AS team_name
       FROM json_each(?) j CROSS JOIN event_teams et ON et.team_id = j.value CROSS JOIN events e ON e.id = et.event_id JOIN teams t ON t.id = et.team_id
      WHERE e.kind = 'game' AND e.cancelled_at IS NULL AND e.meeting_time IS NULL
        AND e.starts_at > ? AND substr(e.starts_at, 1, 10) <= ?
      ORDER BY e.starts_at`,
    list(teamIds),
    nowLocal(now),
    addDays(todayLocal(now), MEETING_REMINDER_DAYS),
  );
  return games.map((g) => ({ kind: "meeting" as const, eventId: g.id, team: g.team_name, startsAt: g.starts_at, opponent: gameOpponent(g) }));
}
