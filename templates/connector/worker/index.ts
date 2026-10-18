// Worker part of the __VENDOR__ connector. Linking and syncing are the core's; guide: docs/connectors.md.
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { connector } from "./connector";

export default defineWorkerModule({ manifest, fixtures: connector });
