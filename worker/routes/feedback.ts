import { t } from "@lingui/core/macro";
// Help and feedback: feedback on the app goes by e-mail to the app's maintainer
// (secret FEEDBACK_TO, otherwise the owner). Optionally with a picture, e.g. a screenshot.
import { loadClub } from "../domain/club";
import { Hono } from "hono";
import { type AppEnv, requireActor } from "../app";
import { mailer } from "../domain/email-login";
import { all, first } from "../lib/db";
import { ApiError, badRequest, conflict } from "../lib/http";
import { withLocale } from "../i18n";

export const feedbackRoutes = new Hono<AppEnv>();

const MAX_MESSAGE = 4000;
/** Raw size of the picture; with Base64 the mail stays below 5 MiB. */
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
  if (declared > MAX_FEEDBACK_IMAGE + 64 * 1024) throw new ApiError(413, "too_large", t`The picture is too large.`);
  const form = await c.req.formData().catch(() => null);
  if (!form) throw badRequest(t`Invalid request.`);
  const message = String(form.get("message") ?? "").trim();
  if (message.length < 3) throw badRequest(t`Please write briefly what it is about.`, "message_required");
  if (message.length > MAX_MESSAGE) {
    const max = MAX_MESSAGE;
    throw badRequest(t`Please use at most ${max} characters.`);
  }
  const wantsReply = form.get("reply") === "1";

  let attachment: { content: Uint8Array; filename: string; type: string } | null = null;
  const file = form.get("image");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX_FEEDBACK_IMAGE) throw new ApiError(413, "too_large", t`The picture is too large.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type) throw badRequest(t`Please attach a picture (JPEG, PNG or WebP).`, "bad_image");
    attachment = { content: bytes, filename: `bild.${type.ext}`, type: type.mime };
  }

  // Recipient: FEEDBACK_TO if set, otherwise the owner of the installation
  const to = c.env.FEEDBACK_TO || (await ownerEmail(c.env.DB));
  if (!to && c.env.APP_ENV !== "staging") throw new ApiError(503, "not_configured", t`Feedback is not set up at the moment.`);

  // At most 10 feedback messages per access and day
  const key = `feedback:${actor.accountId}`;
  const count = Number((await c.env.KV.get(key)) ?? 0);
  if (count >= PER_DAY) throw conflict(t`You have already sent a lot of feedback today. Please try again tomorrow.`, "rate_limited");
  await c.env.KV.put(key, String(count + 1), { expirationTtl: 86_400 });

  // Who is writing: name and roles, so the feedback can be put in context
  const teamNames = new Map(
    (await all<{ id: number; name: string }>(c.env.DB, "SELECT id, name FROM teams")).map((t) => [t.id, t.name]),
  );
  const name = `${actor.firstName}${actor.lastName ? ` ${actor.lastName}` : ""}`;
  // Reply address only if explicitly wanted and confirmed (otherwise the address is visible to no one)
  const account = wantsReply
    ? await first<{ email: string | null; email_verified_at: string | null }>(c.env.DB, "SELECT email, email_verified_at FROM accounts WHERE id = ?", actor.accountId)
    : null;
  const replyTo = account?.email && account.email_verified_at ? account.email : undefined;

  // The mail goes to the app's maintainer: in the club's language, not the sender's
  const { subject, text } = withLocale(null, () => {
    const ROLE = { player: t({ message: "Player", context: "feedback" }), coach: t({ message: "Coach", context: "feedback" }), helper: t`Stand-in`, staff: t({ message: "Staff", context: "feedback" }) } as const;
    const roles = [
      ...(actor.isAdmin ? [t`Admin`] : []),
      ...actor.memberships.map((m) => `${ROLE[m.role]} ${teamNames.get(m.teamId) ?? ""}`.trim()),
      ...actor.children.map((ch) => {
        const teams = (actor.childMemberships.get(ch.id) ?? []).map((m) => teamNames.get(m.teamId)).filter(Boolean);
        const childName = ch.firstName;
        const teamList = teams.length ? ` (${teams.join(", ")})` : "";
        return t`Parent of ${childName}${teamList}`;
      }),
    ];
    const roleList = roles.join("; ") || t`not in any team`;
    const reply = replyTo
      ? t`wanted, to ${replyTo} (replies to this mail go there)`
      : wantsReply
        ? t`wanted, but no confirmed e-mail address on the access`
        : t`not requested`;
    const device = c.req.header("user-agent") ?? t`unknown`;
    const environment = c.env.APP_ENV || "production";
    return {
      subject: t`Feedback Kabine from ${name}`,
      text: [
        message,
        "",
        "-- ",
        t`From: ${name}`,
        t`Role: ${roleList}`,
        t`Reply: ${reply}`,
        t`Device: ${device}`,
        t`Environment: ${environment}`,
      ].join("\n"),
    };
  });

  await mailer.send(c.env, {
    to: to ?? "",
    subject,
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
