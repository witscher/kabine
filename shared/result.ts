// Outcome of a game from the own team's view, for the word and the mascot face next to the result (src/result.tsx,
// docs/dev/decisions.md, "Results in the event list"). A close loss is up to 4 goals, a clear loss 5 or more.
// The names match the mascot's face slots (MASCOT_SLOTS in shared/module-api.ts).
export type Outcome = "win" | "draw" | "close" | "clear";

/** null without a known side (home or away): then only the score. */
export function outcome(home: number, guest: number, isHome: boolean | null): Outcome | null {
  if (isHome == null) return null;
  const diff = isHome ? home - guest : guest - home;
  return diff > 0 ? "win" : diff === 0 ? "draw" : diff > -5 ? "close" : "clear";
}

/** Age (by birth year in the club's year) below which results show the mascot face. */
export const YOUNG_AGE = 14;

/** Under YOUNG_AGE by birth year; without a birth year (parents, coaches) not. */
export function isYoung(birthYear: number | null, year: number): boolean {
  return birthYear != null && year - birthYear < YOUNG_AGE;
}
