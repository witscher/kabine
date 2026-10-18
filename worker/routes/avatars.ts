// Profilbilder: hochladen, freigeben, ausliefern, entfernen.
import { Hono } from "hono";
import { type AppEnv, intParam, requireActor } from "../app";
import type { Actor } from "../auth/actor";
import { enqueuePush } from "../domain/notify";
import { all, first, run, stmt } from "../lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/http";
import { nowLocal } from "../lib/time";

export const avatarRoutes = new Hono<AppEnv>();

/** Obergrenze für ein Bild. Der Browser schneidet auf 256 x 256 Pixel zu, das sind meist 10 bis 30 KB. */
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
 * Braucht ein Bild dieser Person die Zustimmung der Eltern? Maßgeblich ist das
 * Geburtsjahr: wer in diesem Jahr 18 wird oder älter ist, entscheidet selbst.
 * Ohne Geburtsjahr gilt die Person als volljährig (Entscheidung des Vereins, 11.10.2026).
 */
export function needsConsent(s: Subject, year = Number(nowLocal().slice(0, 4))): boolean {
  return s.birthYear != null && year - s.birthYear < ADULT_AGE;
}

function isGuardian(actor: Actor, s: Subject): boolean {
  return s.guardianIds.includes(actor.personId);
}

/** Bildformat an den ersten Bytes erkennen, nicht am mitgeschickten Typ. */
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

/** Alle freigegebenen Bilder als personId → Version. Sichtbar für alle Angemeldeten. */
avatarRoutes.get("/avatars", async (c) => {
  requireActor(c);
  const rows = await all<{ person_id: number; version: number }>(
    c.env.DB,
    "SELECT a.person_id, a.version FROM avatars a JOIN persons p ON p.id = a.person_id WHERE a.status = 'approved' AND p.is_former = 0",
  );
  return c.json({ avatars: Object.fromEntries(rows.map((r) => [r.person_id, r.version])) });
});

/** Stand für die Profilseite der Person selbst oder eines Elternteils. */
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
    // Minderjährige ohne verknüpfte Eltern können kein Bild hochladen
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
  // Mit passender Version in der Adresse ändert sich das Bild nie, ein neues Bild bekommt eine neue Version
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
  if (!self && !guardian) throw forbidden("Ein Profilbild laden nur die Person selbst oder ihre Eltern hoch.");

  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_AVATAR_BYTES) throw new ApiError(413, "too_large", "Das Bild ist zu groß.");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_AVATAR_BYTES) throw new ApiError(413, "too_large", "Das Bild ist zu groß.");
  const mime = detectMime(bytes);
  if (!mime) throw badRequest("Bitte ein Bild im Format JPEG oder WebP hochladen.");

  let status: Status = "approved";
  if (!guardian && needsConsent(s)) {
    if (!s.guardianIds.length) {
      throw conflict(
        "Für ein Profilbild brauchst du die Zustimmung deiner Eltern, und mit deinem Zugang ist noch kein Elternteil verknüpft. Frag deinen Trainer, ob Eltern eingebunden werden können.",
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
    // Freigabe ist Sache der Eltern, unabhängig davon, ob sie in der Mannschaft eingebunden sind
    const accounts = await all<{ id: number }>(
      db,
      `SELECT a.id FROM accounts a WHERE a.disabled_at IS NULL AND a.person_id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(s.guardianIds),
    );
    await enqueuePush(c.env, accounts.map((a) => a.id), {
      title: "Profilbild freigeben",
      body: `${s.firstName} möchte ein neues Profilbild verwenden. Schau es dir an und gib es frei.`,
      url: `/profil/kind/${s.id}`,
      tag: `avatar-${s.id}`,
    });
  }
  return c.json({ ok: true, status, ...(await versions(db, s.id)) }, 201);
});

avatarRoutes.post("/persons/:id/avatar/approve", async (c) => {
  const actor = requireActor(c);
  const s = await loadSubject(c.env.DB, intParam(c, "id"));
  if (!isGuardian(actor, s)) throw forbidden("Nur verknüpfte Eltern können ein Profilbild freigeben.");
  const db = c.env.DB;
  const pending = await first<{ version: number }>(db, "SELECT version FROM avatars WHERE person_id = ? AND status = 'pending'", s.id);
  if (!pending) throw conflict("Es wartet kein Bild auf Freigabe.");
  await db.batch([
    stmt(db, "DELETE FROM avatars WHERE person_id = ? AND status = 'approved'", s.id),
    stmt(db, "UPDATE avatars SET status = 'approved', approved_by = ? WHERE person_id = ? AND status = 'pending'", actor.personId, s.id),
  ]);
  const accounts = await all<{ id: number }>(db, "SELECT id FROM accounts WHERE person_id = ? AND disabled_at IS NULL", s.id);
  await enqueuePush(c.env, accounts.map((a) => a.id), {
    title: "Profilbild freigegeben",
    body: `${actor.firstName} hat dein neues Profilbild freigegeben.`,
    url: "/profil",
    tag: `avatar-${s.id}`,
  });
  return c.json({ ok: true, ...(await versions(db, s.id)) });
});

/** Entfernen dürfen die Person selbst, ihre Eltern und Admins. ?pending=1 lehnt ein wartendes Bild ab. */
avatarRoutes.delete("/persons/:id/avatar", async (c) => {
  const actor = requireActor(c);
  const s = await loadSubject(c.env.DB, intParam(c, "id"));
  if (s.id !== actor.personId && !isGuardian(actor, s) && !actor.isAdmin) throw forbidden();
  const status: Status = c.req.query("pending") === "1" ? "pending" : "approved";
  await run(c.env.DB, "DELETE FROM avatars WHERE person_id = ? AND status = ?", s.id, status);
  return c.json({ ok: true, ...(await versions(c.env.DB, s.id)) });
});
