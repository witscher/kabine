// App part of the youth referees module: granting the role by link (Administration) and redeeming the link.
// The referees' plan is shown in the "Helpers" tab of the duties module.
import { t } from "@lingui/core/macro";
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";

export default defineAppModule({
  manifest,
  routes: [
    { path: "/verwaltung/kihasl", page: lazyPage(() => import("./referees").then((m) => m.AdminRefereesPage)) },
    { path: "/kihasl", page: lazyPage(() => import("./referees").then((m) => m.RefereeJoinPage)) },
  ],
  adminMenu: () => [{ href: "/verwaltung/kihasl", icon: "whistle", title: t`Youth referees`, sub: t`Grant the referee role by link, list` }],
});
