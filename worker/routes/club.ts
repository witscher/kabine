// Club profile: public read (login page, splash, manifest) and admin edit.
import { Hono } from "hono";
import { z } from "zod";
import { isHexColor } from "../../shared/club";
import { LOCALES } from "../../shared/i18n";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { loadClub, saveClub } from "../domain/club";
import { badRequest, forbidden, parse, readJson } from "../lib/http";

export const clubRoutes = new Hono<AppEnv>();

const LOGO_KEY = "club-logo";
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX_BYTES = 256 * 1024;

clubRoutes.get("/club", async (c) => {
  const { ownerPersonId: _, ...club } = await loadClub(c.env.DB);
  c.header("Cache-Control", "no-cache");
  return c.json(club);
});

const color = z.string().refine(isHexColor, "Invalid colour.");
const clubSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  shortName: z.string().trim().min(1).max(24).optional(),
  abbr: z.string().trim().max(8).optional(),
  colors: z.object({ primary: color, accent: color }).optional(),
  privacyUrl: z.string().trim().url().max(300).nullable().optional(),
  privacyText: z.string().trim().max(5000).nullable().optional(),
  contact: z.string().trim().max(200).nullable().optional(),
  defaultLocale: z.enum(LOCALES).optional(),
  setupDone: z.boolean().optional(),
});

clubRoutes.put("/admin/club", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(clubSchema, await readJson(c.req.raw));
  if (input.privacyUrl && !/^https:\/\//.test(input.privacyUrl)) throw badRequest("The link must start with https://.");
  const { ownerPersonId: _, ...club } = await saveClub(c.env.DB, input);
  return c.json(club);
});

/** Hands the protected owner role to another admin. Only the owner can do this. */
clubRoutes.put("/admin/club/owner", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const { personId } = parse(z.object({ personId: z.number().int().positive() }), await readJson(c.req.raw));
  const club = await loadClub(c.env.DB);
  if (club.ownerPersonId !== null && club.ownerPersonId !== actor.personId) throw forbidden("Only the owner can hand over this role.", "owner_only");
  const target = await c.env.DB.prepare("SELECT 1 FROM persons WHERE id = ? AND is_admin = 1 AND is_former = 0").bind(personId).first();
  if (!target) throw badRequest("The new owner must be an admin.");
  await saveClub(c.env.DB, { ownerPersonId: personId });
  return c.json({ ok: true });
});

clubRoutes.get("/club/logo", async (c) => {
  const { value, metadata } = await c.env.KV.getWithMetadata<{ type: string }>(LOGO_KEY, "arrayBuffer");
  if (!value || !metadata) return c.body(null, 404);
  return c.body(value, 200, {
    "Content-Type": metadata.type,
    // The URL carries the version, so the logo can be cached for long
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
});

clubRoutes.put("/admin/club/logo", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  if (!LOGO_TYPES.includes(type)) throw badRequest("Please upload a PNG, JPEG, WebP or SVG file.");
  const body = await c.req.arrayBuffer();
  if (!body.byteLength || body.byteLength > LOGO_MAX_BYTES) throw badRequest("The logo may be at most 256 KB.");
  await c.env.KV.put(LOGO_KEY, body, { metadata: { type } });
  const club = await loadClub(c.env.DB);
  await saveClub(c.env.DB, { logoVersion: (club.logoVersion ?? 0) + 1 });
  return c.json({ ok: true });
});

clubRoutes.delete("/admin/club/logo", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  await c.env.KV.delete(LOGO_KEY);
  await saveClub(c.env.DB, { logoVersion: null });
  return c.json({ ok: true });
});

/** Web app manifest with the club's name and colours (installation on the home screen). */
clubRoutes.get("/manifest", async (c) => {
  const club = await loadClub(c.env.DB);
  c.header("Content-Type", "application/manifest+json");
  c.header("Cache-Control", "no-cache");
  return c.body(
    JSON.stringify({
      name: club.name,
      short_name: club.shortName,
      description: club.name,
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: club.colors.primary,
      theme_color: club.colors.primary,
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
      ],
    }),
  );
});
