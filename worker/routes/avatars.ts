import { t } from "@lingui/core/macro";
// Profile pictures: upload, approve, serve, remove.
import { Hono } from "hono";
import { type AppEnv, intParam, requireActor } from "../app";
import type { Actor } from "../auth/actor";
import { enqueuePush } from "../domain/notify";
import { all, first, run, stmt } from "../lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/http";
import { nowLocal } from "../lib/time";

export const avatarRoutes = new Hono<AppEnv>();

/** Upper limit for a picture. The browser crops to 256 x 256 pixels, which is usually 10 to 30 KB. */
export const MAX_AVATAR_BYTES = 150_000;
export const ADULT_AGE = 18;

type Status = "approved" | "pending";

interface AvatarRow {
  status: Status;
  mime: string;
  image: ArrayBuffer | number[];
  version: number;
}

interface Subject {
  id: number;
  firstName: string;
  birthYear: number | null;
  guardianIds: number[];
}

async function loadSubject(db: D1Database, personId: number): Promise<Subject> {
  const row = await first<{ id: number; first_name: string; birth_year: number | null; guardians: string }>(
    db,
    `SELECT p.id, p.first_name, p.birth_year,
            (SELECT json_group_array(g.guardian_id) FROM guardianships g JOIN persons gp ON gp.id = g.guardian_id
              WHERE g.child_id = p.id AND gp.is_former = 0) AS guardians
       FROM persons p WHERE p.id = ? AND p.is_former = 0`,
    personId,
  );
  if (!row) throw notFound();
  return {
    id: row.id,
    firstName: row.first_name,
    birthYear: row.birth_year,
    guardianIds: (JSON.parse(row.guardians) as number[]).filter((n) => n != null),
  };
}

/**
 * Does a picture of this person need the parents' consent? The birth year
 * decides: whoever turns 18 this year or is older decides themselves.
 * Without a birth year the person counts as an adult (club decision, 11.10.2026).
 */
export function needsConsent(s: Subject, year = Number(nowLocal().slice(0, 4))): boolean {
  return s.birthYear != null && year - s.birthYear < ADULT_AGE;
}

function isGuardian(actor: Actor, s: Subject): boolean {
  return s.guardianIds.includes(actor.personId);
}

/** Detect the image format from the first bytes, not from the declared type. */
export function detectMime(bytes: Uint8Array): "image/webp" | "image/jpeg" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

async function versions(db: D1Database, personId: number): Promise<Record<Status, number | null>> {
  const rows = await all<{ status: Status; version: number }>(db, "SELECT status, version FROM avatars WHERE person_id = ?", personId);
  return {
    approved: rows.find((r) => r.status === "approved")?.version ?? null,
    pending: rows.find((r) => r.status === "pending")?.version ?? null,
  };
}

/** All approved pictures as personId → version. Visible to everyone signed in. */
avatarRoutes.get("/avatars", async (c) => {
  requireActor(c);
  const rows = await all<{ person_id: number; version: number }>(
    c.env.DB,
    "SELECT a.person_id, a.version FROM avatars a JOIN persons p ON p.id = a.person_id WHERE a.status = 'approved' AND p.is_former = 0",
  );
  return c.json({ avatars: Object.fromEntries(rows.map((r) => [r.person_id, r.version])) });
});

/** State for the profile page of the person themselves or of a parent. */
avatarRoutes.get("/persons/:id/avatar/info", async (c) => {
  const actor = requireActor(c);
  const s = await loadSubject(c.env.DB, intParam(c, "id"));
  const self = s.id === actor.personId;
  const guardian = isGuardian(actor, s);
  if (!self && !guardian && !actor.isAdmin) throw forbidden();
  const consent = needsConsent(s);
  const v = await versions(c.env.DB, s.id);
  return c.json({
    ...v,
    needsConsent: consent,
    hasGuardians: s.guardianIds.length > 0,
    // Minors without linked parents cannot upload a picture
    canUpload: guardian || (self && (!consent || s.guardianIds.length > 0)),
    canApprove: guardian,
  });
});

avatarRoutes.get("/persons/:id/avatar", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "id");
  const status: Status = c.req.query("pending") === "1" ? "pending" : "approved";
  if (status === "pending" && personId !== actor.personId && !actor.isAdmin) {
    const s = await loadSubject(c.env.DB, personId);
    if (!isGuardian(actor, s)) throw notFound();
  }
  const row = await first<AvatarRow>(
    c.env.DB,
    "SELECT a.status, a.mime, a.image, a.version FROM avatars a JOIN persons p ON p.id = a.person_id WHERE a.person_id = ? AND a.status = ? AND p.is_former = 0",
    personId,
    status,
  );
  if (!row) throw notFound();
  const bytes = row.image instanceof ArrayBuffer ? new Uint8Array(row.image) : Uint8Array.from(row.image);
  // With a matching version in the URL the picture never changes; a new picture gets a new version
  const cacheable = status === "approved" && c.req.query("v") === String(row.version);
  return new Response(bytes, {
    headers: {
      "content-type": row.mime,
      "cache-control": cacheable ? "private, max-age=31536000, immutable" : "private, no-cache",
      "x-content-type-options": "nosniff",
    },
  });
});

