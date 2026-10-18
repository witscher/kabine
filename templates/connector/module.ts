import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "__ID__",
  kind: "fixtures",
  vendor: "__VENDOR__",
  // New connectors start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "beta",
  defaultOn: false,
  sports: ["__SPORT__"],
  label: () => t`Game schedule from __VENDOR__`,
  description: () => t`Coaches sync the games of their team from __VENDOR__.`,
  // Game schedules carry teams, halls and results, no personal data
  privacy: () => null,
});
