// Protocol for admins (Administration → Protocol): actions with a large effect, so they stay traceable in a
// club that trusts its coaches (docs/dev/security.md, Trust model). Everyday things (responses, squad, chat,
// helper duties) are not logged. Names are copied as they are now; entries about deleted people stay readable.
import type { AuditDetail } from "../../shared/types";
import type { Actor } from "../auth/actor";
import { first, stmt } from "../lib/db";

/** Actions of the core; modules use their own codes, prefixed with the module id (e.g. "duties.grant"). */
export type AuditAction =
  | "account_removed"
  | "personal_link"
  | "left_club"
  | "person_deleted"
  | "admin_granted"
  | "admin_removed"
  | "member_added"
  | "member_removed"
  | "set_inactive"
  | "set_active"
  | "guardian_set"
  | "guardian_removed"
  | "schedule_linked"
  | "schedule_removed"
  | "schedule_sync"
  | "event_cancelled"
  | "event_uncancelled"
  | "event_deleted"
  | "team_deleted"
  | "season_change"
  | "export";

export interface AuditTarget {
  personId?: number | null;
  teamId?: number | null;
  eventId?: number | null;
  detail?: AuditDetail;
}

type AuditBy = Pick<Actor, "personId" | "firstName" | "lastName"> | null;

/**
 * The entry as a statement, for a batch: on deletions it goes in the same batch before the delete, so the names
 * are still there. actor null: the app itself (e.g. the nightly schedule sync). ifChanged: written only when the
 * statement right before it in the batch changed a row.
 */
export function auditStmt(
  db: D1Database,
  actor: AuditBy,
  action: AuditAction | `${string}.${string}`,
  target: AuditTarget = {},
  opts: { ifChanged?: boolean } = {},
): D1PreparedStatement {
  const detail = target.detail && Object.keys(target.detail).length ? JSON.stringify(target.detail).slice(0, 300) : null;
  return stmt(
    db,
    `INSERT INTO audit_log (actor_id, actor_name, action, person_id, person_name, team_id, team_name, event_id, detail)
     SELECT ?1, ?2, ?3, ?4, (SELECT trim(first_name || ' ' || coalesce(last_name, '')) FROM persons WHERE id = ?4),
            ?5, (SELECT name FROM teams WHERE id = ?5), ?6, ?7${opts.ifChanged ? " WHERE changes() > 0" : ""}`,
    actor?.personId ?? null,
    actor ? `${actor.firstName} ${actor.lastName ?? ""}`.trim() : null,
    action,
    target.personId ?? null,
    target.teamId ?? null,
    target.eventId ?? null,
    detail,
  );
}

/** Writes an entry. A failed entry never blocks the action it describes. */
export async function audit(db: D1Database, actor: AuditBy, action: AuditAction | `${string}.${string}`, target: AuditTarget = {}): Promise<void> {
  try {
    await auditStmt(db, actor, action, target).run();
  } catch (err) {
    console.warn(`Audit entry ${action} failed`, err instanceof Error ? err.message : err);
  }
}

/** Full name for a detail, e.g. the child of a removed parent link. */
export async function personName(db: D1Database, personId: number): Promise<string | null> {
  return (await first<{ name: string }>(db, "SELECT trim(first_name || ' ' || coalesce(last_name, '')) AS name FROM persons WHERE id = ?", personId))?.name ?? null;
}

/** What a protocol entry keeps of an event: kind, title or opponent, start (the event may be deleted later). */
export function auditEvent(e: {
  kind: string;
  title: string | null;
  starts_at: string;
  is_home?: number | null;
  home_team?: string | null;
  guest_team?: string | null;
}): AuditDetail {
  const title = e.kind === "game" ? (e.is_home === 0 ? e.home_team : e.guest_team) : e.title;
  return { kind: e.kind, title: title ?? null, startsAt: e.starts_at };
}
