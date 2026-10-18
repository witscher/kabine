// What is new for an admin since they last looked: release notes of newer Kabine versions
// (shared/changelog.ts) and modules they were not told about yet. Seen per admin account; a new admin
// starts with everything seen, so only later updates and modules count as news.
import { CHANGELOG, entriesSince, KABINE_VERSION } from "../../shared/changelog";
import type { ModuleManifest } from "../../shared/module-api";
import { MODULES } from "../../shared/modules";
import type { AdminNews } from "../../shared/types";
import { first, run } from "../lib/db";

/** Modules offered to a club of this sport (the others are not shown in the settings either). */
const offered = (sport: string) => (MODULES as readonly ModuleManifest[]).filter((m) => !m.sports || m.sports.includes(sport as never));

export async function adminNews(db: D1Database, accountId: number, sport: string): Promise<AdminNews | null> {
  const row = await first<{ changelog_seen: string | null; modules_seen: string | null }>(
    db,
    "SELECT changelog_seen, modules_seen FROM accounts WHERE id = ?",
    accountId,
  );
  if (!row) return null;
  if (row.changelog_seen == null || row.modules_seen == null) {
    await markNewsSeen(db, accountId);
    return null;
  }
  const seenModules = new Set(JSON.parse(row.modules_seen) as string[]);
  const entries = entriesSince(row.changelog_seen).map((e) => ({ version: e.version, date: e.date, items: e.items() }));
  const newModules = offered(sport)
    .filter((m) => !seenModules.has(m.id))
    .map((m) => ({ id: m.id, label: m.label(), description: m.description(), beta: m.status === "beta" }));
  if (!entries.length && !newModules.length) return null;
  return { version: KABINE_VERSION, entries, newModules };
}

/** Everything up to now counts as seen: the installed version and all modules there are. */
export async function markNewsSeen(db: D1Database, accountId: number): Promise<void> {
  await run(
    db,
    "UPDATE accounts SET changelog_seen = ?, modules_seen = ? WHERE id = ?",
    KABINE_VERSION,
    JSON.stringify(MODULES.map((m) => m.id)),
    accountId,
  );
}



/** The admin has looked at the module switches: no module counts as new any more (release notes stay). */
export async function markModulesSeen(db: D1Database, accountId: number): Promise<void> {
  await run(db, "UPDATE accounts SET modules_seen = ? WHERE id = ?", JSON.stringify(MODULES.map((m) => m.id)), accountId);
}
