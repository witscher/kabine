import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, parentsInCharge, requireAdmin } from "../auth/actor";
import { assertNotProtected, assertNotStaffUnlessAdmin } from "../auth/owner";
import { relyingParty } from "../auth/webauthn";
import { syncAutoSquads } from "../domain/auto-squad";
import { forgetInChats } from "../domain/chat";
import { createInvite, inviteUrl } from "../domain/invites";
import { syncAutoGroups } from "../domain/groups";
import { all, first, list, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { utcIso } from "../lib/time";

export const personRoutes = new Hono<AppEnv>();

const nameField = z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(50, { error: () => t`The name is too long.` });

/**
 * Coaches manage players, stand-ins and staff of their teams and the players' parents.
 * Admins manage everyone.
 */
export async function canManagePerson(db: D1Database, actor: Actor, personId: number): Promise<boolean> {
  if (actor.isAdmin) return true;
  if (!actor.coachTeamIds.length) return false;
  const row = await first(
    db,
    `SELECT 1 AS ok FROM team_memberships
      WHERE person_id = ?1 AND role IN ('player', 'helper', 'staff') AND team_id IN (SELECT value FROM json_each(?2))
     UNION
     SELECT 1 FROM guardianships g JOIN team_memberships tm ON tm.person_id = g.child_id
      WHERE g.guardian_id = ?1 AND tm.role IN ('player', 'helper') AND tm.team_id IN (SELECT value FROM json_each(?2))`,
    personId,
    list(actor.coachTeamIds),
  );
  return row != null;
}

async function requireManagePerson(db: D1Database, actor: Actor, personId: number) {
  if (!(await canManagePerson(db, actor, personId))) throw forbidden(t`You do not manage this person.`);
}

const updatePersonSchema = z.object({
  firstName: nameField.optional(),
  lastName: nameField.nullable().optional(),
  birthYear: z.number().int().min(1930).max(2100).nullable().optional(),
});

personRoutes.patch("/persons/:id", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "id");
  const input = parse(updatePersonSchema, await readJson(c.req.raw));
  const self = personId === actor.personId;
  if (!self) await requireManagePerson(c.env.DB, actor, personId);
  if (self && input.birthYear !== undefined && !actor.isAdmin && !(await canManagePerson(c.env.DB, actor, personId))) {
    throw forbidden(t`Your coach maintains the birth year.`);
  }
  const person = await first<{ first_name: string; last_name: string | null; birth_year: number | null }>(
    c.env.DB,
    "SELECT first_name, last_name, birth_year FROM persons WHERE id = ? AND is_former = 0",
    personId,
  );
  if (!person) throw notFound(t`This person does not exist.`);
  await run(
    c.env.DB,
    "UPDATE persons SET first_name = ?, last_name = ?, birth_year = ? WHERE id = ?",
    input.firstName ?? person.first_name,
    input.lastName === undefined ? person.last_name : input.lastName,
    input.birthYear === undefined ? person.birth_year : input.birthYear,
    personId,
  );
  return c.json({ ok: true });
});

personRoutes.post("/persons/:id/active", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "id");
  await requireManagePerson(c.env.DB, actor, personId);
  const { active } = parse(z.object({ active: z.boolean() }), await readJson(c.req.raw));
  const res = await run(
    c.env.DB,
    "UPDATE persons SET is_active = ?, active_changed_at = ?, active_changed_by = ? WHERE id = ? AND is_former = 0",
    active ? 1 : 0,
    utcIso(),
    actor.personId,
    personId,
  );
  if (!res.meta.changes) throw notFound();
  // Inactive persons drop out of automatic squads, reactivated ones come back
  const teams = await all<{ team_id: number }>(c.env.DB, "SELECT team_id FROM core_squad WHERE person_id = ?", personId);
  if (teams.length) await syncAutoSquads(c.env.DB, teams.map((t) => t.team_id));
  return c.json({ ok: true });
});

