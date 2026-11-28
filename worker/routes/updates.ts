// Administration → Updates and maintenance: installed version, the last update with its restore point
// (written by scripts/deploy.mjs), the maintenance switch (KV, worker/lib/maintenance.ts) and the break-glass uses
// of `npm run admin:link` (scripts/admin-link-sql.mjs), so every admin sees when it was used. Also the newest
// release from kabine.dev and the switch for that daily check (worker/domain/releases.ts).
import { Hono } from "hono";
import { z } from "zod";
import { KABINE_VERSION } from "../../shared/changelog";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { updateInProgress } from "../domain/club";
import { loadUpdateNotice, setUpdateCheck } from "../domain/releases";
import { currentLocale } from "../i18n";
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
  /** The club's copy on GitHub as the deploy found it ("owner/name"), if it did */
  repo?: string | null;
}

updateRoutes.get("/admin/updates", async (c) => {
  requireAdmin(requireActor(c));
  const rows = await all<{ key: string; value: string }>(c.env.DB, "SELECT key, value FROM app_meta WHERE key IN ('last_update', 'break_glass')");
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const notice = await loadUpdateNotice(c.env.DB, currentLocale());
  const last = parsed<LastUpdate>(value("last_update"));
  return c.json({
    version: KABINE_VERSION,
    lastUpdate: last && { at: last.at, version: last.version, migrations: last.migrations, bookmark: last.bookmark },
    // Newest release (null: up to date, check off or nothing fetched yet), the daily check and the club's copy
    available: notice.update,
    check: { on: !notice.check.off, fetchedAt: notice.check.fetchedAt, latest: notice.check.feed?.latest.version ?? null },
    repo: notice.repo,
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

/** The daily check for new versions on kabine.dev (on by default). Off: nothing is fetched, no hint, no push. */
updateRoutes.put("/admin/update-check", async (c) => {
  requireAdmin(requireActor(c));
  const { on } = parse(z.object({ on: z.boolean() }), await readJson(c.req.raw));
  await setUpdateCheck(c.env.DB, on);
  return c.json({ on });
});
