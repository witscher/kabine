// The worker parts of all modules (modules/<id>/worker/index.ts), found by the build: adding a folder is enough.
import type { ModuleId } from "../shared/modules";
import { isModuleOn } from "./domain/club";
import type { WorkerModule } from "./module-api";

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
