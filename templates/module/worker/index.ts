// Worker part of the __NAME__ module. Hooks: worker/module-api.ts, guide: docs/dev/modules.md.
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { routes } from "./routes";

export default defineWorkerModule({
  manifest,
  routes,
  // cron, eventSummaries, eventDetail, participantsLeft, participantsDropped, personLeaves, exportTables: see docs/dev/modules.md
});
