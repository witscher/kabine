// What the rest of Kabine knows about modules, derived from the manifests in modules/index.ts.
// A module is a folder modules/<id>/ (guide: docs/dev/modules.md); nothing here changes when one is added.
//   - ClubModules, DEFAULT_MODULES and moduleOn (everywhere in worker and app)
//   - moduleOfPath: the API paths of a module, checked on every request (worker/app.ts)
import { MODULES } from "../modules";
import type { ModuleManifest } from "./module-api";

export { MODULES };
export type ModuleId = (typeof MODULES)[number]["id"];
export type ClubModules = Record<ModuleId, boolean>;

/** Paths that sit next to a module's routes but belong to the base (games entered by hand). */
const BASE_PATHS: readonly RegExp[] = [/^\/api\/duties\/(teams\/\d+\/games|games\/\d+)$/];

export const DEFAULT_MODULES = Object.fromEntries(MODULES.map((m) => [m.id, m.defaultOn])) as ClubModules;

export function moduleManifest(id: ModuleId): ModuleManifest {
  return MODULES.find((m) => m.id === id)!;
}

/** Is the module on? A module that needs another one is off while that one is off. */
export function moduleOn(modules: ClubModules, id: ModuleId): boolean {
  const def = moduleManifest(id);
  return modules[id] && (!def.requires || moduleOn(modules, def.requires as ModuleId));
}

/** The module an API path belongs to, null for paths of the base. The first matching module wins. */
export function moduleOfPath(path: string): ModuleId | null {
  if (BASE_PATHS.some((re) => re.test(path))) return null;
  return MODULES.find((m) => "paths" in m && m.paths.some((re) => re.test(path)))?.id ?? null;
}

/** Notification topics the modules add to the core ones (shared/types.ts). */
type TopicsOf<M> = M extends { notificationTopics: readonly (infer T)[] } ? (T extends { id: infer I } ? I : never) : never;
export type ModuleNotificationTopic = TopicsOf<(typeof MODULES)[number]>;

/** Topic ids of a module, for the notification settings. */
export function moduleTopics(id: ModuleId): string[] {
  return (moduleManifest(id).notificationTopics ?? []).map((t) => t.id);
}
