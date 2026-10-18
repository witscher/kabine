import { t } from "@lingui/core/macro";
import { helperTeams, refereeRoles } from "../domain/duties";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { z } from "zod";
import type { Me, Role, SessionResponse, TeamRef } from "../../shared/types";
import { type AppEnv, requireActor } from "../app";
import { type Actor, parentsInCharge } from "../auth/actor";
import { clearedSessionCookie, createSession, deleteSession, deviceLabel, sessionCookie } from "../auth/session";
import { finishLogin, finishRegistration, startLogin, startRegistration, type StoredPasskey } from "../auth/webauthn";
import { all, first, run } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { utcIso } from "../lib/time";
import { isLocale, LOCALES } from "../../shared/i18n";

export async function buildMe(env: Env, actor: Actor): Promise<Me> {
  const childIds = actor.children.map((c) => c.id);
  const [memberships, childTeams, manageable, groups] = await Promise.all([
    all<{ id: number; name: string; role: Role; parents_enabled: number }>(
      env.DB,
      `SELECT t.id, t.name, tm.role, t.parents_enabled FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
        WHERE tm.person_id = ? ORDER BY t.name`,
      actor.personId,
    ),
    all<{ person_id: number; id: number; name: string; parents_enabled: number }>(
      env.DB,
      `SELECT tm.person_id, t.id, t.name, t.parents_enabled FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
        WHERE tm.person_id IN (SELECT value FROM json_each(?)) AND tm.role IN ('player', 'helper')
        ORDER BY t.name`,
      JSON.stringify(childIds),
    ),
    actor.isAdmin
      ? all<TeamRef>(env.DB, "SELECT id, name FROM teams ORDER BY name")
      : all<TeamRef>(env.DB, "SELECT id, name FROM teams WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name", JSON.stringify(actor.coachTeamIds)),
    all<{ id: number }>(env.DB, "SELECT id FROM teams WHERE kind = 'group'"),
  ]);
  return {
    accountId: actor.accountId,
    person: { id: actor.personId, firstName: actor.firstName, lastName: actor.lastName, isAdmin: actor.isAdmin },
    isAdmin: actor.isAdmin,
    children: actor.children.map((c) => ({
      ...c,
      teams: childTeams.filter((t) => t.person_id === c.id).map((t) => ({ id: t.id, name: t.name, parentsEnabled: t.parents_enabled === 1 })),
      parentsInCharge: parentsInCharge(actor, c.id),
    })),
    // As in the actor (the parent view for admins leaves out coach roles)
    memberships: memberships
      .filter((m) => actor.memberships.some((a) => a.teamId === m.id && a.role === m.role))
      .map((m) => ({ id: m.id, name: m.name, role: m.role, parentsEnabled: m.parents_enabled === 1 })),
    manageableTeams: manageable,
    hasGuardians: actor.hasGuardians,
    parentsInCharge: actor.hasGuardians && parentsInCharge(actor, actor.personId),
    permissions: actor.permissions,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    helperTeams: (await helperTeams(env.DB, actor)).map((t) => ({ id: t.teamId, name: t.teamName, own: t.own })),
    viewAs: actor.viewAs ? { mode: actor.viewAs, readOnly: !!actor.readOnly } : null,
    referee: (await refereeRoles(env.DB, actor)).length > 0,
    groupIds: groups.map((g) => g.id),
    // Admin/coach switch in the profile: only admins with an own coach role
    adminSwitch:
      (actor.isAdmin || actor.adminSuspended) && !actor.viewAs && actor.memberships.some((m) => m.role === "coach")
        ? { coachMode: !!actor.adminSuspended }
        : null,
    // Language chosen on the account (null: app or club default)
    locale: isLocale(actor.locale) ? actor.locale : null,
  };
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/session", async (c) => {
  const actor = c.get("actor");
  const body: SessionResponse = actor ? { authenticated: true, me: await buildMe(c.env, actor) } : { authenticated: false };
  return c.json(body);
});

authRoutes.post("/auth/login/options", async (c) => {
  return c.json(await startLogin(c.env, c.req.raw));
});

const verifySchema = z.object({ challengeId: z.string().min(1), response: z.record(z.string(), z.unknown()) });

