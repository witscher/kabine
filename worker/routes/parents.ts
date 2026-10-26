import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import type { ChildPermission, ChildPermissions, NotificationTopic } from "../../shared/types";
import { childPermissionLabels, CORE_NOTIFICATION_TOPICS } from "../../shared/types";
import { MODULES, moduleTopics } from "../../shared/modules";
import { type AppEnv, intParam, requireActor } from "../app";
import { ALL_PERMISSIONS, type Actor, parentsInCharge } from "../auth/actor";
import { childAccountAllowed, limitedTeamsOf } from "../domain/child-limits";
import { isModuleOn } from "../domain/club";
import { enqueuePush } from "../domain/notify";
import { all, first, stmt } from "../lib/db";
import { forbidden, parse, readJson } from "../lib/http";
import { utcIso } from "../lib/time";

export const parentRoutes = new Hono<AppEnv>();

const PERMISSIONS = Object.keys(ALL_PERMISSIONS) as ChildPermission[];

function requireGuardian(actor: Actor, childId: number) {
  if (!actor.children.some((c) => c.id === childId)) throw forbidden(t`Only linked parents can set this.`);
}

/** Permissions and notifications for a child exist only if parents are involved in one of the child's teams. */
function requireInCharge(actor: Actor, childId: number) {
  requireGuardian(actor, childId);
  if (!parentsInCharge(actor, childId)) throw forbidden(t`Parents are not involved in your child's teams.`);
}

async function permissionsOf(db: D1Database, childId: number): Promise<ChildPermissions> {
  const row = await first<Record<ChildPermission, number>>(db, "SELECT * FROM child_permissions WHERE child_id = ?", childId);
  const out = { ...ALL_PERMISSIONS };
  if (row) for (const p of PERMISSIONS) out[p] = row[p] === 1;
  return out;
}

parentRoutes.get("/children/:id/permissions", async (c) => {
  const actor = requireActor(c);
  const childId = intParam(c, "id");
  requireGuardian(actor, childId);
  const [permissions, log, info, guardians, accountAllowed, limitedTeams] = await Promise.all([
    permissionsOf(c.env.DB, childId),
    all<{ permission: ChildPermission; value: number; changed_at: string; first_name: string | null }>(
      c.env.DB,
      `SELECT l.permission, l.value, l.changed_at, p.first_name
         FROM child_permission_log l LEFT JOIN accounts a ON a.id = l.account_id LEFT JOIN persons p ON p.id = a.person_id
        WHERE l.child_id = ? ORDER BY l.changed_at DESC LIMIT 30`,
      childId,
    ),
    first<{ has_account: number }>(c.env.DB, "SELECT EXISTS (SELECT 1 FROM accounts WHERE person_id = ?) AS has_account", childId),
    all<{ first_name: string; last_name: string | null; has_account: number }>(
      c.env.DB,
      `SELECT p.first_name, p.last_name, EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id) AS has_account
         FROM guardianships g JOIN persons p ON p.id = g.guardian_id WHERE g.child_id = ? ORDER BY p.first_name`,
      childId,
    ),
    childAccountAllowed(c.env.DB, childId),
    // Teams of the child whose age class or team limit what the child may do (children in the app)
    limitedTeamsOf(c.env.DB, childId),
  ]);
  return c.json({
    permissions,
    parentsInCharge: parentsInCharge(actor, childId),
    labels: childPermissionLabels(),
    childHasAccount: info?.has_account === 1,
    childAccountAllowed: accountAllowed,
    limitedTeams,
    guardians: guardians.map((g) => ({ firstName: g.first_name, lastName: g.last_name, hasAccount: g.has_account === 1 })),
    log: log.map((l) => ({ permission: l.permission, value: l.value === 1, at: l.changed_at, byName: l.first_name ?? t`Former parent` })),
  });
});

const permissionSchema = z.object({
  permission: z.enum(PERMISSIONS as [ChildPermission, ...ChildPermission[]]),
  value: z.boolean(),
});

