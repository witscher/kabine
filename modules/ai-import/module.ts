import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "aiImport",
  kind: "feature",
  vendor: "Cloudflare Workers AI",
  // New modules start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "beta",
  defaultOn: false,
  // Every API route of the module must match one of these (test/modules-contract.test.ts)
  paths: [/^\/api\/ai-import\//],
  label: () => t`AI list import`,
  description: () =>
    t`Helps the list import in the setup wizard: an AI model in your Cloudflare account recognises unusual column headers, only when an admin taps the button. No names are sent.`,
  // Stores nothing: column headers (and masked samples) are read and answered in the same request
  privacy: () => null,
});
