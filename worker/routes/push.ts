import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../app";
import { deviceLabel } from "../auth/session";
import { badgeCount } from "../domain/badge";
import { enqueuePush, pushConfigured } from "../domain/notify";
import { run, stmt } from "../lib/db";
import { conflict, parse, readJson } from "../lib/http";

export const pushRoutes = new Hono<AppEnv>();

/** Zahl für das App-Icon: ungelesene Erwähnungen und offene Anfragen. */
pushRoutes.get("/badge", async (c) => {
  const actor = requireActor(c);
  return c.json(await badgeCount(c.env.DB, actor.accountId));
});

pushRoutes.get("/push/config", (c) => {
  requireActor(c);
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || null, enabled: pushConfigured(c.env) });
});

const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(1000)
    .refine((u) => /^https:\/\/[^\s]+$/.test(u), "Ungültiger Push-Endpunkt"),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}={0,2}$/, "Ungültiger Schlüssel"),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}={0,2}$/, "Ungültiger Schlüssel"),
  }),
});

pushRoutes.post("/push/subscriptions", async (c) => {
  const actor = requireActor(c);
  const input = parse(subscriptionSchema, await readJson(c.req.raw));
  const db = c.env.DB;
  // The endpoint alone is no proof: another account takes over a subscription only with the same keys, i.e. from the
  // same browser (a shared device where someone else signs in). Otherwise the device would silently lose its pushes.
  const [saved] = await db.batch<{ account_id: number }>([
    stmt(
      db,
      `INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, device_label) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET account_id = excluded.account_id, p256dh = excluded.p256dh,
         auth = excluded.auth, device_label = excluded.device_label
        WHERE push_subscriptions.account_id = excluded.account_id
           OR (push_subscriptions.p256dh = excluded.p256dh AND push_subscriptions.auth = excluded.auth)
       RETURNING account_id`,
      actor.accountId,
      input.endpoint,
      input.keys.p256dh.replace(/=+$/, ""),
      input.keys.auth.replace(/=+$/, ""),
      deviceLabel(c.req.header("user-agent") ?? null),
    ),
    // Adresse der App als Kontakt für die Push-Dienste, solange ORIGIN leer ist (workers.dev)
    stmt(
      db,
      "INSERT INTO app_meta (key, value) VALUES ('app_origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      new URL(c.req.url).origin,
    ),
  ]);
  if (!saved?.results.length) throw conflict("Dieses Gerät ist für ein anderes Konto angemeldet. Bitte schalte Benachrichtigungen aus und wieder ein.", "endpoint_taken");
  return c.json({ ok: true }, 201);
});

pushRoutes.delete("/push/subscriptions", async (c) => {
  const actor = requireActor(c);
  const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), await readJson(c.req.raw));
  await run(c.env.DB, "DELETE FROM push_subscriptions WHERE endpoint = ? AND account_id = ?", endpoint, actor.accountId);
  return c.json({ ok: true });
});

pushRoutes.post("/push/test", async (c) => {
  const actor = requireActor(c);
  if (!pushConfigured(c.env)) throw conflict("Push ist auf dem Server noch nicht eingerichtet (VAPID-Schlüssel fehlen).");
  const sent = await enqueuePush(c.env, [actor.accountId], {
    title: "Test-Benachrichtigung",
    body: "Push funktioniert. So erfährst du von neuen Terminen und Absagen.",
    url: "/profil",
    tag: "test",
  });
  if (!sent) throw conflict("Auf diesem Account ist noch kein Gerät für Push registriert.");
  return c.json({ ok: true });
});
