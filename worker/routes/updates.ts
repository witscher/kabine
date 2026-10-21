// Administration → Updates and maintenance: installed version, the last update with its restore point
// (written by scripts/deploy.mjs), the maintenance switch (KV, worker/lib/maintenance.ts) and the break-glass uses
// of `npm run admin:link` (scripts/admin-link-sql.mjs), so every admin sees when it was used.
import { Hono } from "hono";
import { z } from "zod";
import { KABINE_VERSION } from "../../shared/changelog";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { updateInProgress } from "../domain/club";
import { all } from "../lib/db";
import { parse, readJson } from "../lib/http";
import { MAINTENANCE_KEY, maintenanceState } from "../lib/maintenance";

export const updateRoutes = new Hono<AppEnv>();

interface BreakGlass {
  at: string;
  email: string;
  owner: boolean;
  revoked: string[];
}

const parsed = <T>(value: string | undefined): T | null => {
  try {
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
};

interface LastUpdate {
  at: string;
  version: string;
  migrations: string[];
  bookmark: string | null;
}

updateRoutes.get("/admin/updates", async (c) => {
  requireAdmin(requireActor(c));
  const rows = await all<{ key: string; value: string }>(c.env.DB, "SELECT key, value FROM app_meta WHERE key IN ('last_update', 'break_glass')");
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return c.json({
    version: KABINE_VERSION,
    lastUpdate: parsed<LastUpdate>(value("last_update")),
    breakGlass: parsed<BreakGlass[]>(value("break_glass")) ?? [],
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
