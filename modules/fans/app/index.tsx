// App part of the fans module: Profile → Fan of …, the page of a game, the star (and the club button) with the games
// in the event list on home, the row in the personal calendar.
import { t } from "@lingui/core/macro";
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";
import { fansHomeList } from "./list";
import { CalendarOption } from "./calendar";
import "./fans.css";

const pages = () => import("./pages");

export default defineAppModule({
  manifest,
  routes: [
    { path: "/profil/fan", page: lazyPage(() => pages().then((m) => m.FollowPage)) },
    { path: "/spiel/:id", page: lazyPage(() => pages().then((m) => m.FanGamePage)) },
  ],
  profileMenu: () => [{ href: "/profil/fan", icon: "star", title: t`Fan of …`, sub: t`Follow other teams of the club` }],
  homeList: fansHomeList,
  calendarOptions: CalendarOption,
});
