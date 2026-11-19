// App part of the polls module: its pages, the card at the very top of the start page, the dot on the Events tab,
// entries under Profile and Administration.
import { t } from "@lingui/core/macro";
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";
import { EventsTabDot, OpenPollCards } from "./home";
import "./polls.css";

const pages = () => import("./pages");

export default defineAppModule({
  manifest,
  routes: [
    { path: "/umfragen", page: lazyPage(() => pages().then((m) => m.PollsPage)) },
    { path: "/umfragen/neu", page: lazyPage(() => pages().then((m) => m.PollNewPage)) },
    { path: "/umfragen/:id", page: lazyPage(() => pages().then((m) => m.PollPage)) },
    { path: "/umfragen/:id/bearbeiten", page: lazyPage(() => pages().then((m) => m.PollEditPage)) },
    { path: "/verwaltung/umfragen", page: lazyPage(() => import("./settings").then((m) => m.AdminPollsPage)) },
  ],
  adminMenu: () => [{ href: "/verwaltung/umfragen", icon: "poll", title: t`Polls`, sub: t`Polls of the whole club, payment for orders` }],
  profileMenu: () => [{ href: "/umfragen", icon: "poll", title: t`Polls`, sub: t`Your polls and orders` }],
  homeCards: OpenPollCards,
  eventsTabDot: EventsTabDot,
});
