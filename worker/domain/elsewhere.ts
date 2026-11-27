// "Elsewhere": coaches see when their players take part in events of other teams and groups (training, game with a
// nomination, special event), with status, never the reason (docs/dev/decisions.md, Players elsewhere). Status and
// participation come from loadEventContext, so the same rules apply as everywhere (yes by default, standing absences,
// optional trainings, nominations, inactive people).
import type { ElsewhereEntry } from "../../shared/types";
import { all, list } from "../lib/db";
import { EVENT_COLUMNS, EVENT_JOINS, type EventRow, eventTeams, eventTitle, loadEventContext } from "./events";

export async function elsewhereFor(
  db: D1Database,
  opts: { personIds: number[]; from: string; to: string; excludeTeamIds: number[]; excludeEventId?: number | null },
): Promise<ElsewhereEntry[]> {
  if (!opts.personIds.length) return [];
  // Candidates from the people's other teams and their nominations, not from all events of the range (query plans)
  const rows = await all<EventRow>(
    db,
    `WITH cand(id) AS MATERIALIZED (
       SELECT et.event_id FROM team_memberships tm JOIN event_teams et ON et.team_id = tm.team_id
        WHERE tm.person_id IN (SELECT value FROM json_each(?1)) AND tm.role IN ('player', 'helper')
          AND tm.team_id NOT IN (SELECT value FROM json_each(?4))
       UNION SELECT event_id FROM nominations WHERE person_id IN (SELECT value FROM json_each(?1))
     )
     SELECT ${EVENT_COLUMNS} FROM cand CROSS JOIN events e ON e.id = cand.id${EVENT_JOINS}
      WHERE e.starts_at >= ?2 AND e.starts_at < ?3 AND e.cancelled_at IS NULL AND e.id <> ?5 AND e.club_wide = 0
        AND NOT EXISTS (SELECT 1 FROM event_teams x WHERE x.event_id = e.id AND x.team_id IN (SELECT value FROM json_each(?4)))
      ORDER BY e.starts_at, e.id`,
    list(opts.personIds),
    opts.from,
    opts.to,
    list(opts.excludeTeamIds),
    opts.excludeEventId ?? 0,
  );
  if (!rows.length) return [];
  const ctx = await loadEventContext(db, rows);
  const wanted = new Set(opts.personIds);
  const out: ElsewhereEntry[] = [];
  for (const e of rows) {
    const teams = eventTeams(e, ctx).map((t) => ({ id: t.id, name: t.name }));
    for (const p of ctx.participants.get(e.id) ?? []) {
      if (!wanted.has(p.person.id) || p.status === "inactive") continue;
      // Games only with a nomination (otherwise the person does not play there), optional events only with a yes
      if (e.kind === "game" && !p.nominated) continue;
      if (p.optional && p.status !== "yes") continue;
      out.push({
        person: p.person,
        event: { id: e.id, kind: e.kind, title: eventTitle(e, teams), startsAt: e.starts_at, endsAt: e.ends_at, teams: teams.map((t) => t.name) },
        status: p.status,
      });
    }
  }
  return out;
}
