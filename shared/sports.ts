// Registry of the sport profiles (one file each in sports/). Types and helpers: shared/sport-api.ts.
import { SPORT_LIST } from "../sports";
import type { SportProfile } from "./sport-api";

export * from "./sport-api";
export { SPORT_LIST };

export type SportId = (typeof SPORT_LIST)[number]["id"];

/** Ids for validation, e.g. z.enum(SPORT_IDS). */
export const SPORT_IDS = SPORT_LIST.map((s) => s.id) as [SportId, ...SportId[]];

export const SPORTS = Object.fromEntries(SPORT_LIST.map((s): [SportId, SportProfile] => [s.id, s])) as Record<SportId, SportProfile>;
