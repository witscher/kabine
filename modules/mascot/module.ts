import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "mascot",
  kind: "feature",
  // New modules start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "beta",
  defaultOn: false,
  // Every API route of the module must match one of these (test/modules-contract.test.ts)
  paths: [/^\/api\/mascot\//],
  label: () => t`Club mascot`,
  description: () =>
    t`Admins upload pictures of the club's mascot: faces for won, drawn, narrowly and clearly lost games, and the mascot on the cards of the home game day.`,
  privacy: () => ({
    stores: t`No personal data: up to six pictures of the club's mascot, uploaded by an admin.`,
    visibleTo: t`Everyone who opens the app, like the club logo.`,
    deleted: t`When an admin removes a picture or replaces it.`,
  }),
});
