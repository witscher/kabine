// The app parts of all modules (modules/<id>/app/index.tsx), found by the build: adding a folder is enough.
import type { MascotSlot } from "../shared/module-api";
import type { ModuleId } from "../shared/modules";
import { useClub } from "./club";
import { mascotImage, moduleOn } from "../shared/club";
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

/**
 * URL of the club mascot's picture for a slot (result faces, home game day), from the club profile (worker hook
 * `mascot`); null while no module provides one or the slot is empty. Re-renders when the profile changes.
 */
export function useMascotImage(slot: MascotSlot): string | null {
  return mascotImage(useClub(), slot);
}
