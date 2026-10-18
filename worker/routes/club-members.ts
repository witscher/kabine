// "Full club member" marker of adults (hidden, admins only): who may organise events and take certain
// duties. Part of the core, not of a module.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { type AppEnv, intParam, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { first, run } from "../lib/db";
import { notFound } from "../lib/http";

export const clubMemberRoutes = new Hono<AppEnv>();

clubMemberRoutes.put("/admin/club-members/:personId", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const personId = intParam(c, "personId");
  if (!(await first(c.env.DB, "SELECT 1 AS ok FROM persons WHERE id = ? AND is_former = 0", personId))) throw notFound(t`This person does not exist.`);
  await run(c.env.DB, "INSERT OR IGNORE INTO club_members (person_id, added_by) VALUES (?, ?)", personId, actor.personId);
  return c.json({ ok: true });
});

clubMemberRoutes.delete("/admin/club-members/:personId", async (c) => {
  requireAdmin(requireActor(c));
  await run(c.env.DB, "DELETE FROM club_members WHERE person_id = ?", intParam(c, "personId"));
  return c.json({ ok: true });
});
