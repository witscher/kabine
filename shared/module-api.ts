// What a module declares about itself (modules/<id>/module.ts). Pure data, shared by worker and app.
// The worker part (modules/<id>/worker/, worker/module-api.ts) and the app part
// (modules/<id>/app/, src/module-api.ts) build on it. Guide: docs/dev/modules.md.
import type { SportId } from "./sports";

export type ModuleKind =
  /** A function of the app (helper duties, carpools). */
  | "feature"
  /** Game schedules from an association's system (handball4all). */
  | "fixtures"
  /** A service outside Cloudflare the club signs up for (SMS). */
  | "provider";

/** What a module stores about people, for the privacy page of every installation. */
export interface ModulePrivacy {
  /** Which personal data, e.g. "Who offers seats, how many, who rides with whom." */
  stores: string;
  /** Who sees it, e.g. "The players of the game, their parents and the coaches." */
  visibleTo: string;
  /** When it is deleted, e.g. "With the event, at the latest at the season change." */
  deleted: string;
}

export interface ModuleManifest {
  /** Key in the club profile (`modules.<id>`), camelCase. Never rename it: clubs have it stored. */
  readonly id: string;
  readonly kind: ModuleKind;
  /** "beta": off by default and marked in the settings until the maintainers call it stable. */
  readonly status: "stable" | "beta";
  /** State for a club that has not chosen yet (beta modules: false). */
  readonly defaultOn: boolean;
  /** Name of the outside system it talks to (kinds "fixtures" and "provider"), e.g. "handball4all". */
  readonly vendor?: string;
  /** Needs this other module to be on. */
  readonly requires?: string;
  /** Only offered to clubs of these sports (shared/sports.ts); missing: every sport. */
  readonly sports?: readonly SportId[];
  /** API paths of its routes; they answer 404 while the module is off. Needed when the module has routes. */
  readonly paths?: readonly RegExp[];
  /** Name of the switch in administration. */
  label(): string;
  /** One or two sentences under the switch: what it does and for whom. */
  description(): string;
  /** null: the module stores no personal data. */
  privacy(): ModulePrivacy | null;
  /** Topics people can switch off under Profile → Notifications (ids are stored, never rename). */
  readonly notificationTopics?: readonly {
    readonly id: string;
    label(): string;
    /** Only for the account's own person, not per child (e.g. games of teams the account follows). */
    readonly self?: boolean;
  }[];
}

/**
 * Slots for pictures of the club's mascot (worker hook `mascot`): the faces next to a game's result (win, draw, close
 * loss, clear loss) and the large card and small tiles of the home game day. Stored by slot name: never rename one.
 */
export const MASCOT_SLOTS = ["win", "draw", "close", "clear", "card", "head"] as const;
export type MascotSlot = (typeof MASCOT_SLOTS)[number];
/** Picture URLs by slot; a slot without a picture is missing. */
export type MascotImages = Partial<Record<MascotSlot, string>>;

/** Declares a module; keeps the literal types (the id becomes part of ModuleId). */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
