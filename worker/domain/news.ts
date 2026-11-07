// What is new for an admin or coach since they last looked: release notes of newer Kabine versions
// (shared/changelog.ts), for admins also the modules they were not told about yet. Coaches see only the
// coach notes. Seen per account; an account without a mark starts with everything seen, so a new club or a
// new coach gets no backlog, only later updates count as news.
import { type ChangelogEntry, entriesSince, KABINE_VERSION } from "../../shared/changelog";
import type { ModuleManifest } from "../../shared/module-api";
import { MODULES, moduleOffered } from "../../shared/modules";
import type { AdminNews } from "../../shared/types";
import { first, run } from "../lib/db";

/** Modules offered to a club of this sport (the others are not shown in the settings either). */
const offered = (sport: string) => (MODULES as readonly ModuleManifest[]).filter((m) => moduleOffered(m, sport));

/** Release notes for this reader: admins everything, coaches only versions with coach notes. */
export function newsEntries(entries: readonly ChangelogEntry[], admin: boolean): AdminNews["entries"] {
  return entries
    .map((e) => ({ version: e.version, date: e.date, items: admin ? e.items() : [], coachItems: e.coaches?.() ?? [] }))
    .filter((e) => e.items.length || e.coachItems.length);
}

export async function loadNews(db: D1Database, accountId: number, sport: string, admin: boolean): Promise<AdminNews | null> {
  const row = await first<{ changelog_seen: string | null; modules_seen: string | null }>(
    db,
    "SELECT changelog_seen, modules_seen FROM accounts WHERE id = ?",
    accountId,
  );
  if (!row) return null;
  // No mark yet (new account, or a coach who became admin): start with everything seen
  if (row.changelog_seen == null || (admin && row.modules_seen == null)) {
    await markNewsSeen(db, accountId);
    return null;
  }
  const seenModules = new Set(JSON.parse(row.modules_seen ?? "[]") as string[]);
  const entries = newsEntries(entriesSince(row.changelog_seen), admin);
  const newModules = !admin ? [] : offered(sport)
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
