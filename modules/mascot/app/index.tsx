// App part of the club mascot module: the pictures under Administration. Others show them through useMascotImage
// (src/modules.ts), which reads the club profile.
import { t } from "@lingui/core/macro";
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";
import "./mascot.css";

export default defineAppModule({
  manifest,
  routes: [{ path: "/verwaltung/maskottchen", page: lazyPage(() => import("./admin").then((m) => m.AdminMascotPage)) }],
  adminMenu: () => [{ href: "/verwaltung/maskottchen", icon: "smile", title: t`Club mascot`, sub: t`Faces for results, pictures for home game days` }],
});