authRoutes.post("/auth/login/verify", async (c) => {
  const { challengeId, response } = parse(verifySchema, await readJson(c.req.raw));
  const auth = response as unknown as AuthenticationResponseJSON;
  if (typeof auth.id !== "string") throw badRequest(t`Invalid response.`);
  const passkey = await first<StoredPasskey & { disabled_at: string | null; is_former: number }>(
    c.env.DB,
    `SELECT pk.id, pk.account_id, pk.public_key, pk.counter, pk.transports, a.disabled_at, p.is_former
       FROM passkeys pk JOIN accounts a ON a.id = pk.account_id JOIN persons p ON p.id = a.person_id
      WHERE pk.id = ?`,
    auth.id,
  );
  if (!passkey || passkey.disabled_at || passkey.is_former) {
    throw badRequest(
      t`This passkey is not (or no longer) registered here. Please ask your coach for a new invitation link.`,
      "unknown_passkey",
    );
  }
  const { newCounter } = await finishLogin(c.env, c.req.raw, challengeId, auth, passkey);
  await run(
    c.env.DB,
    "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?",
    newCounter,
    utcIso(),
    passkey.id,
  );
  const session = await createSession(c.env.DB, passkey.account_id, c.req.header("user-agent") ?? null);
  c.header("Set-Cookie", sessionCookie(session.token, session.expiresAt), { append: true });
  return c.json({ ok: true });
});

const clientErrorSchema = z.object({
  kind: z.enum(["login", "register"]),
  name: z.string().max(60),
  message: z.string().max(300),
  standalone: z.boolean(),
  preparedAgeMs: z.number().int().min(0).max(3_600_000).nullable(),
});

/** Failed passkey dialogs end up in the log (troubleshooting, without personal data). */
authRoutes.post("/client-errors", async (c) => {
  const input = parse(clientErrorSchema, await readJson(c.req.raw));
  console.warn("Passkey error in the browser", { ...input, ua: (c.req.header("user-agent") ?? "").slice(0, 200) });
  return c.json({ ok: true });
});

authRoutes.post("/auth/logout", async (c) => {
  const token = c.get("sessionToken");
  if (token) await deleteSession(c.env.DB, token);
  c.header("Set-Cookie", clearedSessionCookie(), { append: true });
  return c.json({ ok: true });
});

// Devices and passkeys of the own account ------------------------------------

authRoutes.get("/me/security", async (c) => {
  const actor = requireActor(c);
  const [account, passkeys, sessions] = await Promise.all([
    first<{ email: string | null; email_verified_at: string | null; phone: string | null; phone_verified_at: string | null }>(
      c.env.DB,
      "SELECT email, email_verified_at, phone, phone_verified_at FROM accounts WHERE id = ?",
      actor.accountId,
    ),
    all<{ id: string; label: string | null; created_at: string; last_used_at: string | null; backed_up: number; device_type: string | null }>(
      c.env.DB,
      "SELECT id, label, created_at, last_used_at, backed_up, device_type FROM passkeys WHERE account_id = ? ORDER BY created_at",
      actor.accountId,
    ),
    all<{ id: string; device_label: string | null; created_at: string; expires_at: string }>(
      c.env.DB,
      "SELECT id, device_label, created_at, expires_at FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY created_at DESC",
      actor.accountId,
      utcIso(),
    ),
  ]);
  return c.json({
    email: account?.email ?? null,
    emailVerified: !!account?.email_verified_at,
    phone: account?.phone ?? null,
    phoneVerified: !!account?.phone_verified_at,
    passkeys: passkeys.map((p) => ({
      id: p.id,
      label: p.label,
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at,
      synced: p.backed_up === 1,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.device_label ?? t`Device`,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      current: s.id === actor.session.id,
    })),
  });
});

authRoutes.delete("/me/sessions/:id", async (c) => {
  const actor = requireActor(c);
  const res = await run(c.env.DB, "DELETE FROM sessions WHERE id = ? AND account_id = ?", c.req.param("id"), actor.accountId);
  if (!res.meta.changes) throw notFound();
  return c.json({ ok: true });
});

