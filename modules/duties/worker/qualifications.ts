// Qualifications approved by an admin (docs/dev/design.md, Qualifications): approvals per person, links that grant
// one, and the list of open places of a duty type taken by the approved people from all teams (e.g. youth
// referees). The link only approves persons who are already in the app (signed in: oneself or one's own child).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../../../worker/app";
import { type Actor, isCoachOf, parentsInCharge, requireAdmin } from "../../../worker/auth/actor";
import { type DutyType, ensureEventDuties, loadDutyTypes, loadSkills, qualifiedRoles, REQUIRED_DUTIES_SQL } from "../../../worker/domain/duties";
import { syncAutoGroups } from "../../../worker/domain/groups";
import { dutyHubStub } from "../../../worker/duties/hub";
import { relyingParty } from "../../../worker/auth/webauthn";
import { randomToken, sha256Hex } from "../../../worker/lib/crypto";
import { all, first, run, SHORT_NAME_SQL } from "../../../worker/lib/db";
import { revalidateChatAccess } from "../../../worker/domain/chat";
import { badRequest, forbidden, notFound, parse, readJson, upgradeHeaders } from "../../../worker/lib/http";
import { nowLocal, todayLocal, utcIso } from "../../../worker/lib/time";
import { blockView, type EventRow, eventView, loadBlocksAndEntries, qualifiedHub } from "./routes";
import { audit } from "../../../worker/domain/audit";

export const qualificationRoutes = new Hono<AppEnv>();

export const GRANT_LINK_DAYS = 30;

/** A duty type whose prior knowledge an admin approves. */
async function adminType(db: D1Database, id: number): Promise<DutyType> {
  const type = (await loadDutyTypes(db)).get(id);
  if (!type || type.eventId != null || !type.needsSkill || type.skillGrant !== "admin") throw notFound(t`No admin approves this duty.`);
  return type;
}

// Admin: approvals per person ---------------------------------------------------------

/** Every duty type approved by admins, with the approved people (for the page Administration → Approvals). */
qualificationRoutes.get("/admin/qualifications", async (c) => {
  requireAdmin(requireActor(c));
  const db = c.env.DB;
  const types = [...(await loadDutyTypes(db)).values()].filter((dt) => dt.eventId == null && dt.needsSkill && dt.skillGrant === "admin" && !dt.archived);
  const rows = await all<{ duty_type_id: number; id: number; first_name: string; last_name: string | null; birth_year: number | null; teams: string | null }>(
    db,
    `SELECT g.duty_type_id, p.id, p.first_name, p.last_name, p.birth_year,
            (SELECT group_concat(tm2.name, ', ') FROM (SELECT t.name FROM team_memberships tm JOIN teams t ON t.id = tm.team_id AND t.kind = 'team'
               WHERE tm.person_id = p.id ORDER BY t.name) tm2) AS teams
       FROM skill_grants g JOIN persons p ON p.id = g.person_id AND p.is_former = 0
      ORDER BY p.first_name, p.last_name`,
  );
  return c.json({
    types: types.map((dt) => ({
      dutyTypeId: dt.id,
      name: dt.name,
      whoQualified: dt.whoQualified,
      people: rows
        .filter((r) => r.duty_type_id === dt.id)
        .map((r) => ({ personId: r.id, firstName: r.first_name, lastName: r.last_name, birthYear: r.birth_year, teams: r.teams })),
    })),
  });
});

qualificationRoutes.put("/admin/skill-grants/:personId/:dutyTypeId", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const personId = intParam(c, "personId");
  const type = await adminType(db, intParam(c, "dutyTypeId"));
  if (!(await first(db, "SELECT 1 AS ok FROM persons WHERE id = ? AND is_former = 0", personId))) throw notFound(t`This person does not exist.`);
  const added = await run(db, "INSERT OR IGNORE INTO skill_grants (person_id, duty_type_id, granted_by) VALUES (?, ?, ?)", personId, type.id, actor.personId);
  if (added.meta.changes) await audit(db, actor, "duties.grant", { personId, detail: { duty: type.name } });
  await syncAutoGroups(db);
  return c.json({ ok: true });
});

qualificationRoutes.delete("/admin/skill-grants/:personId/:dutyTypeId", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const personId = intParam(c, "personId");
  const dutyTypeId = intParam(c, "dutyTypeId");
  const removed = await run(c.env.DB, "DELETE FROM skill_grants WHERE person_id = ? AND duty_type_id = ?", personId, dutyTypeId);
  if (removed.meta.changes) {
    const duty = (await first<{ name: string }>(c.env.DB, "SELECT name FROM duty_types WHERE id = ?", dutyTypeId))?.name ?? null;
    await audit(c.env.DB, actor, "duties.ungrant", { personId, detail: { duty } });
  }
  await syncAutoGroups(c.env.DB);
  // Out of the group of the approved people: its open chat closes
  const groups = await all<{ id: number }>(c.env.DB, "SELECT id FROM teams WHERE auto_skill = ?", dutyTypeId);
  if (groups.length) c.executionCtx.waitUntil(revalidateChatAccess(c.env, { personIds: [personId], teamIds: groups.map((g) => g.id) }));
  return c.json({ ok: true });
});

