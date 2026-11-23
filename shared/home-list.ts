// Order of the event list on home (src/pages/home.tsx). Items are events or rows a module adds later (they only need a
// start and an id), sorted together by time.

export interface ListItemTime {
  startsAt: string;
  id: number;
}

/** By start, then id (stable for events at the same time). */
export function byStartTime<T extends ListItemTime>(items: T[]): T[] {
  return [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
}

/**
 * The list under the large card in time order: whatever starts before the card (an unconfirmed optional training this
 * morning, a game one only follows) is shown above it, the rest below.
 */
export function splitAtCard<T extends ListItemTime>(items: T[], card: Pick<ListItemTime, "startsAt"> | undefined): { before: T[]; after: T[] } {
  const sorted = byStartTime(items);
  if (!card) return { before: [], after: sorted };
  return { before: sorted.filter((e) => e.startsAt < card.startsAt), after: sorted.filter((e) => e.startsAt >= card.startsAt) };
}
