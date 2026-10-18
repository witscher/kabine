// Events created by hand: special events and games not from a game schedule. For the list under
// Administration (all teams) and under Team → Events (one team).
import type { Actor } from "../auth/actor";
import { all } from "../lib/db";
import { nowLocal } from "../lib/time";
import { EVENT_SELECT, type EventRow, loadEventContext, toSummary } from "./events";

export interface ExtraEvent {
  id: number;
  kind: string;
  title: string;
  startsAt: string;
  teams: { id: number; name: string }[];
  clubWide: boolean;
  cancelled: boolean;
  location: string | null;
}

export async function listExtraEvents(db: D1Database, actor: Actor, opts: { teamId?: number } = {}): Promise<ExtraEvent[]> {
  const params: (string | number)[] = [nowLocal()];
  let teamFilter = "";
  if (opts.teamId != null) {
    params.push(opts.teamId);
    teamFilter = " AND EXISTS (SELECT 1 FROM event_teams ft WHERE ft.event_id = e.id AND ft.team_id = ?2)";
  }
  const rows = await all<EventRow>(
    db,
    `${EVENT_SELECT} WHERE e.starts_at >= ?1 AND (e.kind = 'special' OR (e.kind = 'game' AND e.external_ref IS NULL))${teamFilter}
      ORDER BY e.starts_at, e.id`,
    ...params,
  );
  const ctx = await loadEventContext(db, rows);
  const now = Date.now();
  return rows.map((e) => {
    const s = toSummary(e, ctx, actor, now);
    return { id: s.id, kind: s.kind, title: s.title, startsAt: s.startsAt, teams: s.teams, clubWide: s.clubWide, cancelled: !!s.cancelled, location: s.location?.name ?? null };
  });
}
