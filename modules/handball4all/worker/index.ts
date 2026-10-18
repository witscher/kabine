// Worker part of the handball4all module: the fixture connector (connector.ts). Routes and sync are the
// core's (worker/routes/games.ts, worker/domain/fixtures.ts).
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { handball4all } from "./connector";

export default defineWorkerModule({ manifest, fixtures: handball4all });
