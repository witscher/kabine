// Worker part of the handball.net connector. Linking and syncing are the core's; guide: docs/dev/connectors.md.
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { connector } from "./connector";

export default defineWorkerModule({ manifest, fixtures: connector });
