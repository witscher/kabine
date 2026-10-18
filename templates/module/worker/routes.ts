// API of the __NAME__ module, mounted under /api. Check permissions here, on the server
// (worker/auth/actor.ts: requireCoach, isCoachOf, actsFor, requireAdmin).
import { Hono } from "hono";
import { type AppEnv, requireActor } from "../../../worker/app";

export const routes = new Hono<AppEnv>();

routes.get("/__FOLDER__/hello", async (c) => {
  const actor = requireActor(c);
  return c.json({ hello: actor.firstName });
});