authRoutes.delete("/me/passkeys/:id", async (c) => {
  const actor = requireActor(c);
  const count = await first<{ n: number; verified: number }>(
    c.env.DB,
    `SELECT (SELECT count(*) FROM passkeys WHERE account_id = ?1) AS n,
            (SELECT count(*) FROM accounts WHERE id = ?1 AND email_verified_at IS NOT NULL) AS verified`,
    actor.accountId,
  );
  if ((count?.n ?? 0) <= 1 && !count?.verified) {
    throw conflict(t`This is your only passkey. Without it and without a confirmed e-mail address you could no longer sign in.`);
  }
  const res = await run(c.env.DB, "DELETE FROM passkeys WHERE id = ? AND account_id = ?", c.req.param("id"), actor.accountId);
  if (!res.meta.changes) throw notFound();
  return c.json({ ok: true });
});

authRoutes.post("/me/passkeys/options", async (c) => {
  const actor = requireActor(c);
  const account = await first<{ webauthn_user_id: string }>(
    c.env.DB,
    "SELECT webauthn_user_id FROM accounts WHERE id = ?",
    actor.accountId,
  );
  const existing = await all<{ id: string; transports: string | null }>(
    c.env.DB,
    "SELECT id, transports FROM passkeys WHERE account_id = ?",
    actor.accountId,
  );
  const name = [actor.firstName, actor.lastName].filter(Boolean).join(" ");
  return c.json(
    await startRegistration(c.env, c.req.raw, {
      webauthnUserId: account!.webauthn_user_id,
      userName: name,
      displayName: name,
      excludeCredentialIds: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
      context: { kind: "add", accountId: actor.accountId },
    }),
  );
});

authRoutes.post("/me/passkeys/verify", async (c) => {
  const actor = requireActor(c);
  const { challengeId, response } = parse(verifySchema, await readJson(c.req.raw));
  const { context, credential } = await finishRegistration<{ kind: string; accountId: number }>(
    c.env,
    c.req.raw,
    challengeId,
    response as unknown as RegistrationResponseJSON,
  );
  if (context.kind !== "add" || context.accountId !== actor.accountId) throw badRequest(t`Invalid request.`);
  await insertPasskey(c.env.DB, actor.accountId, credential, c.req.header("user-agent") ?? null);
  return c.json({ ok: true });
});

export async function insertPasskey(
  db: D1Database,
  accountId: number,
  credential: Awaited<ReturnType<typeof finishRegistration>>["credential"],
  userAgent: string | null,
) {
  await run(
    db,
    `INSERT INTO passkeys (id, account_id, public_key, counter, transports, device_type, backed_up, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    credential.id,
    accountId,
    credential.publicKey,
    credential.counter,
    JSON.stringify(credential.transports),
    credential.deviceType,
    credential.backedUp ? 1 : 0,
    `Passkey · ${deviceLabel(userAgent)}`,
  );
}

const adminModeSchema = z.object({ coachMode: z.boolean() });

/** Admin who is also a coach: work as a coach or as an admin. Checks the person, not the actor (in coach mode the admin rights are suspended). */
authRoutes.put("/profile/admin-mode", async (c) => {
  const actor = requireActor(c);
  const { coachMode } = parse(adminModeSchema, await readJson(c.req.raw));
  const ok = await first<{ ok: number }>(
    c.env.DB,
    `SELECT 1 AS ok FROM persons p WHERE p.id = ? AND p.is_admin = 1
       AND EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.person_id = p.id AND tm.role = 'coach')`,
    actor.personId,
  );
  if (!ok || actor.viewAs) throw forbidden(t`The switch is only available to admins who are also coaches.`);
  await run(c.env.DB, "UPDATE accounts SET coach_mode = ? WHERE id = ?", coachMode ? 1 : 0, actor.accountId);
  return c.json({ ok: true });
});

const localeSchema = z.object({ locale: z.enum(LOCALES).nullable() });

/** Language of the own account; null goes back to the app's language or the club default. */
authRoutes.put("/me/locale", async (c) => {
  const actor = requireActor(c);
  const { locale } = parse(localeSchema, await readJson(c.req.raw));
  await run(c.env.DB, "UPDATE accounts SET locale = ? WHERE id = ?", locale, actor.accountId);
  return c.json({ ok: true, locale });
});
