// KiHaSL/JuHaSL: grant the role (admin directly or through a link) and redeem the link.
// The link only gives the role to persons who are already in the app (signed in: oneself
// or one's own child). See docs/design.md, Youth referees (KiHaSL/JuHaSL).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { parentsInCharge, requireAdmin } from "../auth/actor";
import { syncAutoGroups } from "../domain/groups";
import { relyingParty } from "../auth/webauthn";
import { randomToken, sha256Hex } from "../lib/crypto";
import { all, first, run } from "../lib/db";
import { badRequest, notFound, parse, readJson } from "../lib/http";
import { utcIso } from "../lib/time";

export const refereeRoutes = new Hono<AppEnv>();

export const REFEREE_LINK_DAYS = 30;

const tokenSchema = z.object({ token: z.string().regex(/^[\w-]{20,100}$/) });

async function validLink(db: D1Database, token: string, now = Date.now()) {
  const row = await first<{ id: number; expires_at: string; revoked_at: string | null }>(
    db,
    "SELECT id, expires_at, revoked_at FROM referee_links WHERE token_hash = ?",
    await sha256Hex(token),
  );
  if (!row) throw badRequest(t`This link is invalid.`, "link_invalid");
  if (row.revoked_at) throw badRequest(t`This link has been withdrawn. Please ask for a new link.`, "link_revoked");
  if (Date.parse(row.expires_at) <= now) throw badRequest(t`This link has expired. Please ask for a new link.`, "link_expired");
  return row;
}

// Admin: Links -----------------------------------------------------------------

refereeRoutes.post("/admin/referee-links", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const token = randomToken(24);
  const expiresAt = utcIso(Date.now() + REFEREE_LINK_DAYS * 86_400_000);
  await run(c.env.DB, "INSERT INTO referee_links (token_hash, created_by, expires_at) VALUES (?, ?, ?)", await sha256Hex(token), actor.personId, expiresAt);
  return c.json({ url: `${relyingParty(c.env, c.req.raw).origin}/kihasl#${token}`, expiresAt }, 201);
});

refereeRoutes.get("/admin/referee-links", async (c) => {
  requireAdmin(requireActor(c));
  const links = await all<{ id: number; created_at: string; expires_at: string; created_by: string | null }>(
    c.env.DB,
    `SELECT l.id, l.created_at, l.expires_at, p.first_name AS created_by FROM referee_links l LEFT JOIN persons p ON p.id = l.created_by
      WHERE l.revoked_at IS NULL AND l.expires_at > ? ORDER BY l.created_at DESC`,
    utcIso(),
  );
  return c.json({ links: links.map((l) => ({ id: l.id, createdAt: l.created_at, expiresAt: l.expires_at, createdBy: l.created_by })) });
});

refereeRoutes.delete("/admin/referee-links/:id", async (c) => {
  requireAdmin(requireActor(c));
  await run(c.env.DB, "UPDATE referee_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", utcIso(), intParam(c, "id"));
  return c.json({ ok: true });
});

// Admin: persons with the role ---------------------------------------------------

refereeRoutes.get("/admin/referees", async (c) => {
  requireAdmin(requireActor(c));
  const rows = await all<{ id: number; first_name: string; last_name: string | null; birth_year: number | null; teams: string | null }>(
    c.env.DB,
    `SELECT p.id, p.first_name, p.last_name, p.birth_year,
            (SELECT group_concat(t.name, ', ') FROM team_memberships tm JOIN teams t ON t.id = tm.team_id AND t.kind = 'team' WHERE tm.person_id = p.id) AS teams
       FROM referees r JOIN persons p ON p.id = r.person_id AND p.is_former = 0
      ORDER BY p.first_name, p.last_name`,
  );
  return c.json({
    referees: rows.map((r) => ({ personId: r.id, firstName: r.first_name, lastName: r.last_name, birthYear: r.birth_year, teams: r.teams })),
  });
});

refereeRoutes.put("/admin/referees/:personId", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const personId = intParam(c, "personId");
  const person = await first(c.env.DB, "SELECT 1 AS ok FROM persons WHERE id = ? AND is_former = 0", personId);
  if (!person) throw notFound(t`This person does not exist.`);
  await run(c.env.DB, "INSERT OR IGNORE INTO referees (person_id, added_by) VALUES (?, ?)", personId, actor.personId);
  await syncAutoGroups(c.env.DB);
  return c.json({ ok: true });
});

refereeRoutes.delete("/admin/referees/:personId", async (c) => {
  requireAdmin(requireActor(c));
  await run(c.env.DB, "DELETE FROM referees WHERE person_id = ?", intParam(c, "personId"));
  await syncAutoGroups(c.env.DB);
  return c.json({ ok: true });
});

// Full club members (hidden flag, admins only) --------------------------------------

refereeRoutes.put("/admin/club-members/:personId", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const personId = intParam(c, "personId");
  if (!(await first(c.env.DB, "SELECT 1 AS ok FROM persons WHERE id = ? AND is_former = 0", personId))) throw notFound(t`This person does not exist.`);
  await run(c.env.DB, "INSERT OR IGNORE INTO club_members (person_id, added_by) VALUES (?, ?)", personId, actor.personId);
  return c.json({ ok: true });
});

refereeRoutes.delete("/admin/club-members/:personId", async (c) => {
  requireAdmin(requireActor(c));
  await run(c.env.DB, "DELETE FROM club_members WHERE person_id = ?", intParam(c, "personId"));
  return c.json({ ok: true });
});

// Redeem the link (signed in) ------------------------------------------------------

/** Who can be enabled through the link: oneself and one's own children. */
refereeRoutes.post("/referee/info", async (c) => {
  const { token } = parse(tokenSchema, await readJson(c.req.raw));
  const link = await validLink(c.env.DB, token);
  const actor = c.get("actor");
  if (!actor) return c.json({ expiresAt: link.expires_at, loggedIn: false, candidates: [] });
  const ids = [actor.personId, ...actor.children.map((ch) => ch.id)];
  const already = new Set(
    (await all<{ person_id: number }>(c.env.DB, "SELECT person_id FROM referees WHERE person_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids))).map(
      (r) => r.person_id,
    ),
  );
  return c.json({
    expiresAt: link.expires_at,
    loggedIn: true,
    candidates: [
      { personId: actor.personId, name: `${actor.firstName}${actor.lastName ? ` ${actor.lastName}` : ""}`, self: true, already: already.has(actor.personId) },
      ...actor.children.filter((ch) => parentsInCharge(actor, ch.id)).map((ch) => ({
        personId: ch.id,
        name: `${ch.firstName}${ch.lastName ? ` ${ch.lastName}` : ""}`,
        self: false,
        already: already.has(ch.id),
      })),
    ],
  });
});

refereeRoutes.post("/referee/accept", async (c) => {
  const actor = requireActor(c);
  const { token, personId } = parse(tokenSchema.extend({ personId: z.number().int().positive() }), await readJson(c.req.raw));
  await validLink(c.env.DB, token);
  // Children only where parents are involved in their team, as everywhere else
  if (personId !== actor.personId && !(actor.children.some((ch) => ch.id === personId) && parentsInCharge(actor, personId))) {
    throw badRequest(t`You can only enable yourself or one of your children.`, "not_allowed");
  }
  await run(c.env.DB, "INSERT OR IGNORE INTO referees (person_id, added_by) VALUES (?, ?)", personId, actor.personId);
  await syncAutoGroups(c.env.DB);
  return c.json({ ok: true });
});
