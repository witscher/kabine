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
    { path: "/verwaltung/freigaben", page: lazyPage(() => import("./approvals").then((m) => m.AdminApprovalsPage)) },
    { path: "/freigabe", page: lazyPage(() => import("./approvals").then((m) => m.ApprovalJoinPage)) },
    // Links from before 0.8.0 (youth referees)
    { path: "/kihasl", page: lazyPage(() => import("./approvals").then((m) => m.ApprovalJoinPage)) },
  ],
  // Helpers of a team with a helper plan, and approved people of lists across teams (e.g. youth referees)
  tab: (me) => (me.helperTeams.length || me.qualifiedLists.some((q) => q.mine) ? { href: "/helfer", label: t`Helpers`, icon: "helping", match: (p) => p.startsWith("/helfer") } : null),
  // Statistics: helpers per family (coaches) and the family's duties (players, parents)
  teamStats: { label: () => t`Helpers`, shown: (stats) => stats.helperPlan, view: lazyPage(() => import("./stats").then((m) => m.HelperStatsView)) },
  myStats: lazyPage(() => import("./stats").then((m) => m.MyHelperCard)),
  // Approvals by an admin (Administration → Protocol)
  auditTexts: () => ({
    "duties.grant": (e, { who, person }) => {
      const duty = String(e.detail?.duty ?? "");
      return t`${who} approved ${person} for ${duty}`;
    },
    "duties.ungrant": (e, { who, person }) => {
      const duty = String(e.detail?.duty ?? "");
      return t`${who} took back the approval of ${person} for ${duty}`;
    },
  }),
  adminMenu: () => [
    { href: "/verwaltung/helferdienste", icon: "helping", title: t`Helper duties`, sub: t`Duty types and templates for games and special events` },
    { href: "/verwaltung/freigaben", icon: "whistle", title: t`Approvals`, sub: t`Who may take duties an admin approves, e.g. youth referees` },
  ],
});
