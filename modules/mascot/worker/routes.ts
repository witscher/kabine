// API of the club mascot module, mounted under /api: the pictures by slot, served to everyone like the club logo,
// uploaded and removed by admins. Blocked in the public demo (worker/demo/routes.ts).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { type AppEnv, requireActor } from "../../../worker/app";
import { requireAdmin } from "../../../worker/auth/actor";
import { first, run } from "../../../worker/lib/db";
import { ApiError, badRequest, notFound } from "../../../worker/lib/http";
import { imageInfo, isMascotSlot, MAX_BYTES, MIN_SIDE, SLOT_RULES } from "../shared/rules";

export const routes = new Hono<AppEnv>();

export const mascotUrl = (slot: string, version: number) => `/api/mascot/images/${slot}?v=${version}`;

function slotParam(c: { req: { param(name: "slot"): string } }) {
  const slot = c.req.param("slot");
  if (!isMascotSlot(slot)) throw notFound();
  return slot;
}

/** A club picture like the logo, for everyone (also the sign-in page); with a matching version it never changes. */
routes.get("/mascot/images/:slot", async (c) => {
  const slot = slotParam(c);
  const row = await first<{ mime: string; image: ArrayBuffer | number[]; version: number }>(c.env.DB, "SELECT mime, image, version FROM mascot_images WHERE slot = ?", slot);
  if (!row) throw notFound();
  const bytes = row.image instanceof ArrayBuffer ? new Uint8Array(row.image) : Uint8Array.from(row.image);
  return new Response(bytes, {
    headers: {
      "content-type": row.mime,
      "cache-control": c.req.query("v") === String(row.version) ? "public, max-age=31536000, immutable" : "no-cache",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
});

/** The browser has already scaled the picture and checked its background (app/prepare.ts); type and size are checked again here. */
routes.put("/mascot/images/:slot", async (c) => {
  requireAdmin(requireActor(c));
  const slot = slotParam(c);
  const tooLarge = () => new ApiError(413, "too_large", t`The picture may be at most 200 KB.`);
  if (Number(c.req.header("content-length") ?? 0) > MAX_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw tooLarge();
  const info = imageInfo(bytes);
  if (!info) throw badRequest(t`Please upload a picture in PNG or WebP format.`);
  const side = MIN_SIDE;
  if (Math.max(info.width, info.height) < side) throw badRequest(t`The picture must be at least ${side} pixels in size.`, "too_small");
  if (SLOT_RULES[slot].square && info.width !== info.height) throw badRequest(t`The faces must be square.`, "not_square");
  // A new version per upload (a timestamp, like profile pictures): a removed and uploaded again picture gets a new URL
  await run(
    c.env.DB,
    `INSERT INTO mascot_images (slot, mime, version, image) VALUES (?, ?, ?, ?)
     ON CONFLICT (slot) DO UPDATE SET mime = excluded.mime, version = excluded.version, image = excluded.image,
       created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    slot,
    info.mime,
    Date.now(),
    bytes,
  );
  return c.json({ ok: true });
});

routes.delete("/mascot/images/:slot", async (c) => {
  requireAdmin(requireActor(c));
  await run(c.env.DB, "DELETE FROM mascot_images WHERE slot = ?", slotParam(c));
  return c.json({ ok: true });
});
