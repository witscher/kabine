import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "handballnet",
  kind: "fixtures",
  vendor: "handball.net",
  // New connectors start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "beta",
  defaultOn: false,
  sports: ["handball"],
  label: () => t`Game schedule from handball.net`,
  description: () => t`Coaches sync the games of their team from handball.net.`,
  // Game schedules carry teams, halls and results, no personal data
  privacy: () => null,
});
