// Worker part of the club mascot module: the pictures (routes) and the hook through which the core and other modules
// get their URLs (mascot, carried to the app by GET /api/club).
import type { MascotImages } from "../../../shared/module-api";
import { all } from "../../../worker/lib/db";
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { isMascotSlot } from "../shared/rules";
import { mascotUrl, routes } from "./routes";

export default defineWorkerModule({
  manifest,
  routes,
  /** Slot and version only (the picture is the last column and not read): at most six small rows per start of the app. */
  mascot: async (db): Promise<MascotImages> => {
    const rows = await all<{ slot: string; version: number }>(db, "SELECT slot, version FROM mascot_images");
    return Object.fromEntries(rows.filter((r) => isMascotSlot(r.slot)).map((r) => [r.slot, mascotUrl(r.slot, r.version)]));
  },
  // Pictures, no personal data (like the product photos of polls)
  exportExcluded: ["mascot_images"],
});
