import { t } from "@lingui/core/macro";
import { type Context, Hono } from "hono";
import { type Actor, loadActor } from "./auth/actor";
import { readViewMode, viewAsActor } from "./auth/view-as";
import { clearedSessionCookie, extendSessionIfDue, findSession, readSessionToken, sessionCookie } from "./auth/session";
import { maintenanceAllowed, maintenanceState } from "./lib/maintenance";
import { ApiError, forbidden, unauthorized } from "./lib/http";
import { enterClubContext, isModuleOn, updateInProgress } from "./domain/club";
import { ensureInstanceSecrets } from "./lib/instance-secrets";
import { moduleOfPath } from "./lib/modules";
import { currentLocale, withLocale } from "./i18n";
import { isLocale } from "../shared/i18n";

export type AppEnv = {
  Bindings: Env;
  Variables: { actor: Actor | null; sessionToken: string | null };
};
export type Ctx = Context<AppEnv>;

export function requireActor(c: Ctx): Actor {
  const actor = c.get("actor");
  if (!actor) throw unauthorized();
  return actor;
}

export function intParam(c: Ctx, name: string): number {
  const raw = c.req.param(name);
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, "not_found", t`Not found.`);
  return n;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createBaseApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    console.error("Unexpected error", err);
    return c.json({ error: { code: "internal", message: t`Something went wrong. Please try again later.` } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: t`Unknown endpoint.` } }, 404));

  app.use("/api/*", async (c, next) => {
    await ensureInstanceSecrets(c.env);
    const club = await enterClubContext(c.env.DB);
    // Language: the account's, else the app's (header), else the club's
    const asked = c.req.header("x-kabine-locale");
    return withLocale(isLocale(asked) ? asked : club.defaultLocale, async () => {
      // CSRF protection: browsers always send Origin with write requests.
      const appOrigin = c.env.ORIGIN || new URL(c.req.url).origin;
      if (UNSAFE.has(c.req.method)) {
        const origin = c.req.header("origin");
        if (origin && origin !== appOrigin) {
          throw forbidden(t`Invalid request origin.`);
        }
      }
      // WebSockets (chat, helper plan) carry the session cookie from any site of the same parent domain, and browsers
      // always send Origin with them: only the app itself may open one.
      if (c.req.header("upgrade")?.toLowerCase() === "websocket" && c.req.header("origin") !== appOrigin) {
        throw forbidden(t`Invalid request origin.`);
      }

      const token = readSessionToken(c.req.raw);
      let actor: Actor | null = null;
      if (token) {
        const session = await findSession(c.env.DB, token);
        if (session) actor = await loadActor(c.env.DB, session);
        if (actor && session) {
          const extended = await extendSessionIfDue(c.env.DB, session);
          if (extended) c.header("Set-Cookie", sessionCookie(token, extended), { append: true });
        } else {
          c.header("Set-Cookie", clearedSessionCookie(), { append: true });
        }
      }
      const actorToken = actor ? token : null;
      const locale = isLocale(actor?.locale) ? actor.locale : currentLocale();
      // Remember the app's language on the account the first time, so pushes, mails and the calendar feed
      // (which arrive without the app) use it too. A choice in the profile overwrites it.
      // Not in the demo: its accounts are shared by every visitor, there the browser's language decides
      if (actor && !isLocale(actor.locale) && isLocale(asked) && c.env.APP_ENV !== "demo") {
        c.executionCtx.waitUntil(
          c.env.DB.prepare("UPDATE accounts SET locale = ? WHERE id = ? AND locale IS NULL").bind(asked, actor.accountId).run().catch(() => undefined),
        );
      }
      return withLocale(locale, async () => {
        // An update with database migrations is running (scripts/deploy.mjs): nobody writes, admins neither
        if (updateInProgress() && !maintenanceAllowed(c.req.path, !!actor)) {
          return c.json({ error: { code: "updating", message: t`Kabine is being updated and will be back in a minute.` } }, 503);
        }
        // Maintenance mode: admins only (also in coach mode or in a view)
        if (!(actor?.isAdmin || actor?.adminSuspended) && !maintenanceAllowed(c.req.path, !!actor)) {
          if (await maintenanceState(c.env.KV)) {
            return c.json({ error: { code: "maintenance", message: t`The app is under maintenance and will be back shortly.` } }, 503);
          }
        }
        const viewMode = actor?.isAdmin ? readViewMode(c.req.raw) : null;
        if (actor && viewMode) {
          actor = (await viewAsActor(c.env.DB, actor, viewMode)) ?? actor;
          if (actor.readOnly && UNSAFE.has(c.req.method) && !c.req.path.startsWith("/api/auth/logout")) {
            throw forbidden(t`Nothing can be changed in this view.`, "view_read_only");
          }
        }
        c.set("actor", actor);
        c.set("sessionToken", actorToken);
        // Switched-off modules do not exist for this club
        const module = moduleOfPath(c.req.path);
        if (module && !isModuleOn(module)) throw new ApiError(404, "module_off", t`This function is switched off for this club.`);

        await next();
        // Profile pictures set their own caching
        if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
      });
    });
  });

  return app;
}
