// The app side of a module (modules/<id>/app/index.tsx): pages and the places in the core screens where
// it shows something. Guide: docs/dev/modules.md. Nothing of a module shows while it is switched off.
import type { ComponentType } from "preact";
import type { IconName } from "./icons";
import type { ImportAssist } from "../shared/list-import";
import type { ModuleManifest } from "../shared/module-api";
import type { EventDetail, EventSummary, Me } from "../shared/types";

export interface AppModule {
  manifest: ModuleManifest;
  /** Own pages, e.g. `{ path: "/verwaltung/sms", page: lazyPage(() => import("./settings").then((m) => m.Page)) }`. */
  routes?: { path: string; page: ComponentType<any> }[];
  /** A tab in the bottom navigation, after Events and Chat; null when the person has nothing there. */
  tab?: (me: Me) => { href: string; label: string; icon: IconName; match: (path: string) => boolean } | null;
  /** Entries in Administration (admins only), e.g. the module's settings page. */
  adminMenu?: () => { href: string; icon: IconName; title: string; sub: string }[];
  /** One line on event cards (home), from `event.modules[<id>]` (worker hook eventSummaries). */
  eventCardLine?: ComponentType<{ event: EventSummary; data: unknown }>;
  /**
   * Links for a game of a fixture module (live ticker while it is played, report afterwards), on the
   * "In progress" card and the event page. Show nothing for games of other sources (`event.game.source`).
   */
  gameLinks?: ComponentType<{ event: EventSummary; phase: "live" | "after" }>;
  /** A section on the event page, from `event.modules[<id>]` (worker hook eventDetail). */
  eventSection?: ComponentType<{ event: EventDetail; data: unknown; reload: () => void }>;
  /** Help for the list import of the setup wizard (src/list-import.tsx), offered as buttons the admin taps. */
  listImport?: ImportAssist & {
    /** What leaves the browser and where to, shown next to the buttons */
    notice: () => string;
  };
}

export function defineAppModule(module: AppModule): AppModule {
  return module;
}
