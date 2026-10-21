// App part of the AI list import module: the button "Recognise columns with AI" in the list import of the setup
// wizard (src/list-import.tsx). What it may send is decided there (assistInput in shared/list-import.ts).
import { t } from "@lingui/core/macro";
import type { ImportField } from "../../../shared/list-import";
import { api } from "../../../src/api";
import { defineAppModule } from "../../../src/module-api";
import manifest from "../module";

export default defineAppModule({
  manifest,
  listImport: {
    columns: async (header, samples) => (await api.post<{ mapping: ImportField[] }>("/ai-import/columns", { header, samples })).mapping,
    notice: () =>
      t`The button sends the column headers of the list to Cloudflare Workers AI (model Clairic, currently a preview). Other cell contents only go out masked, without readable names. Cloudflare states that it does not store such requests or use them for training; processing only within the EU is not guaranteed.`,
  },
});
