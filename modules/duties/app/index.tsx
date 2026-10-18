// App part of the helper duties module: the "Helpers" tab with the helper plan and the duty types and
// templates under Administration. Duty chips on event cards and the duty blocks of an event are core
// screens (src/duties.tsx, src/duty-blocks.tsx) that show while the module is on.
import { t } from "@lingui/core/macro";
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";

export default defineAppModule({
  manifest,
  routes: [
    { path: "/helfer", page: lazyPage(() => import("./helpers").then((m) => m.HelpersPage)) },
    { path: "/verwaltung/helferdienste", page: lazyPage(() => import("./admin").then((m) => m.AdminDutiesPage)) },
  ],
  // Helpers of a team with a helper plan, and youth referees (their plan is in the same tab)
  tab: (me) => (me.helperTeams.length || me.referee ? { href: "/helfer", label: t`Helpers`, icon: "helping", match: (p) => p.startsWith("/helfer") } : null),
  adminMenu: () => [{ href: "/verwaltung/helferdienste", icon: "helping", title: t`Helper duties`, sub: t`Duty types and templates for games and special events` }],
});
