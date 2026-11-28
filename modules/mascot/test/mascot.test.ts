// Club mascot: pictures by slot, the hook for other code, the club profile. Invented names only.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mascotImage } from "../../../shared/club";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { api, exec, freshDb, loginAs, migrateRest, person, rows, upgradeFrom } from "../../../test/helpers";
import { saveClub } from "../../../worker/domain/club";
import { moduleMascot } from "../../../worker/modules";
import { EXPORT_EXCLUDED } from "../../../worker/routes/season";
import { imageInfo, MAX_BYTES } from "../shared/rules";

const modules = (on: boolean) => saveClub(env.DB, { modules: { ...DEFAULT_MODULES, mascot: on } });

/** The first bytes of a PNG of this size (the server reads type and size from the header only). */
function png(width: number, height: number, length = 64): Uint8Array {
  const b = new Uint8Array(length);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/** An extended WebP (VP8X, with transparency) of this size. */
function webp(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([..."RIFF"].map((ch) => ch.charCodeAt(0)), 0);
  b.set([..."WEBPVP8X"].map((ch) => ch.charCodeAt(0)), 8);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return b;
}

function image(method: "GET" | "PUT" | "DELETE", slot: string, opts: { cookie?: string; body?: Uint8Array; query?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body) headers["content-type"] = "application/octet-stream";
  return exports.default.fetch(new Request(`http://localhost:5173/api/mascot/images/${slot}${opts.query ?? ""}`, { method, headers, body: opts.body }));
}

describe("club mascot", () => {
  let admin: string;
  beforeEach(async () => {
    await freshDb();
    await modules(true);
    admin = await loginAs(await person("Ada", { admin: true }));
  });

  it("reads type and size from the bytes of PNG and WebP files", () => {
    expect(imageInfo(png(300, 256))).toEqual({ mime: "image/png", width: 300, height: 256 });
    expect(imageInfo(webp(512, 400))).toEqual({ mime: "image/webp", width: 512, height: 400 });
    // Lossy WebP: sizes after the frame tag
    const lossy = webp(1, 1);
    lossy.set([..."VP8 "].map((ch) => ch.charCodeAt(0)), 12);
    lossy.set([0x00, 0x01, 0x00, 0x01], 26);
    expect(imageInfo(lossy)).toEqual({ mime: "image/webp", width: 256, height: 256 });
    // Lossless WebP: 14-bit sizes minus one (here 256 x 256)
    const lossless = webp(1, 1);
    lossless.set([..."VP8L"].map((ch) => ch.charCodeAt(0)), 12);
    lossless.set([0x2f, 0xff, 0xc0, 0x3f, 0x00], 20);
    expect(imageInfo(lossless)).toEqual({ mime: "image/webp", width: 256, height: 256 });
    // JPEG, GIF and SVG are not stored
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]))).toBeNull();
    expect(imageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
  });

  it("admins upload a picture per slot; everyone gets it, with the version in the URL for long caching", async () => {
    expect((await image("PUT", "win", { cookie: await loginAs(await person("Mona")), body: png(256, 256) })).status).toBe(403);
    expect((await image("PUT", "win", { body: png(256, 256) })).status).toBe(401);
    expect((await image("PUT", "win", { cookie: admin, body: png(256, 256) })).status).toBe(200);
    expect((await image("PUT", "card", { cookie: admin, body: webp(512, 335) })).status).toBe(200);

    const urls = await moduleMascot(env.DB);
    expect(Object.keys(urls).sort()).toEqual(["card", "win"]);
    expect(urls.win).toMatch(/^\/api\/mascot\/images\/win\?v=\d+$/);
    // Public like the club logo (also on the sign-in page), immutable under its version
    const got = await exports.default.fetch(new Request(`http://localhost:5173${urls.card}`));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/webp");
    expect(got.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await image("GET", "card", { query: "?v=1" })).headers.get("cache-control")).toBe("no-cache");
    expect((await image("GET", "draw")).status).toBe(404);
    expect((await image("GET", "nose")).status).toBe(404);

    // Replaced: a new version, a new URL
    expect((await image("PUT", "win", { cookie: admin, body: png(300, 300) })).status).toBe(200);
    expect((await moduleMascot(env.DB)).win).not.toBe(urls.win);
    expect((await image("DELETE", "win", { cookie: await loginAs(await person("Mona")) })).status).toBe(403);
    expect((await image("DELETE", "win", { cookie: admin })).status).toBe(200);
    expect(Object.keys(await moduleMascot(env.DB))).toEqual(["card"]);
  });

  it("checks type, size and shape on the server too", async () => {
    const put = async (slot: string, body: Uint8Array) => {
      const res = await image("PUT", slot, { cookie: admin, body });
      return { status: res.status, code: ((await res.json()) as { error?: { code: string } }).error?.code };
    };
    expect(await put("win", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]))).toEqual({ status: 400, code: "bad_request" });
    expect(await put("win", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ status: 400, code: "bad_request" });
    expect(await put("win", png(255, 255))).toEqual({ status: 400, code: "too_small" });
    // Faces square, the card and the head any shape
    expect(await put("clear", png(300, 256))).toEqual({ status: 400, code: "not_square" });
    expect(await put("head", png(300, 256))).toEqual({ status: 200, code: undefined });
    expect(await put("card", png(256, 120))).toEqual({ status: 200, code: undefined });
    expect(await put("win", png(256, 256, MAX_BYTES + 1))).toEqual({ status: 413, code: "too_large" });
    expect(await put("nose", png(256, 256))).toEqual({ status: 404, code: "not_found" });
    expect(await rows("SELECT slot, mime FROM mascot_images ORDER BY slot")).toEqual([
      { slot: "card", mime: "image/png" },
      { slot: "head", mime: "image/png" },
    ]);
  });

  it("the hook: the club profile carries the pictures while the module is on, none for empty slots", async () => {
    expect((await api("/club")).body.mascot).toBeUndefined();
    await image("PUT", "head", { cookie: admin, body: png(256, 256) });
    const club = (await api("/club")).body;
    expect(Object.keys(club.mascot)).toEqual(["head"]);
    expect(mascotImage(club, "head")).toMatch(/^\/api\/mascot\/images\/head\?v=\d+$/);
    expect(mascotImage(club, "win")).toBeNull();
    // Saving the club settings answers with them as well, switching the module off without them
    const saved = await api("/admin/club", { method: "PUT", cookie: admin, body: { name: "SV Beispielstadt" } });
    expect(Object.keys(saved.body.mascot)).toEqual(["head"]);
    const off = await api("/admin/club", { method: "PUT", cookie: admin, body: { modules: { mascot: false } } });
    expect(off.body.mascot).toBeUndefined();
    expect(mascotImage(off.body, "head")).toBeNull();
    expect(await moduleMascot(env.DB)).toEqual({});
    expect((await api("/club")).body.mascot).toBeUndefined();
    // The picture stays for when the module is switched on again
    await modules(true);
    expect(Object.keys((await api("/club")).body.mascot)).toEqual(["head"]);
  });

  it("pictures are not in the export", () => {
    expect(EXPORT_EXCLUDED).toContain("mascot_images");
  });
});

describe("club mascot: upgrade", () => {
  it("adds the table to a club's database, existing data stays", async () => {
    await upgradeFrom("202611270200_mascot_images.sql");
    const nora = await person("Nora");
    await migrateRest();
    expect(await rows("SELECT first_name FROM persons WHERE id = ?", nora)).toEqual([{ first_name: "Nora" }]);
    await exec("INSERT INTO mascot_images (slot, mime, version, image) VALUES ('win', 'image/png', 1, ?)", png(256, 256));
    expect(await rows("SELECT slot, version, created_at IS NOT NULL AS dated FROM mascot_images")).toEqual([{ slot: "win", version: 1, dated: 1 }]);
  });
});
