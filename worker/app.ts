import { type Context, Hono } from "hono";
import { type Actor, loadActor } from "./auth/actor";
import { readViewMode, viewAsActor } from "./auth/view-as";
import { clearedSessionCookie, extendSessionIfDue, findSession, readSessionToken, sessionCookie } from "./auth/session";
import { maintenanceAllowed, maintenanceState } from "./lib/maintenance";
import { ApiError, forbidden, unauthorized } from "./lib/http";
import { enterClubContext } from "./domain/club";

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
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, "not_found", "Nicht gefunden.");
  return n;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createBaseApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    console.error("Unerwarteter Fehler", err);
    return c.json({ error: { code: "internal", message: "Es ist ein Fehler aufgetreten. Bitte versuche es später erneut." } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Unbekannter Endpunkt." } }, 404));

  app.use("/api/*", async (c, next) => {
    // Schutz gegen CSRF: Browser senden bei Schreibzugriffen immer Origin mit.
    const appOrigin = c.env.ORIGIN || new URL(c.req.url).origin;
    if (UNSAFE.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && origin !== appOrigin) {
        throw forbidden("Ungültige Herkunft der Anfrage.");
      }
    }
    // WebSockets (chat, helper plan) carry the session cookie from any site of the same parent domain, and browsers
    // always send Origin with them: only the app itself may open one.
    if (c.req.header("upgrade")?.toLowerCase() === "websocket" && c.req.header("origin") !== appOrigin) {
      throw forbidden("Ungültige Herkunft der Anfrage.");
    }

    await enterClubContext(c.env.DB);
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
    // Wartungsmodus: nur Admins (auch im Trainer-Modus oder in einer Ansicht)
    if (!(actor?.isAdmin || actor?.adminSuspended) && !maintenanceAllowed(c.req.path, !!actor)) {
      if (await maintenanceState(c.env.KV)) {
        return c.json({ error: { code: "maintenance", message: "Die App wird gerade gewartet und ist gleich wieder da." } }, 503);
      }
    }
    const viewMode = actor?.isAdmin ? readViewMode(c.req.raw) : null;
    if (actor && viewMode) {
      actor = (await viewAsActor(c.env.DB, actor, viewMode)) ?? actor;
      if (actor.readOnly && UNSAFE.has(c.req.method) && !c.req.path.startsWith("/api/auth/logout")) {
        throw forbidden("In dieser Ansicht kann nichts geändert werden.", "view_read_only");
      }
    }
    c.set("actor", actor);
    c.set("sessionToken", actorToken);

    await next();
    // Profilbilder setzen ihr eigenes Caching
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  return app;
}
