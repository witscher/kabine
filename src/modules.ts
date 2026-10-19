// The app parts of all modules (modules/<id>/app/index.tsx), found by the build: adding a folder is enough.
import type { ModuleId } from "../shared/modules";
import { useClub } from "./club";
import { moduleOn } from "../shared/club";
import type { AppModule } from "./module-api";

const found = import.meta.glob<{ default: AppModule }>("../modules/*/app/index.tsx", { eager: true });

export const APP_MODULES: readonly AppModule[] = Object.keys(found)
  .sort()
  .map((path) => found[path]!.default);

/** App parts of the modules the club has switched on. */
export function useActiveModules(): AppModule[] {
  const club = useClub();
  return APP_MODULES.filter((m) => moduleOn(club, m.manifest.id as ModuleId));
}