parentRoutes.put("/children/:id/permissions", async (c) => {
  const actor = requireActor(c);
  const childId = intParam(c, "id");
  requireInCharge(actor, childId);
  const { permission, value } = parse(permissionSchema, await readJson(c.req.raw));
  const current = await permissionsOf(c.env.DB, childId);
  if (current[permission] === value) return c.json({ ok: true, permissions: current });
  const now = utcIso();
  await c.env.DB.batch([
    stmt(c.env.DB, "INSERT OR IGNORE INTO child_permissions (child_id) VALUES (?)", childId),
    stmt(c.env.DB, `UPDATE child_permissions SET ${permission} = ?, updated_at = ? WHERE child_id = ?`, value ? 1 : 0, now, childId),
    stmt(c.env.DB, "INSERT INTO child_permission_log (child_id, account_id, permission, value, changed_at) VALUES (?, ?, ?, ?, ?)", childId, actor.accountId, permission, value ? 1 : 0, now),
  ]);
  // Inform the other parent
  const others = await all<{ id: number }>(
    c.env.DB,
    `SELECT a.id FROM guardianships g JOIN accounts a ON a.person_id = g.guardian_id
      WHERE g.child_id = ? AND a.id <> ? AND a.disabled_at IS NULL`,
    childId,
    actor.accountId,
  );
  const child = actor.children.find((ch) => ch.id === childId)!;
  const name = actor.firstName;
  const childName = child.firstName;
  await enqueuePush(c.env, others.map((o) => o.id), () => {
    const label = childPermissionLabels()[permission];
    return {
      title: t`Permission changed`,
      body: value ? t`${name} has allowed “${label}” for ${childName}.` : t`${name} has turned off “${label}” for ${childName}.`,
      url: `/profil/kind/${childId}`,
    };
  });
  return c.json({ ok: true, permissions: await permissionsOf(c.env.DB, childId) });
});

// Notification settings -----------------------------------------------------------

/** Core topics and those of all modules (settings of switched-off modules are kept, but not shown). */
const TOPICS = [...CORE_NOTIFICATION_TOPICS, ...MODULES.flatMap((m) => moduleTopics(m.id))] as NotificationTopic[];

/** Topics shown now: core topics and those of active modules. */
const shownTopics = () => [...CORE_NOTIFICATION_TOPICS, ...MODULES.filter((m) => isModuleOn(m.id)).flatMap((m) => moduleTopics(m.id))] as NotificationTopic[];

parentRoutes.get("/me/notifications", async (c) => {
  const actor = requireActor(c);
  const rows = await all<{ person_id: number; topic: NotificationTopic; enabled: number }>(
    c.env.DB,
    "SELECT person_id, topic, enabled FROM notification_settings WHERE account_id = ?",
    actor.accountId,
  );
  const persons = [
    { id: actor.personId, firstName: actor.firstName, lastName: actor.lastName, self: true },
    ...actor.children.filter((ch) => parentsInCharge(actor, ch.id)).map((ch) => ({ ...ch, self: false })),
  ];
  const isCoach = actor.coachTeamIds.length > 0 || actor.isAdmin;
  // "Responses by others" is only needed by someone whose parents act for them
  const selfInCharge = actor.hasGuardians && parentsInCharge(actor, actor.personId);
  return c.json({
    persons: persons.map((p) => {
      const topics = shownTopics().filter((t) => (t === "coach" ? p.self && isCoach : true)).filter((t) => !(t === "responses" && p.self && !selfInCharge));
      return {
        person: { id: p.id, firstName: p.firstName, lastName: p.lastName },
        self: p.self,
        topics: Object.fromEntries(
          topics.map((t) => [t, rows.find((r) => r.person_id === p.id && r.topic === t)?.enabled !== 0]),
        ),
      };
    }),
  });
});

const settingSchema = z.object({
  personId: z.number().int().positive(),
  topic: z.enum(TOPICS as [NotificationTopic, ...NotificationTopic[]]),
  enabled: z.boolean(),
});

parentRoutes.put("/me/notifications", async (c) => {
  const actor = requireActor(c);
  const input = parse(settingSchema, await readJson(c.req.raw));
  if (input.personId !== actor.personId) requireInCharge(actor, input.personId);
  await c.env.DB.prepare(
    `INSERT INTO notification_settings (account_id, person_id, topic, enabled) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, person_id, topic) DO UPDATE SET enabled = excluded.enabled`,
  )
    .bind(actor.accountId, input.personId, input.topic, input.enabled ? 1 : 0)
    .run();
  return c.json({ ok: true });
});