// Admin: links ------------------------------------------------------------------------

qualificationRoutes.post("/admin/skill-links", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const { dutyTypeId } = parse(z.object({ dutyTypeId: z.number().int().positive() }), await readJson(c.req.raw));
  const type = await adminType(c.env.DB, dutyTypeId);
  const token = randomToken(24);
  const expiresAt = utcIso(Date.now() + GRANT_LINK_DAYS * 86_400_000);
  await run(
    c.env.DB,
    "INSERT INTO skill_grant_links (duty_type_id, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?)",
    type.id,
    await sha256Hex(token),
    actor.personId,
    expiresAt,
  );
  return c.json({ url: `${relyingParty(c.env, c.req.raw).origin}/freigabe#${token}`, expiresAt }, 201);
});

qualificationRoutes.get("/admin/skill-links", async (c) => {
  requireAdmin(requireActor(c));
  const links = await all<{ id: number; duty_type_id: number; created_at: string; expires_at: string; created_by: string | null }>(
    c.env.DB,
    `SELECT l.id, l.duty_type_id, l.created_at, l.expires_at, p.first_name AS created_by FROM skill_grant_links l LEFT JOIN persons p ON p.id = l.created_by
      WHERE l.revoked_at IS NULL AND l.expires_at > ? ORDER BY l.created_at DESC`,
    utcIso(),
  );
  return c.json({ links: links.map((l) => ({ id: l.id, dutyTypeId: l.duty_type_id, createdAt: l.created_at, expiresAt: l.expires_at, createdBy: l.created_by })) });
});

qualificationRoutes.delete("/admin/skill-links/:id", async (c) => {
  requireAdmin(requireActor(c));
  await run(c.env.DB, "UPDATE skill_grant_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", utcIso(), intParam(c, "id"));
  return c.json({ ok: true });
});

// Redeem a link (signed in) -------------------------------------------------------------

const tokenSchema = z.object({ token: z.string().regex(/^[\w-]{20,100}$/) });

async function validLink(db: D1Database, token: string, now = Date.now()) {
  const row = await first<{ id: number; duty_type_id: number; name: string; expires_at: string; revoked_at: string | null }>(
    db,
    `SELECT l.id, l.duty_type_id, dt.name, l.expires_at, l.revoked_at FROM skill_grant_links l JOIN duty_types dt ON dt.id = l.duty_type_id
      WHERE l.token_hash = ?`,
    await sha256Hex(token),
  );
  if (!row) throw badRequest(t`This link is invalid.`, "link_invalid");
  if (row.revoked_at) throw badRequest(t`This link has been withdrawn. Please ask for a new link.`, "link_revoked");
  if (Date.parse(row.expires_at) <= now) throw badRequest(t`This link has expired. Please ask for a new link.`, "link_expired");
  return row;
}

/** Who can be approved through the link: oneself and one's own children (where parents are in charge). */
qualificationRoutes.post("/skill-link/info", async (c) => {
  const { token } = parse(tokenSchema, await readJson(c.req.raw));
  const link = await validLink(c.env.DB, token);
  const actor = c.get("actor");
  if (!actor) return c.json({ dutyTypeId: link.duty_type_id, dutyType: link.name, expiresAt: link.expires_at, loggedIn: false, candidates: [] });
  const ids = [actor.personId, ...actor.children.map((ch) => ch.id)];
  const already = new Set(
    (
      await all<{ person_id: number }>(
        c.env.DB,
        "SELECT person_id FROM skill_grants WHERE duty_type_id = ? AND person_id IN (SELECT value FROM json_each(?))",
        link.duty_type_id,
        JSON.stringify(ids),
      )
    ).map((r) => r.person_id),
  );
  return c.json({
    dutyTypeId: link.duty_type_id,
    dutyType: link.name,
    expiresAt: link.expires_at,
    loggedIn: true,
    candidates: [
      { personId: actor.personId, name: `${actor.firstName}${actor.lastName ? ` ${actor.lastName}` : ""}`, self: true, already: already.has(actor.personId) },
      ...actor.children
        .filter((ch) => parentsInCharge(actor, ch.id))
        .map((ch) => ({ personId: ch.id, name: `${ch.firstName}${ch.lastName ? ` ${ch.lastName}` : ""}`, self: false, already: already.has(ch.id) })),
    ],
  });
});

