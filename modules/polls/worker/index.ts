// Worker part of the polls module: API, hourly voter sync and reminders, the number on the app icon, cleanup.
import { stmt } from "../../../worker/lib/db";
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { pollBadgeCount, runPolls } from "./domain";
import { routes } from "./routes";

/** Every table of the module; children first is not needed, the foreign keys cascade from polls. */
const TABLES = ["polls", "poll_options", "poll_voters", "poll_ballots", "poll_answers", "poll_option_images", "poll_ignores"] as const;

export default defineWorkerModule({
  manifest,
  routes,
  cron: (env, now) => runPolls(env, now),
  badgeCount: (db, accountId, nowLocal) => pollBadgeCount(db, accountId, nowLocal),
  // Someone leaves the club: no longer a voter of running polls, ignores gone; given votes stay with their unit
  personLeaves: (db, personId, nowLocal) => [
    stmt(db, "DELETE FROM poll_voters WHERE person_id = ? AND poll_id IN (SELECT id FROM polls WHERE closed_at IS NULL AND ends_at > ?)", personId, nowLocal),
    stmt(db, "DELETE FROM poll_ignores WHERE person_id = ?", personId),
  ],
  // Polls belong to a season: gone with it (README, privacy)
  seasonChange: (db) => [stmt(db, "DELETE FROM polls")],
  // Short-lived, gone at the season change; their ids would need a mapping on restore
  exportExcluded: TABLES,
});
