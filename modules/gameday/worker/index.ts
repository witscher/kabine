// Worker part of the home game day module: the page of the day and the settings (routes), the card and the later days
// in the event list on home (eventPage), the push the day before (cron).
import { defineWorkerModule } from "../../../worker/module-api";
import { stmt } from "../../../worker/lib/db";
import { addDays, todayLocal } from "../../../worker/lib/time";
import manifest from "../module";
import type { GamedayPage } from "../types";
import { homeData, sendGamedayNotice } from "./domain";
import { routes } from "./routes";

export default defineWorkerModule({
  manifest,
  routes,
  /** Upcoming list with games in it: the card of the next days and the later days in the page's window. */
  eventPage: async (db, actor, q): Promise<GamedayPage | null> => {
    if (q.past || (q.kinds && !q.kinds.includes("game"))) return null;
    const data = await homeData(db, actor, { to: q.to });
    return data ? { card: data.card, later: data.later, mascotVersion: data.settings.mascotVersion } : null;
  },
  cron: (env, now) => sendGamedayNotice(env, now),
  // Only the dates the push went out; deleted after a week anyway
  exportExcluded: ["gameday_sent"],
  seasonChange: (db) => [stmt(db, "DELETE FROM gameday_sent WHERE day < ?", addDays(todayLocal(), -7))],
});
