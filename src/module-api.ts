// The app side of a module (modules/<id>/app/index.tsx): pages and the places in the core screens where
// it shows something. Guide: docs/modules.md. Nothing of a module shows while it is switched off.
import type { ComponentType } from "preact";
import type { ModuleManifest } from "../shared/module-api";
import type { EventDetail, EventSummary } from "../shared/types";

export interface AppModule {
  manifest: ModuleManifest;
  /** Own pages, e.g. `{ path: "/fahrgemeinschaften", page: lazyPage(() => import("./page")) }`. */
  routes?: { path: string; page: ComponentType<Record<string, string>> }[];
  /** One line on event cards (home), from `event.modules[<id>]` (worker hook eventSummaries). */
  eventCardLine?: ComponentType<{ event: EventSummary; data: unknown }>;
  /** A section on the event page, from `event.modules[<id>]` (worker hook eventDetail). */
  eventSection?: ComponentType<{ event: EventDetail; data: unknown; reload: () => void }>;
}

export function defineAppModule(module: AppModule): AppModule {
  return module;
}
