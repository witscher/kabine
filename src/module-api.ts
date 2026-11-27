// The app side of a module (modules/<id>/app/index.tsx): pages and the places in the core screens where
// it shows something. Guide: docs/dev/modules.md. Nothing of a module shows while it is switched off.
import type { ComponentChildren, ComponentType } from "preact";
import type { IconName } from "./icons";
import type { ModuleManifest } from "../shared/module-api";
import type { AuditEntry, EventDetail, EventShow, EventSummary, GameRef, Me, StatsRange, TeamStats } from "../shared/types";

/**
 * A button in the row at the top of home. The own teams come first, buttons of modules after them (a star for the games
 * of teams one follows). Each switches its part of the list on and off; the list is the sum.
 */
export interface HomeListButton {
  key: string;
  label: ComponentChildren;
  ariaLabel?: string;
  class?: string;
  on: boolean;
  toggle: () => void;
}

/** A row of the list on home: an event, or a row of a module (it only needs a time to be sorted in, shared/home-list.ts). */
export interface HomeListRow {
  key: string;
  startsAt: string;
  /** The event's id for a row about an event (left out when the core lists that event itself), else 0. */
  id: number;
  node: ComponentChildren;
}

/** What a module gets to add its part to the list on home (hook homeList). */
export interface HomeListContext {
  me: Me;
  when: "upcoming" | "past";
  show: EventShow;
  /** The module's part of the selection kept on this device (localStorage, no personal data); undefined at first. */
  pick: unknown;
  setPick: (next: unknown) => void;
  /**
   * The module's data of the loaded page (worker hook eventPage); null when the page has none, undefined while no page
   * is loaded (the first call of a render, for buttons' state and query parameters, always has undefined).
   */
  data: unknown;
}

/**
 * A large card of a module on home (the home game day), in time order with the card of the next event: above it when
 * its day is on or before the day of that card (or there is none), below it otherwise.
 */
export interface HomeListCard {
  key: string;
  /** Day the card is about, YYYY-MM-DD. */
  day: string;
  node: ComponentChildren;
  /** Events the card already shows: rows of other modules about them are left out of the list (a game one follows). */
  covers?: number[];
}

/** A module's part of the list on home. */
export interface HomeListPart {
  /** Buttons after the team buttons. */
  buttons?: HomeListButton[];
  /**
   * Its part of the list is switched on, from the selection alone (also before data arrives): then "Nothing selected"
   * does not apply while all team buttons are off.
   */
  active?: boolean;
  /** Query parameters for the page (sent as `<module>.<key>`, read by the worker hook eventPage). */
  query?: Record<string, string>;
  /**
   * While set, the module shows a view of its own instead of the selection: the team buttons look off and the chips
   * are hidden; the core lists all its events of the kind `show`. Tapping a team button calls `release` (the earlier
   * selection comes back with that team on). `sub` is the line under the greeting.
   */
  takeover?: { show: EventShow; release: () => void; sub: string };
  /** A large card next to the card of the next event (upcoming only). */
  card?: HomeListCard;
  /** Rows to sort into the list (upcoming or past, as `when`). */
  rows?: HomeListRow[];
  /**
   * The module has more rows than it sent: the start of the last row it sent (whole days). The list stops there until
   * "More events" loads more, so nothing is missing in between.
   */
  more?: string;
  /** Words for the line under the greeting while its rows are shown, e.g. "games as a fan". */
  sub?: string;
}

export interface AppModule {
  manifest: ModuleManifest;
  /** Own pages, e.g. `{ path: "/verwaltung/sms", page: lazyPage(() => import("./settings").then((m) => m.Page)) }`. */
  routes?: { path: string; page: ComponentType<any> }[];
  /** A tab in the bottom navigation, after Events and Chat; null when the person has nothing there. */
  tab?: (me: Me) => { href: string; label: string; icon: IconName; match: (path: string) => boolean } | null;
  /** Entries in Administration (admins only), e.g. the module's settings page. */
  adminMenu?: () => { href: string; icon: IconName; title: string; sub: string }[];
  /** Entries on the profile page, e.g. the person's own polls; empty when the person has nothing there. */
  profileMenu?: (me: Me) => { href: string; icon: IconName; title: string; sub: string }[];
  /**
   * Cards at the very top of the start page, above everything else, for something that waits for the person (an open
   * poll). Render nothing when nothing waits.
   */
  homeCards?: ComponentType;
  /**
   * Marks the Events tab while something on the start page waits for the person: render the tab's `<span class="dot">`
   * with a screen reader text, or nothing.
   */
  eventsTabDot?: ComponentType;
  /** One line on event cards (home), from `event.modules[<id>]` (worker hook eventSummaries). */
  eventCardLine?: ComponentType<{ event: EventSummary; data: unknown }>;
  /**
   * Links for a game of a fixture module (live ticker while it is played, report afterwards), on the
   * "In progress" card, the event page and the page of a game one follows. Show nothing for games of other sources
   * (`event.game.source`).
   */
  gameLinks?: ComponentType<{ event: GameRef; phase: "live" | "after" }>;
  /**
   * Buttons and rows of its own in the event list on home (e.g. games of teams one follows), with data from the worker
   * hook eventPage. A plain function, called on every render: no hooks inside, components in `node` may use them.
   */
  homeList?: (ctx: HomeListContext) => HomeListPart | null;
  /** Rows (`<li>`) in Profile → My events, the personal calendar, saved by the module itself (worker hook calendarItems). */
  calendarOptions?: ComponentType;
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
