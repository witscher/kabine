// Leaders of an event say "I'm not there": coaches of the event's teams, leads of a group, team staff, creator
// and organisers of a special event. Leaders are not participants: no yes/no, no reminders, no counts, no
// squad, never "unexcused". No entry in leader_absences means present. Club-wide events have no leaders.
import type { LeaderEntry, LeaderRole } from "../../shared/types";
import type { Actor } from "../auth/actor";
import { all, list, SHORT_NAME_SQL } from "../lib/db";
import { localToInstant } from "../lib/time";
import type { EventContext, EventRow } from "./events";

export interface Leader {
  personId: number;
  name: string;
  role: LeaderRole;
}

/**
 * The leaders of an event, each person once with their first role (coach or lead before staff before
 * organiser). Memberships in the database count, not admin rights: an admin who coaches no team of the
 * event is no leader there.
 */
export async function loadLeaders(db: D1Database, event: Pick<EventRow, "id" | "club_wide">, teamIds: readonly number[]): Promise<Leader[]> {
  if (event.club_wide === 1) return [];
  const rows = await all<{ person_id: number; name: string; role: LeaderRole }>(
    db,
    `SELECT person_id, name, role FROM (
       SELECT p.id AS person_id, ${SHORT_NAME_SQL("p")} AS name,
              CASE WHEN tm.role = 'staff' THEN 'staff' WHEN t.kind = 'group' THEN 'lead' ELSE 'coach' END AS role,
              CASE WHEN tm.role = 'staff' THEN 1 ELSE 0 END AS rank
         FROM team_memberships tm JOIN teams t ON t.id = tm.team_id JOIN persons p ON p.id = tm.person_id
        WHERE tm.team_id IN (SELECT value FROM json_each(?1)) AND tm.role IN ('coach', 'staff') AND p.is_former = 0
       UNION ALL
       SELECT p.id, ${SHORT_NAME_SQL("p")}, 'organizer', 2
         FROM events e JOIN persons p ON p.id = e.created_by
        WHERE e.id = ?2 AND e.kind = 'special' AND p.is_former = 0
       UNION ALL
       SELECT p.id, ${SHORT_NAME_SQL("p")}, 'organizer', 2
         FROM event_organizers o JOIN events e ON e.id = o.event_id JOIN persons p ON p.id = o.person_id
        WHERE o.event_id = ?2 AND e.kind = 'special' AND p.is_former = 0
     ) ORDER BY rank, name, person_id`,
    list([...teamIds]),
    event.id,
  );
  const seen = new Set<number>();
  const out: Leader[] = [];
  for (const r of rows) {
    if (seen.has(r.person_id)) continue;
    seen.add(r.person_id);
    out.push({ personId: r.person_id, name: r.name, role: r.role });
  }
  return out;
}

/** Changing one's own entry: before the start, not for a cancelled event, not in a read-only view. */
export function absenceChangeable(event: Pick<EventRow, "starts_at" | "cancelled_at">, actor: Actor, now: number): boolean {
  return !event.cancelled_at && localToInstant(event.starts_at) > now && !actor.readOnly;
}

/**
 * Leaders as the event page shows them. Coaches and admins of the event see everyone with the note. Everyone
 * else sees only absent leaders and themselves, never someone else's note, regardless of "responses visible
 * to all": that switch protects children from a domino effect among peers, a missing coach is organisation
 * the team needs to know.
 */
export function leaderEntries(leaders: Leader[], event: EventRow, ctx: EventContext, actor: Actor, canManage: boolean, now: number): LeaderEntry[] {
  const changeable = absenceChangeable(event, actor, now);
  return leaders
    .filter((l) => canManage || l.personId === actor.personId || ctx.leaderAbsences.has(`${event.id}:${l.personId}`))
    .map((l) => {
      const absence = ctx.leaderAbsences.get(`${event.id}:${l.personId}`);
      const self = l.personId === actor.personId;
      return {
        personId: l.personId,
        name: l.name,
        role: l.role,
        absent: !!absence,
        note: canManage || self ? (absence?.note ?? null) : null,
        teamInformed: canManage || self ? !!absence?.teamInformed : false,
        canChange: self && changeable,
      };
    });
}

/** Own accounts of these leaders that want coach notifications (never their parents'). */
export async function leaderAccounts(db: D1Database, personIds: readonly number[]): Promise<number[]> {
  if (!personIds.length) return [];
  const rows = await all<{ id: number }>(
    db,
    `SELECT a.id FROM accounts a
      WHERE a.person_id IN (SELECT value FROM json_each(?)) AND a.disabled_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM notification_settings ns
           WHERE ns.account_id = a.id AND ns.person_id = a.person_id AND ns.topic = 'coach' AND ns.enabled = 0
        )`,
    list([...personIds]),
  );
  return rows.map((r) => r.id);
}
