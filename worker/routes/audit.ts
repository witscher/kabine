// Administration → Protocol: who did what to whom and when (worker/domain/audit.ts). Admins only.
import { Hono } from "hono";
import type { AuditEntry } from "../../shared/types";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { all } from "../lib/db";

export const auditRoutes = new Hono<AppEnv>();

const PAGE = 100;

interface AuditRow {
  id: number;
  at: string;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  person_id: number | null;
  person_name: string | null;
  team_id: number | null;
  team_name: string | null;
  event_id: number | null;
  detail: string | null;
}

function parseDetail(detail: string | null): AuditEntry["detail"] {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as AuditEntry["detail"];
  } catch {
    return null;
  }
}

/** Newest first, 100 per page; `before` is the id of the last entry already shown. */
auditRoutes.get("/admin/audit-log", async (c) => {
  requireAdmin(requireActor(c));
  const before = Number(c.req.query("before"));
  const rows = await all<AuditRow>(
    c.env.DB,
    `SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ${PAGE + 1}`,
    Number.isInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER,
  );
  const entries: AuditEntry[] = rows.slice(0, PAGE).map((r) => ({
    id: r.id,
    at: r.at,
    actor: { id: r.actor_id, name: r.actor_name },
    action: r.action,
    person: r.person_id == null ? null : { id: r.person_id, name: r.person_name },
    team: r.team_id == null ? null : { id: r.team_id, name: r.team_name },
    eventId: r.event_id,
    detail: parseDetail(r.detail),
  }));
  return c.json({ entries, hasMore: rows.length > PAGE });
});
