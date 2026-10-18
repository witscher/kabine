import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "carpools",
  kind: "feature",
  status: "stable",
  defaultOn: true,
  paths: [/^\/api\/events\/\d+\/carpool/],
  label: () => t`Carpools`,
  description: () => t`Drivers offer seats for away games, players book them.`,
  privacy: () => ({
    stores: t`Who offers how many seats for an away game, who is looking for one and who rides with whom.`,
    visibleTo: t`The nominated players and their parents (names as “First name L.”) and the coaches.`,
    deleted: t`At the season change; future entries when someone leaves the club or the squad.`,
  }),
  notificationTopics: [{ id: "carpool", label: () => t`Carpools (passengers, free seats)` }],
});
