// Worker part of the helper duties module: the helper plan API, duty types and templates, reminders.
// The duty rules themselves (worker/domain/duties.ts) and the live channel (worker/duties/hub.ts) are part
// of the core, because event lists, the event page and the calendar show one's duties.
import { Hono } from "hono";
import type { AppEnv } from "../../../worker/app";
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { sendDutyNotifications } from "./notify";
import { qualificationRoutes } from "./qualifications";
import { dutyRoutes } from "./routes";

const routes = new Hono<AppEnv>();
// Qualifications first: /duties/qualified/... would otherwise match /duties/:id routes of the plan
routes.route("/", qualificationRoutes);
routes.route("/", dutyRoutes);

export default defineWorkerModule({
  manifest,
  routes,
  cron: (env, now) => sendDutyNotifications(env, now),
  exportTables: [
    "duty_types",
    "duty_templates",
    "duty_template_items",
    "event_duties",
    "duties",
    "skill_consents",
    "skill_grants",
    "age_class_duties",
    "duty_notifications",
  ],
});
