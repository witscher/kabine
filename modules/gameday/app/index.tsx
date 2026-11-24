// App part of the home game day module: the card and the later days in the event list on home, the page of the day,
// the settings under Administration.
import { t } from "@lingui/core/macro";
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";
import { gamedayHomeList } from "./list";
import "./gameday.css";

const pages = () => import("./pages");

export default defineAppModule({
  manifest,
  routes: [
    { path: "/heimspieltag/:date", page: lazyPage(() => pages().then((m) => m.GamedayPage)) },
    { path: "/verwaltung/heimspieltage", page: lazyPage(() => pages().then((m) => m.AdminGamedayPage)) },
  ],
  adminMenu: () => [{ href: "/verwaltung/heimspieltage", icon: "ball", title: t`Home game days`, sub: t`Message the day before, from how many teams, mascot` }],
  homeList: gamedayHomeList,
});
