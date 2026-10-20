// Worker part of the youth referees module (youth referees): the role by link, the list for admins and the
// helper plan view of all games that need a youth referee.
import { Hono } from "hono";
import type { AppEnv } from "../../../worker/app";
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { refereeRoutes } from "./admin-routes";
import { refereePlanRoutes } from "./plan-routes";

const routes = new Hono<AppEnv>();
routes.route("/", refereeRoutes);
routes.route("/", refereePlanRoutes);

export default defineWorkerModule({ manifest, routes, exportTables: ["referees"] });
