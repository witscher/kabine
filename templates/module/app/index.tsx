// App part of the __NAME__ module. Hooks: src/module-api.ts, guide: docs/modules.md.
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";

export default defineAppModule({
  manifest,
  routes: [{ path: "/__FOLDER__", page: lazyPage(() => import("./page").then((m) => m.Page)) }],
  // tab, adminMenu, eventCardLine, eventSection, gameLinks: see docs/modules.md
});
