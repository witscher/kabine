import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "handball4all",
  kind: "fixtures",
  vendor: "handball4all",
  status: "stable",
  defaultOn: true,
  sports: ["handball"],
  label: () => t`Game schedule from handball4all`,
  description: () => t`Coaches sync the games of their team from the handball4all portal (German handball associations).`,
  // Only games, halls and team names of the league, no personal data
  privacy: () => null,
});
