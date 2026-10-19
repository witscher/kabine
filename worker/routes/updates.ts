// Administration → Updates and maintenance: installed version, the last update with its restore point
// (written by scripts/deploy.mjs) and the maintenance switch (KV, worker/lib/maintenance.ts).
import { Hono } from "hono";
import { z } from "zod";
import { KABINE_VERSION } from "../../shared/changelog";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { updateInProgress } from "../domain/club";
import { first } from "../lib/db";
import { parse, readJson } from "../lib/http";
import { MAINTENANCE_KEY, maintenanceState } from "../lib/maintenance";

export const updateRoutes = new Hono<AppEnv>();

interface LastUpdate {
  at: string;
  version: string;
  migrations: string[];
  bookmark: string | null;
}

updateRoutes.get("/admin/updates", async (c) => {
  requireAdmin(requireActor(c));
  const row = await first<{ value: string }>(c.env.DB, "SELECT value FROM app_meta WHERE key = 'last_update'");
  let lastUpdate: LastUpdate | null = null;
  try {
    lastUpdate = row ? (JSON.parse(row.value) as LastUpdate) : null;
  } catch {
    lastUpdate = null;
  }
  return c.json({
    version: KABINE_VERSION,
    lastUpdate,
    maintenance: await maintenanceState(c.env.KV),
    updating: updateInProgress(),
  });
});

updateRoutes.put("/admin/maintenance", async (c) => {
  requireAdmin(requireActor(c));
  const { on } = parse(z.object({ on: z.boolean() }), await readJson(c.req.raw));
  if (on) await c.env.KV.put(MAINTENANCE_KEY, JSON.stringify({ since: new Date().toISOString() }));
  else await c.env.KV.delete(MAINTENANCE_KEY);
  return c.json({ maintenance: on });
});