/** Unlinks an account, e.g. after a wrong choice on the player link. */
personRoutes.delete("/persons/:id/account", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "id");
  await requireManagePerson(c.env.DB, actor, personId);
  if (personId === actor.personId) throw badRequest(t`You cannot unlink your own access here.`);
  await assertNotProtected(c.env.DB, actor, personId);
  await assertNotStaffUnlessAdmin(c.env.DB, actor, personId);
  const target = await first<{ is_admin: number }>(c.env.DB, "SELECT is_admin FROM persons WHERE id = ?", personId);
  if (target?.is_admin && !actor.isAdmin) throw forbidden();
  const res = await run(c.env.DB, "DELETE FROM accounts WHERE person_id = ?", personId);
  if (!res.meta.changes) throw notFound(t`This person has no access.`);
  return c.json({ ok: true });
});

/** Removes a parent link. Parents without a remaining child are deleted. */
personRoutes.delete("/guardianships/:guardianId/:childId", async (c) => {
  const actor = requireActor(c);
  const guardianId = intParam(c, "guardianId");
  const childId = intParam(c, "childId");
  const isSelf = guardianId === actor.personId;
  if (!isSelf) await requireManagePerson(c.env.DB, actor, childId);
  const res = await run(c.env.DB, "DELETE FROM guardianships WHERE guardian_id = ? AND child_id = ?", guardianId, childId);
  if (!res.meta.changes) throw notFound(t`This link does not exist.`);
  await deleteOrphanParent(c.env.DB, guardianId);
  return c.json({ ok: true });
});

const guardianshipSchema = z.object({ guardianId: z.number().int().positive(), childId: z.number().int().positive() });

/** Admins assign parents and children directly, e.g. to correct wrong links. */
personRoutes.post("/admin/guardianships", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const { guardianId, childId } = parse(guardianshipSchema, await readJson(c.req.raw));
  if (guardianId === childId) throw badRequest(t`A person cannot be their own parent.`);
  const found = await all<{ id: number }>(c.env.DB, "SELECT id FROM persons WHERE id IN (?, ?) AND is_former = 0", guardianId, childId);
  if (found.length !== 2) throw notFound(t`This person does not exist.`);
  const reverse = await first(c.env.DB, "SELECT 1 AS x FROM guardianships WHERE guardian_id = ? AND child_id = ?", childId, guardianId);
  if (reverse) throw conflict(t`A link already exists the other way round: the child is registered as a parent of this person.`);
  await run(c.env.DB, "INSERT OR IGNORE INTO guardianships (guardian_id, child_id) VALUES (?, ?)", guardianId, childId);
  return c.json({ ok: true }, 201);
});

/** Link removed by an admin. The persons remain in any case. */
personRoutes.delete("/admin/guardianships/:guardianId/:childId", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const res = await run(c.env.DB, "DELETE FROM guardianships WHERE guardian_id = ? AND child_id = ?", intParam(c, "guardianId"), intParam(c, "childId"));
  if (!res.meta.changes) throw notFound(t`This link does not exist.`);
  return c.json({ ok: true });
});

/** Deletes a parent person if they have no child left and no other role in the club. */
export async function deleteOrphanParent(db: D1Database, personId: number): Promise<boolean> {
  const res = await run(
    db,
    `DELETE FROM persons WHERE id = ? AND is_admin = 0
       AND NOT EXISTS (SELECT 1 FROM guardianships WHERE guardian_id = persons.id)
       AND NOT EXISTS (SELECT 1 FROM team_memberships WHERE person_id = persons.id)
       AND NOT EXISTS (SELECT 1 FROM guardianships WHERE child_id = persons.id)`,
    personId,
  );
  return (res.meta.changes ?? 0) > 0;
}

