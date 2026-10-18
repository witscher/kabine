import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "duties",
  kind: "feature",
  status: "stable",
  defaultOn: true,
  paths: [/^\/api\/(duties|duty-|admin\/duty-|profile\/duty-prefs)/],
  label: () => t`Helper duties`,
  description: () => t`Parents or players sign up for duties at games and special events (cake, timekeeping, washing shirts).`,
  privacy: () => ({
    stores: t`Who takes on which duty at which game or event, optional notes (e.g. which cake) and duty preferences.`,
    visibleTo: t`The helpers of the team see who takes on which duty as “First name L.”; coaches and admins in full. The personal calendar link only contains your own duties and those of your children.`,
    deleted: t`At the season change; future duties when someone leaves the club.`,
  }),
});