avatarRoutes.put("/persons/:id/avatar", async (c) => {
  const actor = requireActor(c);
  const s = await loadSubject(c.env.DB, intParam(c, "id"));
  const self = s.id === actor.personId;
  const guardian = isGuardian(actor, s);
  if (!self && !guardian) throw forbidden(t`Only the person themselves or their parents can upload a profile picture.`);

  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_AVATAR_BYTES) throw new ApiError(413, "too_large", t`The picture is too large.`);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_AVATAR_BYTES) throw new ApiError(413, "too_large", t`The picture is too large.`);
  const mime = detectMime(bytes);
  if (!mime) throw badRequest(t`Please upload a picture in JPEG or WebP format.`);

  let status: Status = "approved";
  if (!guardian && needsConsent(s)) {
    if (!s.guardianIds.length) {
      throw conflict(
        t`For a profile picture you need your parents' consent, and no parent is linked to your access yet. Ask your coach whether parents can be involved.`,
        "consent_required",
      );
    }
    status = "pending";
  }

  const db = c.env.DB;
  const version = Date.now();
  await db.batch([
    ...(status === "approved" ? [stmt(db, "DELETE FROM avatars WHERE person_id = ? AND status = 'pending'", s.id)] : []),
    stmt(
      db,
      `INSERT INTO avatars (person_id, status, mime, image, version, uploaded_by, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (person_id, status) DO UPDATE SET mime = excluded.mime, image = excluded.image, version = excluded.version,
         uploaded_by = excluded.uploaded_by, approved_by = excluded.approved_by, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      s.id,
      status,
      mime,
      bytes,
      version,
      actor.personId,
      status === "approved" && guardian ? actor.personId : null,
    ),
  ]);

  if (status === "pending") {
    // Approval is up to the parents, regardless of whether they are involved in the team
    const accounts = await all<{ id: number }>(
      db,
      `SELECT a.id FROM accounts a WHERE a.disabled_at IS NULL AND a.person_id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(s.guardianIds),
    );
    const name = s.firstName;
    await enqueuePush(c.env, accounts.map((a) => a.id), () => ({
      title: t`Approve profile picture`,
      body: t`${name} would like to use a new profile picture. Take a look and approve it.`,
      url: `/profil/kind/${s.id}`,
      tag: `avatar-${s.id}`,
    }));
  }
  return c.json({ ok: true, status, ...(await versions(db, s.id)) }, 201);
});

avatarRoutes.post("/persons/:id/avatar/approve", async (c) => {
  const actor = requireActor(c);
  const s = await loadSubject(c.env.DB, intParam(c, "id"));
  if (!isGuardian(actor, s)) throw forbidden(t`Only linked parents can approve a profile picture.`);
  const db = c.env.DB;
  const pending = await first<{ version: number }>(db, "SELECT version FROM avatars WHERE person_id = ? AND status = 'pending'", s.id);
  if (!pending) throw conflict(t`No picture is waiting for approval.`);
  await db.batch([
    stmt(db, "DELETE FROM avatars WHERE person_id = ? AND status = 'approved'", s.id),
    stmt(db, "UPDATE avatars SET status = 'approved', approved_by = ? WHERE person_id = ? AND status = 'pending'", actor.personId, s.id),
  ]);
  const accounts = await all<{ id: number }>(db, "SELECT id FROM accounts WHERE person_id = ? AND disabled_at IS NULL", s.id);
  const name = actor.firstName;
  await enqueuePush(c.env, accounts.map((a) => a.id), () => ({
    title: t`Profile picture approved`,
    body: t`${name} has approved your new profile picture.`,
    url: "/profil",
    tag: `avatar-${s.id}`,
  }));
  return c.json({ ok: true, ...(await versions(db, s.id)) });
});

/** The person themselves, their parents and admins may remove it. ?pending=1 rejects a waiting picture. */
avatarRoutes.delete("/persons/:id/avatar", async (c) => {
  const actor = requireActor(c);
  const s = await loadSubject(c.env.DB, intParam(c, "id"));
  if (s.id !== actor.personId && !isGuardian(actor, s) && !actor.isAdmin) throw forbidden();
  const status: Status = c.req.query("pending") === "1" ? "pending" : "approved";
  await run(c.env.DB, "DELETE FROM avatars WHERE person_id = ? AND status = ?", s.id, status);
  return c.json({ ok: true, ...(await versions(c.env.DB, s.id)) });
});