/** Personal one-time link: first access (e.g. coach) or a new passkey after losing a device. */
personRoutes.post("/persons/:id/personal-link", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "id");
  const target = await first<{ is_admin: number; coach: number }>(
    c.env.DB,
    `SELECT is_admin, EXISTS (SELECT 1 FROM team_memberships WHERE person_id = persons.id AND role = 'coach') AS coach
       FROM persons WHERE id = ? AND is_former = 0`,
    personId,
  );
  if (!target) throw notFound(t`This person does not exist.`);
  await assertNotProtected(c.env.DB, actor, personId);
  // Only an admin restores access of coaches and admins.
  if ((target.is_admin || target.coach) && !actor.isAdmin) throw forbidden(t`Access of coaches and admins is managed by an admin.`);
  // Parents set up their child's access themselves if they are involved in the child's team
  const asParent = !target.is_admin && !target.coach && actor.children.some((ch) => ch.id === personId) && parentsInCharge(actor, personId);
  if (!target.is_admin && !target.coach && !asParent) await requireManagePerson(c.env.DB, actor, personId);
  // On an existing account the link always replaces the previous passkeys and sessions (see routes/join.ts)
  const invite = await createInvite(c.env, { kind: "personal", personId, createdBy: actor.personId });
  return c.json({ url: inviteUrl(relyingParty(c.env, c.req.raw).origin, invite.token), expiresAt: invite.expiresAt }, 201);
});

// Admin: all persons -----------------------------------------------------------

personRoutes.get("/admin/persons", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const rows = await all<{
    id: number;
    first_name: string;
    last_name: string | null;
    birth_year: number | null;
    is_active: number;
    is_admin: number;
    admin_email: string | null;
    has_account: number;
    is_referee: number;
    is_club_member: number;
    last_seen_on: string | null;
    teams: string | null;
    children: string | null;
    child_teams: string | null;
    child_list: string | null;
    parent_list: string | null;
  }>(
    c.env.DB,
    `SELECT p.id, p.first_name, p.last_name, p.birth_year, p.is_active, p.is_admin, p.admin_email,
            EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id) AS has_account,
            EXISTS (SELECT 1 FROM referees r WHERE r.person_id = p.id) AS is_referee,
            EXISTS (SELECT 1 FROM club_members cm WHERE cm.person_id = p.id) AS is_club_member,
            (SELECT a.last_seen_on FROM accounts a WHERE a.person_id = p.id) AS last_seen_on,
            (SELECT group_concat(t.name || ':' || tm.role || ':' || t.kind, ',') FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.person_id = p.id) AS teams,
            (SELECT group_concat(cp.first_name, ', ') FROM guardianships g JOIN persons cp ON cp.id = g.child_id WHERE g.guardian_id = p.id) AS children,
            (SELECT group_concat(DISTINCT t.name) FROM guardianships g JOIN team_memberships tm ON tm.person_id = g.child_id
               JOIN teams t ON t.id = tm.team_id WHERE g.guardian_id = p.id) AS child_teams,
            (SELECT json_group_array(g.child_id) FROM guardianships g JOIN persons cp ON cp.id = g.child_id
              WHERE g.guardian_id = p.id AND cp.is_former = 0) AS child_list,
            (SELECT json_group_array(g.guardian_id) FROM guardianships g JOIN persons gp ON gp.id = g.guardian_id
              WHERE g.child_id = p.id AND gp.is_former = 0) AS parent_list
       FROM persons p WHERE p.is_former = 0
      ORDER BY p.first_name, p.last_name, p.id`,
  );
  return c.json({
    persons: rows.map((r) => ({
      person: { id: r.id, firstName: r.first_name, lastName: r.last_name },
      birthYear: r.birth_year,
      isActive: r.is_active === 1,
      isAdmin: r.is_admin === 1,
      adminEmail: r.admin_email,
      hasAccount: r.has_account === 1,
      isReferee: r.is_referee === 1,
      /** Full member (hidden attribute, only admins see and change it) */
      isClubMember: r.is_club_member === 1,
      /** Last activity of the access (local date), null = access never used or no access. */
      lastSeenOn: r.last_seen_on,
      teams: (r.teams ?? "")
        .split(",")
        .filter(Boolean)
        .map((t) => {
          const [name, role, kind] = t.split(":");
          return { name: name!, role: role!, isGroup: kind === "group" };
        }),
      children: r.children,
      childTeams: (r.child_teams ?? "").split(",").filter(Boolean),
      childIds: JSON.parse(r.child_list ?? "[]") as number[],
      parentIds: JSON.parse(r.parent_list ?? "[]") as number[],
    })),
  });
});

