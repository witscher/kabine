import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "__ID__",
  kind: "feature",
  // New modules start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "beta",
  defaultOn: false,
  // Every API route of the module must match one of these (test/modules-contract.test.ts)
  paths: [/^\/api\/__FOLDER__\//],
  label: () => t`__NAME__`,
  description: () => t`Describe what this module does and for whom.`,
  // What the module stores about people, who sees it, when it is deleted; null while it stores nothing
  privacy: () => null,
});
