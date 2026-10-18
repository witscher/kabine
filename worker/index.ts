import { createBaseApp } from "./app";
import { handleScheduled } from "./cron";
import type { PushJob } from "./domain/notify";
import { maintenanceState } from "./lib/maintenance";
import { handleQueue } from "./queue";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { avatarRoutes } from "./routes/avatars";
import { chatRoutes } from "./routes/chat";
import { clubRoutes } from "./routes/club";
import { calendarRoutes } from "./routes/calendar";
import { carpoolRoutes } from "./routes/carpool";
import { dutyRoutes } from "./routes/duties";
import { emailRoutes } from "./routes/email";
import { eventRoutes } from "./routes/events";
import { feedbackRoutes } from "./routes/feedback";
import { gameImportRoutes } from "./routes/game-import";
import { gameRoutes } from "./routes/games";
import { mailRoutes } from "./routes/mail";
import { smsRoutes } from "./routes/sms";
import { joinRoutes } from "./routes/join";
import { parentRoutes } from "./routes/parents";
import { personRoutes } from "./routes/persons";
import { planRoutes } from "./routes/plans";
import { pushRoutes } from "./routes/push";
import { refereeRoutes } from "./routes/referees";
import { seasonRoutes } from "./routes/season";
import { squadRoutes } from "./routes/squad";
import { teamRoutes } from "./routes/teams";

export { ChatRoom } from "./chat/room";
export { DutyHub } from "./duties/hub";

export const app = createBaseApp();
// env: "staging" makes the app show a banner (see src/env-banner.tsx)
app.get("/api/health", async (c) => c.json({ ok: true, env: c.env.APP_ENV || "production", maintenance: !!(await maintenanceState(c.env.KV)) }));
for (const routes of [
  clubRoutes,
  authRoutes,
  emailRoutes,
  joinRoutes,
  eventRoutes,
  carpoolRoutes,
  squadRoutes,
  teamRoutes,
  personRoutes,
  planRoutes,
  adminRoutes,
  parentRoutes,
  pushRoutes,
  chatRoutes,
  gameRoutes,
  gameImportRoutes,
  mailRoutes,
  smsRoutes,
  seasonRoutes,
  avatarRoutes,
  dutyRoutes,
  calendarRoutes,
  feedbackRoutes,
  refereeRoutes,
]) {
  app.route("/api", routes);
}

export default {
  fetch: app.fetch,
  scheduled: (controller, env, ctx) => ctx.waitUntil(handleScheduled(env, controller.scheduledTime)),
  queue: (batch, env) => handleQueue(batch, env),
} satisfies ExportedHandler<Env, PushJob>;
