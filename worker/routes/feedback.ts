// Hilfe und Feedback: Rückmeldungen zur App gehen per E-Mail an den Betreuer der App
// (Secret FEEDBACK_TO, otherwise the owner). Optional mit einem Bild, z. B. einem Screenshot.
import { loadClub } from "../domain/club";
import { Hono } from "hono";
import { type AppEnv, requireActor } from "../app";
import { mailer } from "../domain/email-login";
import { all, first } from "../lib/db";
import { ApiError, badRequest, conflict } from "../lib/http";

export const feedbackRoutes = new Hono<AppEnv>();

const MAX_MESSAGE = 4000;
/** Rohgröße des Bildes; mit Base64 bleibt die Mail unter 5 MiB. */
export const MAX_FEEDBACK_IMAGE = 3 * 1024 * 1024;
const PER_DAY = 10;

function imageType(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

feedbackRoutes.post("/feedback", async (c) => {
  const actor = requireActor(c);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_FEEDBACK_IMAGE + 64 * 1024) throw new ApiError(413, "too_large", "Das Bild ist zu groß.");
  const form = await c.req.formData().catch(() => null);
  if (!form) throw badRequest("Ungültige Anfrage.");
  const message = String(form.get("message") ?? "").trim();
  if (message.length < 3) throw badRequest("Bitte schreib kurz, worum es geht.", "message_required");
  if (message.length > MAX_MESSAGE) throw badRequest(`Bitte höchstens ${MAX_MESSAGE} Zeichen.`);
  const wantsReply = form.get("reply") === "1";

  let attachment: { content: Uint8Array; filename: string; type: string } | null = null;
  const file = form.get("image");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX_FEEDBACK_IMAGE) throw new ApiError(413, "too_large", "Das Bild ist zu groß.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type) throw badRequest("Bitte ein Bild (JPEG, PNG oder WebP) anhängen.", "bad_image");
    attachment = { content: bytes, filename: `bild.${type.ext}`, type: type.mime };
  }

  // Recipient: FEEDBACK_TO if set, otherwise the owner of the installation
  const to = c.env.FEEDBACK_TO || (await ownerEmail(c.env.DB));
  if (!to && c.env.APP_ENV !== "staging") throw new ApiError(503, "not_configured", "Feedback ist gerade nicht eingerichtet.");

  // Höchstens 10 Rückmeldungen pro Zugang und Tag
  const key = `feedback:${actor.accountId}`;
  const count = Number((await c.env.KV.get(key)) ?? 0);
  if (count >= PER_DAY) throw conflict("Du hast heute schon viele Rückmeldungen geschickt. Bitte versuch es morgen noch einmal.", "rate_limited");
  await c.env.KV.put(key, String(count + 1), { expirationTtl: 86_400 });

  // Wer schreibt: Name und Rollen, damit die Rückmeldung einzuordnen ist
  const teamNames = new Map(
    (await all<{ id: number; name: string }>(c.env.DB, "SELECT id, name FROM teams")).map((t) => [t.id, t.name]),
  );
  const ROLE = { player: "Spieler/in", coach: "Trainer/in", helper: "Aushilfe" } as const;
  const roles = [
    ...(actor.isAdmin ? ["Admin"] : []),
    ...actor.memberships.map((m) => `${ROLE[m.role]} ${teamNames.get(m.teamId) ?? ""}`.trim()),
    ...actor.children.map((ch) => {
      const teams = (actor.childMemberships.get(ch.id) ?? []).map((m) => teamNames.get(m.teamId)).filter(Boolean);
      return `Elternteil von ${ch.firstName}${teams.length ? ` (${teams.join(", ")})` : ""}`;
    }),
  ];
  const name = `${actor.firstName}${actor.lastName ? ` ${actor.lastName}` : ""}`;
  // Antwortadresse nur, wenn ausdrücklich gewünscht und bestätigt (die Adresse ist sonst für niemanden sichtbar)
  const account = wantsReply
    ? await first<{ email: string | null; email_verified_at: string | null }>(c.env.DB, "SELECT email, email_verified_at FROM accounts WHERE id = ?", actor.accountId)
    : null;
  const replyTo = account?.email && account.email_verified_at ? account.email : undefined;

  const text = [
    message,
    "",
    "-- ",
    `Von: ${name}`,
    `Rolle: ${roles.join("; ") || "keine Mannschaft"}`,
    `Antwort: ${replyTo ? `erwünscht, an ${replyTo} (Antworten an diese Mail gehen dorthin)` : wantsReply ? "erwünscht, aber keine bestätigte E-Mail-Adresse am Zugang" : "nicht erbeten"}`,
    `Gerät: ${c.req.header("user-agent") ?? "unbekannt"}`,
    `Umgebung: ${c.env.APP_ENV || "production"}`,
  ].join("\n");

  await mailer.send(c.env, {
    to: to ?? "",
    subject: `Feedback Kabine von ${name}`,
    text,
    ...(replyTo ? { replyTo } : {}),
    ...(attachment ? { attachments: [attachment] } : {}),
  });
  return c.json({ ok: true, replyTo: replyTo != null });
});

async function ownerEmail(db: D1Database): Promise<string | null> {
  const { ownerPersonId } = await loadClub(db);
  if (ownerPersonId === null) return null;
  const row = await db
    .prepare("SELECT coalesce(p.admin_email, a.email) AS email FROM persons p LEFT JOIN accounts a ON a.person_id = p.id WHERE p.id = ?")
    .bind(ownerPersonId)
    .first<{ email: string | null }>();
  return row?.email ?? null;
}
