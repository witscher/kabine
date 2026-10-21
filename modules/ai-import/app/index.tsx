// App part of the AI list import module: the buttons in the list import of the setup wizard
// (src/list-import.tsx) send column headers or unclear name cells to the module's API.
import { t } from "@lingui/core/macro";
import type { ImportField } from "../../../shared/list-import";
import { api } from "../../../src/api";
import { defineAppModule } from "../../../src/module-api";
import manifest from "../module";

export default defineAppModule({
  manifest,
  listImport: {
    columns: async (header, samples) => (await api.post<{ mapping: ImportField[] }>("/ai-import/columns", { header, samples })).mapping,
    names: async (cells) => {
      const out = [];
      for (let i = 0; i < cells.length; i += 100) {
        out.push(...(await api.post<{ names: ({ firstName: string; lastName: string; birthYear: number | null } | null)[] }>("/ai-import/names", { cells: cells.slice(i, i + 100) })).names);
      }
      return out;
    },
    notice: () =>
      t`AI help sends only what the button names to Cloudflare Workers AI in your club's Cloudflare account: column headers, or the unclear name cells. Cloudflare does not use it for training and does not keep it; processing in the EU is not guaranteed.`,
  },
});
