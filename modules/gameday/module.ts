import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "gameday",
  kind: "feature",
  // New modules start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "beta",
  defaultOn: false,
  // Every API route of the module must match one of these (test/modules-contract.test.ts)
  paths: [/^\/api\/gameday\//],
  label: () => t`Home game day`,
  description: () =>
    t`On a day when many teams play at home, everyone involved gets a message the day before, a card on the start page and an overview of all games of the day.`,
  privacy: () => ({
    stores: t`No further personal data: the settings, the dates on which the message the day before went out, and a mascot picture an admin may upload. Who gets the message is worked out from the teams, the parent links, the teams one follows and the helper duties of the day.`,
    visibleTo: t`The overview of the day: the players, parents, coaches and fans of the teams that play, whoever has a helper duty that day, and admins. It shows only game data (kick-off, venue, opponent), no squads, responses or names.`,
    deleted: t`The dates after a week; the picture when an admin removes it.`,
  }),
  notificationTopics: [{ id: "gameday", label: () => t`Home game day (the day before)`, self: true }],
});