const adminPersonSchema = z.object({
  firstName: nameField,
  lastName: nameField.nullable().optional(),
  birthYear: z.number().int().min(1930).max(2100).nullable().optional(),
});

personRoutes.post("/admin/persons", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(adminPersonSchema, await readJson(c.req.raw));
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO persons (first_name, last_name, birth_year) VALUES (?, ?, ?) RETURNING id",
    input.firstName,
    input.lastName ?? null,
    input.birthYear ?? null,
  );
  return c.json({ id: row!.id }, 201);
});

const adminFlagSchema = z.object({
  isAdmin: z.boolean(),
  adminEmail: z.email({ error: () => t`Please enter a valid e-mail address.` }).nullable().optional(),
});

personRoutes.patch("/admin/persons/:id", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const personId = intParam(c, "id");
  const input = parse(adminFlagSchema, await readJson(c.req.raw));
  if (personId === actor.personId && !input.isAdmin) throw conflict(t`You cannot remove your own admin rights.`);
  await assertNotProtected(c.env.DB, actor, personId);
  if (!input.isAdmin) {
    await run(c.env.DB, "UPDATE persons SET is_admin = 0, admin_email = NULL WHERE id = ?", personId);
  } else {
    try {
      await run(c.env.DB, "UPDATE persons SET is_admin = 1, admin_email = ? WHERE id = ?", input.adminEmail ?? null, personId);
    } catch (err) {
      if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict(t`This e-mail address is already taken.`);
      throw err;
    }
  }
  // Admins are in charge of the youth referee group
  await syncAutoGroups(c.env.DB);
  return c.json({ ok: true });
});

/**
 * Deletes a person permanently (admins only). Access, memberships, responses,
 * parent links etc. go along via ON DELETE CASCADE. Parents who thereby have
 * no child and no role left are deleted as well.
 * Messages remain in the chats anonymously.
 */
personRoutes.delete("/admin/persons/:id", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const personId = intParam(c, "id");
  if (personId === actor.personId) throw badRequest(t`You cannot delete yourself.`);
  await assertNotProtected(c.env.DB, actor, personId);
  const person = await first<{ id: number }>(c.env.DB, "SELECT id FROM persons WHERE id = ?", personId);
  if (!person) throw notFound(t`This person does not exist.`);
  const parents = await all<{ id: number }>(
    c.env.DB,
    `SELECT g.guardian_id AS id FROM guardianships g JOIN persons gp ON gp.id = g.guardian_id
      WHERE g.child_id = ?1 AND gp.is_admin = 0
        AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.person_id = g.guardian_id)
        AND NOT EXISTS (SELECT 1 FROM guardianships g2 WHERE g2.guardian_id = g.guardian_id AND g2.child_id <> ?1)
        AND NOT EXISTS (SELECT 1 FROM guardianships g3 WHERE g3.child_id = g.guardian_id)`,
    personId,
  );
  const ids = [personId, ...parents.map((p) => p.id)];
  await c.env.DB.batch(ids.map((id) => stmt(c.env.DB, "DELETE FROM persons WHERE id = ?", id)));
  const teams = await all<{ id: number }>(c.env.DB, "SELECT id FROM teams");
  c.executionCtx.waitUntil(forgetInChats(c.env, teams.map((t) => t.id), ids));
  return c.json({ ok: true, parentsDeleted: parents.length });
});

export { stmt };
