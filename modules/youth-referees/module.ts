import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "youthReferees",
  kind: "feature",
  status: "stable",
  defaultOn: true,
  requires: "duties",
  sports: ["handball"],
  paths: [/^\/api\/(duties\/referee|referee\/|admin\/referee)/],
  label: () => t`Youth referees`,
  description: () => t`Home games of the marked age groups get a youth referee duty, with a role granted by link. Needs helper duties.`,
  privacy: () => ({
    stores: t`Who has the youth referee role and who referees which home game.`,
    visibleTo: t`The youth referees and the admins; at the game as a helper duty.`,
    deleted: t`The role when an admin removes it or the person leaves the club; assignments at the season change.`,
  }),
});
