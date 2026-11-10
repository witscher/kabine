// The app side of a module (modules/<id>/app/index.tsx): pages and the places in the core screens where
// it shows something. Guide: docs/dev/modules.md. Nothing of a module shows while it is switched off.
import type { ComponentType } from "preact";
import type { IconName } from "./icons";
import type { ModuleManifest } from "../shared/module-api";
import type { AuditEntry, EventDetail, EventSummary, Me, StatsRange, TeamStats } from "../shared/types";

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
  /**
   * A view of its own on a team's statistics page (coaches and admins), next to Training and Games, e.g. helper
   * duties per family. `shown` decides from the core figures whether the team has it.
   */
  teamStats?: { label: () => string; shown: (stats: TeamStats) => boolean; view: ComponentType<{ teamId: number; range: StatsRange }> };
  /** A card on "My statistics" per person and team (players, parents for a child), e.g. the family's helper duties. */
  myStats?: ComponentType<{ personId: number; self: boolean; teamId: number }>;
  /**
   * Sentences for the module's own entries in Administration → Protocol, by action code (e.g. "duties.grant",
   * written with `audit()` from worker/domain/audit.ts). `who`, `person` and `team` are already named.
   */
  auditTexts?: () => Record<string, (entry: AuditEntry, names: { who: string; person: string; team: string }) => string>;
}

export function defineAppModule(module: AppModule): AppModule {
  return module;
}
