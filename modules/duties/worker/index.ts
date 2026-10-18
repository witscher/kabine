// Worker part of the helper duties module: the helper plan API, duty types and templates, reminders.
// The duty rules themselves (worker/domain/duties.ts) and the live channel (worker/duties/hub.ts) are part
// of the core, because event lists, the event page and the calendar show one's duties.
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { sendDutyNotifications } from "./notify";
import { dutyRoutes } from "./routes";

export default defineWorkerModule({
  manifest,
  routes: dutyRoutes,
  cron: (env, now) => sendDutyNotifications(env, now),
  exportTables: ["duty_types", "duty_templates", "duty_template_items", "event_duties", "duties", "skill_consents", "duty_notifications"],
});
