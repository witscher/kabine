// Registry of the sport profiles (one file each in sports/). Types and helpers: shared/sport-api.ts.
import { SPORT_LIST } from "../sports";
import type { SportProfile, VenueKind } from "./sport-api";

export * from "./sport-api";
export { SPORT_LIST };

export type SportId = (typeof SPORT_LIST)[number]["id"];

/** Ids for validation, e.g. z.enum(SPORT_IDS). */
export const SPORT_IDS = SPORT_LIST.map((s) => s.id) as [SportId, ...SportId[]];

export const SPORTS = Object.fromEntries(SPORT_LIST.map((s): [SportId, SportProfile] => [s.id, s])) as Record<SportId, SportProfile>;

/**
 * Where the club's sport is played, for texts that name the place: select(venue, { hall: …, pitch: …, other: … }).
 * "venue" falls through to `other`, the neutral wording.
 */
export function venueOf(sport: string): VenueKind {
  return SPORTS[sport as SportId]?.venue ?? "venue";
}