qualificationRoutes.post("/skill-link/accept", async (c) => {
  const actor = requireActor(c);
  const { token, personId } = parse(tokenSchema.extend({ personId: z.number().int().positive() }), await readJson(c.req.raw));
  const link = await validLink(c.env.DB, token);
  // Children only where parents are involved in their team, as everywhere else
  if (personId !== actor.personId && !(actor.children.some((ch) => ch.id === personId) && parentsInCharge(actor, personId))) {
    throw badRequest(t`You can only enable yourself or one of your children.`, "not_allowed");
  }
  await run(c.env.DB, "INSERT OR IGNORE INTO skill_grants (person_id, duty_type_id, granted_by) VALUES (?, ?, ?)", personId, link.duty_type_id, actor.personId);
  await syncAutoGroups(c.env.DB);
  return c.json({ ok: true });
});

// List of a duty type taken by approved people from all teams --------------------------------

/** The type, if the actor may see its list: approved (oneself or a child), coaches and admins. */
async function listAccess(db: D1Database, actor: Actor, typeId: number) {
  const type = (await loadDutyTypes(db)).get(typeId);
  if (!type || !type.whoQualified || type.eventId != null) throw notFound(t`This list does not exist.`);
  const skills = await loadSkills(db, actor);
  const roles = qualifiedRoles(actor, skills, type.id);
  if (!roles.length && !actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  return { type, skills, roles };
}

/**
 * All upcoming games of all teams with a block of this type (e.g. youth home games that need a youth referee),
 * for the approved people, coaches and admins.
 */
qualificationRoutes.get("/duties/qualified/:typeId", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const { type, skills, roles } = await listAccess(db, actor, intParam(c, "typeId"));
  const today = `${todayLocal()}T00:00`;
  // Home games of age groups that need it get their blocks first
  const candidates = await all<{ id: number }>(
    db,
    `SELECT e.id FROM events e JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
      WHERE e.kind = 'game' AND e.is_home = 1 AND ${REQUIRED_DUTIES_SQL("t")} AND e.starts_at >= ? AND e.cancelled_at IS NULL`,
    today,
  );
  await ensureEventDuties(db, candidates.map((x) => x.id), today);
  const events = await all<EventRow>(
    db,
    `SELECT e.id, e.kind, e.starts_at, e.ends_at, e.is_home, e.home_team, e.guest_team, e.title, e.cancelled_at, e.duty_hidden, e.external_ref,
            l.name AS location_name, t.id AS team_id, t.name AS team_name
       FROM events e
       JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.starts_at >= ? AND e.cancelled_at IS NULL
        AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id AND ed.duty_type_id = ?)
      ORDER BY e.starts_at`,
    today,
    type.id,
  );
  const eventIds = events.map((e) => e.id);
  const { blocks, entries } = await loadBlocksAndEntries(db, eventIds);
  const now = nowLocal();
  return c.json({
    team: { teamId: qualifiedHub(type.id), teamName: type.name, canManage: actor.isAdmin, roles, own: true },
    games: events.map((e) => ({
      ...eventView(e, now),
      teamId: e.team_id,
      teamName: e.team_name,
      canManage: isCoachOf(actor, e.team_id!),
      hidden: false,
      blocks: blocks
        .filter((b) => b.event_id === e.id && b.duty_type_id === type.id && (b.slots > 0 || isCoachOf(actor, e.team_id!)))
        .map((b) => blockView(b, type, entries, actor, { team: null, skills, past: e.starts_at < now })),
    })),
  });
});

/** Everyone approved for the type, for “sign someone up” (coaches and admins). */
qualificationRoutes.get("/duties/qualified/:typeId/people", async (c) => {
  const actor = requireActor(c);
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const people = await all<{ id: number; name: string }>(
    c.env.DB,
    `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name FROM skill_grants g JOIN persons p ON p.id = g.person_id AND p.is_former = 0
      WHERE g.duty_type_id = ? ORDER BY 2`,
    intParam(c, "typeId"),
  );
  return c.json({ people: people.map((p) => ({ personId: p.id, name: p.name, childId: null, childName: null })) });
});

qualificationRoutes.get("/duties/qualified/:typeId/live", async (c) => {
  const actor = requireActor(c);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw badRequest(t`Expected a WebSocket connection.`);
  const { type } = await listAccess(c.env.DB, actor, intParam(c, "typeId"));
  return dutyHubStub(c.env, qualifiedHub(type.id)).fetch(new Request("https://duties.internal/connect", { headers: upgradeHeaders(c.req.raw) }));
});
