// The worker parts of all modules (modules/<id>/worker/index.ts), found by the build: adding a folder is enough.
import type { ModuleId } from "../shared/modules";
import { isModuleOn } from "./domain/club";
import type { CalendarItem } from "./domain/calendar";
import type { Actor } from "./auth/actor";
import type { CalendarFeed, EventChange, EventPageQuery, WorkerModule } from "./module-api";

const found = import.meta.glob<{ default: WorkerModule }>("../modules/*/worker/index.ts", { eager: true });

/** Every module with a worker part, on or off (cleanup hooks, export tables). */
export const WORKER_MODULES: readonly WorkerModule[] = Object.keys(found)
  .sort()
  .map((path) => found[path]!.default);

/** Modules switched on for this club (set per request and cron run by enterClubContext). */
export function activeWorkerModules(): WorkerModule[] {
  return WORKER_MODULES.filter((m) => isModuleOn(m.manifest.id as ModuleId));
}

/** Extra data of the active modules per event, for event lists: Map<eventId, { [moduleId]: data }>. */
export async function moduleEventSummaries(...args: Parameters<NonNullable<WorkerModule["eventSummaries"]>>): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map<number, Record<string, unknown>>();
  const parts = await Promise.all(
    activeWorkerModules()
      .filter((m) => m.eventSummaries)
      .map(async (m) => [m.manifest.id, await m.eventSummaries!(...args)] as const),
  );
  for (const [id, data] of parts) {
    for (const [eventId, value] of data) {
      if (value == null) continue;
      out.set(eventId, { ...out.get(eventId), [id]: value });
    }
  }
  return out;
}

/** Extra data of the active modules for one event page. */
export async function moduleEventDetail(...args: Parameters<NonNullable<WorkerModule["eventDetail"]>>): Promise<Record<string, unknown>> {
  const parts = await Promise.all(
    activeWorkerModules()
      .filter((m) => m.eventDetail)
      .map(async (m) => [m.manifest.id, await m.eventDetail!(...args)] as const),
  );
  return Object.fromEntries(parts.filter(([, v]) => v != null));
}

export async function moduleParticipantsLeft(...args: Parameters<NonNullable<WorkerModule["participantsLeft"]>>): Promise<void> {
  if (!args[1].personIds.length) return;
  await Promise.all(activeWorkerModules().map((m) => m.participantsLeft?.(...args)));
}

export function moduleParticipantsDropped(...args: Parameters<NonNullable<WorkerModule["participantsDropped"]>>): D1PreparedStatement[] {
  return WORKER_MODULES.flatMap((m) => m.participantsDropped?.(...args) ?? []);
}

export function modulePersonLeaves(...args: Parameters<NonNullable<WorkerModule["personLeaves"]>>): D1PreparedStatement[] {
  return WORKER_MODULES.flatMap((m) => m.personLeaves?.(...args) ?? []);
}

export const MODULE_EXPORT_TABLES: readonly string[] = WORKER_MODULES.flatMap((m) => m.exportTables ?? []);

export const MODULE_EXPORT_EXCLUDED: readonly string[] = WORKER_MODULES.flatMap((m) => m.exportExcluded ?? []);

/** Cleanup of every module when a new season starts (also of switched-off ones: their data may still exist). */
export function moduleSeasonChange(db: D1Database): D1PreparedStatement[] {
  return WORKER_MODULES.flatMap((m) => m.seasonChange?.(db) ?? []);
}

/** What the active modules count for the app icon of this account. */
export async function moduleBadgeCount(db: D1Database, accountId: number, nowLocal: string): Promise<number> {
  const counts = await Promise.all(activeWorkerModules().map((m) => m.badgeCount?.(db, accountId, nowLocal) ?? 0));
  return counts.reduce((sum, n) => sum + n, 0);
}

/** Data of the active modules for a page of the event overview; params by module id. */
export async function moduleEventPage(
  db: D1Database,
  actor: Parameters<NonNullable<WorkerModule["eventPage"]>>[1],
  query: Omit<EventPageQuery, "params">,
  params: Record<string, Record<string, string>>,
): Promise<Record<string, unknown>> {
  const parts = await Promise.all(
    activeWorkerModules()
      .filter((m) => m.eventPage)
      .map(async (m) => [m.manifest.id, await m.eventPage!(db, actor, { ...query, params: params[m.manifest.id] ?? {} })] as const),
  );
  return Object.fromEntries(parts.filter(([, v]) => v != null));
}

/** An event was cancelled, restored or moved: the active modules may tell others (fans). */
export async function moduleEventChanged(env: Env, change: EventChange): Promise<void> {
  await Promise.all(activeWorkerModules().map((m) => m.eventChanged?.(env, change)));
}

/** Entries of the active modules for a personal calendar feed. */
export async function moduleCalendarItems(db: D1Database, feed: CalendarFeed): Promise<CalendarItem[]> {
  return (await Promise.all(activeWorkerModules().map((m) => m.calendarItems?.(db, feed) ?? []))).flat();
}

/** Teams the account follows through an active module (fans), without its own; empty while no such module is on. */
export async function moduleFollowedTeams(db: D1Database, actor: Actor): Promise<number[]> {
  const parts = await Promise.all(activeWorkerModules().map((m) => m.follows?.teams(db, actor) ?? []));
  return [...new Set(parts.flat())];
}

/** Accounts following any of these teams through an active module, one row per account and team. */
export async function moduleFollowers(db: D1Database, teamIds: number[]): Promise<{ accountId: number; teamId: number }[]> {
  if (!teamIds.length) return [];
  return (await Promise.all(activeWorkerModules().map((m) => m.follows?.accounts(db, teamIds) ?? []))).flat();
}
