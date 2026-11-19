import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "handballnet",
  kind: "fixtures",
  vendor: "handball.net",
  status: "stable",
  defaultOn: true,
  sports: ["handball"],
  label: () => t`Game schedule from handball.net`,
  description: () => t`Coaches sync the games of their team from handball.net, and the app syncs them once a week when a coach opens it.`,
  // Game schedules carry teams, halls and results, no personal data
  privacy: () => null,
});
