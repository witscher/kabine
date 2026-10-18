// Registry of the modules a club can switch on or off (administration → club, setup wizard).
//
// A module is one entry here plus its code. Switched off, its API paths answer 404 and its data does not
// appear. To add a module see docs/modules.md; what the registry drives:
//   - ClubModules, DEFAULT_MODULES and moduleOn (everywhere in worker and app)
//   - moduleOfPath: the API paths of a module, checked on every request (worker/app.ts)
//   - the switches in the app (src/pages/club-settings.tsx, texts in shared/module-texts.ts)
//   - test/modules.test.ts: every module has a switch text and a row in docs/modules.md

export interface ModuleDef {
  /** Key in the club profile (`modules.<id>`). Never rename it: clubs have it stored. */
  readonly id: string;
  /** State for a club that has not chosen yet. */
  readonly defaultOn: boolean;
  /** Needs this other module to be on. */
  readonly requires?: string;
  /** API paths that only exist while the module is on. */
  readonly paths: readonly RegExp[];
}

/** Paths that sit next to a module's routes but belong to the base (games entered by hand). */
const BASE_PATHS: readonly RegExp[] = [/^\/api\/duties\/(teams\/\d+\/games|games\/\d+)$/];

/** The first module whose path matches wins, so a module nested inside another's paths comes first. */
export const MODULES = [
  { id: "youthReferees", defaultOn: true, requires: "duties", paths: [/^\/api\/(duties\/referee|referee\/|admin\/referee)/] },
  { id: "duties", defaultOn: true, paths: [/^\/api\/(duties|duty-|admin\/duty-|profile\/duty-prefs)/] },
  { id: "carpools", defaultOn: true, paths: [/^\/api\/events\/\d+\/carpool/] },
  { id: "handball4all", defaultOn: true, paths: [/^\/api\/teams\/\d+\/games\//] },
  { id: "sms", defaultOn: false, paths: [/^\/api\/(admin\/sms|auth\/sms|me\/phone)/] },
] as const satisfies readonly ModuleDef[];

export type ModuleId = (typeof MODULES)[number]["id"];
export type ClubModules = Record<ModuleId, boolean>;

export const DEFAULT_MODULES = Object.fromEntries(MODULES.map((m) => [m.id, m.defaultOn])) as ClubModules;

/** Is the module on? A module that needs another one is off while that one is off. */
export function moduleOn(modules: ClubModules, id: ModuleId): boolean {
  const def: ModuleDef = MODULES.find((m) => m.id === id)!;
  return modules[id] && (!def.requires || moduleOn(modules, def.requires as ModuleId));
}

/** The module an API path belongs to, null for paths of the base. */
export function moduleOfPath(path: string): ModuleId | null {
  if (BASE_PATHS.some((re) => re.test(path))) return null;
  return MODULES.find((m) => m.paths.some((re) => re.test(path)))?.id ?? null;
}
