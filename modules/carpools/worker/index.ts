// Worker part of the carpools module: API, chat reminders, summaries on event cards and the event page,
// cleanup when players drop out or leave the club.
import { stmt } from "../../../worker/lib/db";
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { loadCarpool, loadCarpoolCounts, releaseRequests, sendCarpoolChatReminders } from "./domain";
import { carpoolRoutes } from "./routes";

export default defineWorkerModule({
  manifest,
  routes: carpoolRoutes,
  cron: (env, now) => sendCarpoolChatReminders(env, now),
  eventSummaries: (db, actor, rows, ctx, now) => loadCarpoolCounts(db, actor, rows, ctx, now),
  eventDetail: (db, actor, event, ctx, now) => loadCarpool(db, actor, event, ctx, now),
  // Whoever declines or leaves the squad no longer looks for a ride
  participantsLeft: (env, { event, ctx, teamIds, personIds, exclude }) => releaseRequests(env, { event, ctx, teamIds }, personIds, exclude),
  participantsDropped: (db, { with: prefix, select, params }) => [
    stmt(db, `${prefix ?? ""} DELETE FROM carpool_requests WHERE (event_id, player_id) IN (${select})`, ...params),
  ],
  personLeaves: (db, personId, nowLocal) => [
    stmt(db, "DELETE FROM carpool_requests WHERE player_id = ? AND event_id IN (SELECT id FROM events WHERE starts_at > ?)", personId, nowLocal),
    stmt(db, "DELETE FROM carpool_offers WHERE person_id = ? AND event_id IN (SELECT id FROM events WHERE starts_at > ?)", personId, nowLocal),
  ],
  exportTables: ["carpool_offers", "carpool_requests"],
});
