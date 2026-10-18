import { t } from "@lingui/core/macro";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { requireActor } from "../app";
import { assertInviteAllowed } from "../auth/owner";
import { createSession, sessionCookie } from "../auth/session";
import { finishRegistration, newWebauthnUserId, relyingParty, startRegistration } from "../auth/webauthn";
import { loadClub, rememberOrigin, saveClub } from "../domain/club";
import { emailSchema, issueEmailCode, mailer } from "../domain/email-login";
import { findValidInvite, type InviteRow } from "../domain/invites";
import { safeEqual } from "../lib/crypto";
import { all, first, list, run, stmt } from "../lib/db";
import { ApiError, badRequest, conflict, forbidden, gone, parse, readJson } from "../lib/http";
import { utcIso } from "../lib/time";
import { distinctShortNames } from "../../shared/names";
import { insertPasskey } from "./auth";
import { withLocale } from "../i18n";

/** email: address for sign-in. Required as soon as a new access is created. */
export type JoinContext =
  | { kind: "player"; inviteId: number; personId: number; userId: string; email: string | null }
  | { kind: "parent"; inviteId: number; firstName: string; lastName: string; childIds: number[]; userId: string; email: string | null }
  | {
      kind: "personal";
      inviteId: number;
      personId: number;
      accountId: number | null;
      userId: string;
      revokeExisting: boolean;
      email: string | null;
    }
  | { kind: "bootstrap"; personId: number; userId: string; email: string | null };

function fullName(first: string, last: string | null): string {
  return last ? `${first} ${last}` : first;
}

async function teamName(db: D1Database, teamId: number): Promise<string> {
  return (await first<{ name: string }>(db, "SELECT name FROM teams WHERE id = ?", teamId))?.name ?? "";
}

async function teamPlayers(db: D1Database, teamId: number) {
  return all<{ id: number; first_name: string; last_name: string | null; birth_year: number | null; has_account: number }>(
    db,
    `SELECT p.id, p.first_name, p.last_name, p.birth_year, EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id) AS has_account
       FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND tm.role = 'player' AND p.is_former = 0
      ORDER BY p.first_name, p.last_name, p.id`,
    teamId,
  );
}

const nameSchema = z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(50, { error: () => t`The name is too long.` });
const tokenSchema = z.object({ token: z.string().min(1) });
const verifySchema = z.object({ challengeId: z.string().min(1), response: z.record(z.string(), z.unknown()) });

export const joinRoutes = new Hono<AppEnv>();

joinRoutes.post("/join/info", async (c) => {
  const { token } = parse(tokenSchema, await readJson(c.req.raw));
  const invite = await findValidInvite(c.env, token);
  const actor = c.get("actor");
  const loggedInAs = actor ? fullName(actor.firstName, actor.lastName) : null;

  if (invite.kind === "player" || invite.kind === "parent") {
    const players = await teamPlayers(c.env.DB, invite.team_id!);
    const linked = actor
      ? new Set(
          (
            await all<{ child_id: number }>(c.env.DB, "SELECT child_id FROM guardianships WHERE guardian_id = ?", actor.personId)
          ).map((g) => g.child_id),
        )
      : new Set<number>();
    // Anyone holding the link sees this list, also without login: short names only
    const names = distinctShortNames(players);
    return c.json({
      kind: invite.kind,
      team: { id: invite.team_id, name: await teamName(c.env.DB, invite.team_id!) },
      expiresAt: invite.expires_at,
      loggedInAs,
      persons: players.map((p, i) => ({
        id: p.id,
        name: names[i]!,
        taken: invite.kind === "player" ? p.has_account === 1 : false,
        linkedToMe: linked.has(p.id),
      })),
    });
  }

  const person = await first<{ first_name: string; last_name: string | null; has_account: number; is_admin: number }>(
    c.env.DB,
    "SELECT first_name, last_name, is_admin, EXISTS (SELECT 1 FROM accounts WHERE person_id = persons.id) AS has_account FROM persons WHERE id = ?",
    invite.person_id,
  );
  return c.json({
    kind: "personal",
    expiresAt: invite.expires_at,
    loggedInAs,
    person: { name: fullName(person!.first_name, person!.last_name), hasAccount: person!.has_account === 1, isAdmin: person!.is_admin === 1 },
    revokeExisting: person!.has_account === 1,
  });
});

const optionsSchema = z.object({
  token: z.string().min(1),
  personId: z.number().int().positive().optional(),
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  childIds: z.array(z.number().int().positive()).max(10).optional(),
  email: z.union([emailSchema, z.literal("")]).optional(),
});

type JoinInput = z.infer<typeof optionsSchema>;
/** Required only for access by e-mail code and for admins; otherwise the passkey is enough (replacement via the coach's personal link). */
const emailRequired = () => t`Please enter your e-mail address. We will send the code there.`;
const adminEmailRequired = () => t`Please enter your e-mail address. It is required for admins.`;

/**
 * Checks an invitation link including the selection and describes the access
 * to be created. Shared by passkey and e-mail code.
 */
async function buildJoinContext(env: Env, input: JoinInput): Promise<{ context: JoinContext; name: string; exclude: { id: string }[] }> {
  const invite = await findValidInvite(env, input.token);
  const email = input.email || null;

  if (invite.kind === "player") {
    if (!input.personId) throw badRequest(t`Please select who you are.`);
    const players = await teamPlayers(env.DB, invite.team_id!);
    const person = players.find((p) => p.id === input.personId);
    if (!person) throw badRequest(t`This person does not belong to this team.`);
    if (person.has_account) throw conflict(t`There is already an access for this person. Contact your coach.`, "person_taken");
    const context: JoinContext = { kind: "player", inviteId: invite.id, personId: person.id, userId: newWebauthnUserId(), email };
    return { context, name: fullName(person.first_name, person.last_name), exclude: [] };
  }

  if (invite.kind === "parent") {
    if (!input.firstName || !input.lastName) throw badRequest(t`Please enter your first and last name.`);
    const childIds = [...new Set(input.childIds ?? [])];
    if (!childIds.length) throw badRequest(t`Please select at least one child.`);
    const players = await teamPlayers(env.DB, invite.team_id!);
    if (!childIds.every((id) => players.some((p) => p.id === id))) throw badRequest(t`Invalid selection.`);
    await assertGuardianCapacity(env.DB, childIds, null);
    const context: JoinContext = {
      kind: "parent",
      inviteId: invite.id,
      firstName: input.firstName,
      lastName: input.lastName,
      childIds,
      userId: newWebauthnUserId(),
      email,
    };
    return { context, name: `${input.firstName} ${input.lastName}`, exclude: [] };
  }

  // Personal link: new passkey (or e-mail) for an existing person.
  const person = await first<{ id: number; first_name: string; last_name: string | null; is_admin: number }>(
    env.DB,
    "SELECT id, first_name, last_name, is_admin FROM persons WHERE id = ? AND is_former = 0",
    invite.person_id,
  );
  if (!person) throw gone(t`This person no longer exists.`);
  // Only a link created by the owner restores the owner's access
  await assertInviteAllowed(env.DB, invite.id, person.id);
  const account = await first<{ id: number; webauthn_user_id: string; email: string | null; email_verified_at: string | null }>(
    env.DB,
    "SELECT id, webauthn_user_id, email, email_verified_at FROM accounts WHERE person_id = ?",
    person.id,
  );
  if (!account && !email && person.is_admin) throw badRequest(adminEmailRequired(), "email_required");
  // A link never replaces a confirmed address: whoever holds it could otherwise take over the e-mail login
  if (account?.email_verified_at && email && email !== account.email) {
    throw badRequest(t`A confirmed e-mail address is already stored for this access. Use this address or set up a passkey.`, "email_locked");
  }
  // Taking over an existing account always signs out its previous devices, so the owner notices
  const context: JoinContext = {
    kind: "personal",
    inviteId: invite.id,
    personId: person.id,
    accountId: account?.id ?? null,
    userId: account?.webauthn_user_id ?? newWebauthnUserId(),
    revokeExisting: !!account,
    email,
  };
  return { context, name: fullName(person.first_name, person.last_name), exclude: [] };
}

joinRoutes.post("/join/options", async (c) => {
  const input = parse(optionsSchema, await readJson(c.req.raw));
  const { context, name, exclude } = await buildJoinContext(c.env, input);
  return c.json(
    await startRegistration(c.env, c.req.raw, {
      webauthnUserId: context.userId,
      userName: name,
      displayName: name,
      excludeCredentialIds: exclude,
      context,
    }),
  );
});

/** Access without passkey: code to the given address, redeemed via /auth/email/verify. */
joinRoutes.post("/join/email", async (c) => {
  const input = parse(optionsSchema, await readJson(c.req.raw));
  if (!input.email) throw badRequest(emailRequired(), "email_required");
  const { context } = await buildJoinContext(c.env, input);
  const requestId = await issueEmailCode(c.env, {
    purpose: "join",
    email: input.email,
    context,
    origin: relyingParty(c.env, c.req.raw).origin,
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  return c.json({ requestId });
});

async function stillValid(env: Env, inviteId: number): Promise<InviteRow> {
  const invite = await first<InviteRow>(env.DB, "SELECT * FROM invites WHERE id = ?", inviteId);
  if (!invite || invite.revoked_at || invite.used_at || Date.parse(invite.expires_at) <= Date.now()) {
    throw gone(t`This invitation link is no longer valid. Please ask for a new link.`, "invite_expired");
  }
  return invite;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

type Credential = Parameters<typeof insertPasskey>[2];

/**
 * Creates or completes the access: with a passkey (credential) or without,
 * if the sign-in was confirmed with an e-mail code (emailVerified).
 */
export async function finishJoin(
  env: Env,
  request: Request,
  context: JoinContext,
  credential: Credential | null,
  emailVerified = false,
): Promise<number> {
  const accountId = await createJoinAccount(env, request, context, credential);
  if (context.email) {
    await run(
      env.DB,
      `UPDATE accounts SET email = ?1, email_verified_at = CASE WHEN ?2 IS NOT NULL THEN ?2
         WHEN email = ?1 THEN email_verified_at ELSE NULL END
        WHERE id = ?3 AND (email_verified_at IS NULL OR email = ?1)`,
      context.email,
      emailVerified ? utcIso() : null,
      accountId,
    );
  }
  return accountId;
}

/** After a passkey access, have the given address confirmed (sending errors block nothing). */
export async function requestEmailConfirmation(env: Env, request: Request, accountId: number): Promise<void> {
  const account = await first<{ email: string | null; email_verified_at: string | null }>(
    env.DB,
    "SELECT email, email_verified_at FROM accounts WHERE id = ?",
    accountId,
  );
  if (!account?.email || account.email_verified_at) return;
  try {
    await issueEmailCode(env, {
      purpose: "verify",
      email: account.email,
      accountId,
      origin: relyingParty(env, request).origin,
      ip: request.headers.get("cf-connecting-ip"),
    });
  } catch (err) {
    console.warn("Confirmation e-mail not sent", err);
  }
}

/** Tells the owner of an account by e-mail that a personal link signed in a new device and signed out the old ones. */
async function notifyNewDevice(env: Env, accountId: number): Promise<void> {
  const account = await first<{ email: string | null; email_verified_at: string | null; locale: string | null }>(
    env.DB,
    "SELECT email, email_verified_at, locale FROM accounts WHERE id = ?",
    accountId,
  );
  if (!account?.email || !account.email_verified_at) return;
  const club = await loadClub(env.DB);
  const app = club.shortName;
  // In the language of the account's owner
  const { subject, text } = withLocale(account.locale, () => ({
    subject: t`New device for your access to ${app}`,
    text: `${t`Hello,`}\n\n${t`a new device has just been set up for your access via a personal link. Your previous devices have been signed out.`}\n\n${t`If this was not you, please contact your coach or an admin immediately.`}\n`,
  }));
  try {
    await mailer.send(env, { to: account.email, subject, text });
  } catch (err) {
    console.warn("New device notice not sent", err instanceof Error ? err.message : err);
  }
}

async function createJoinAccount(env: Env, request: Request, context: JoinContext, credential: Credential | null): Promise<number> {
  const db = env.DB;
  const ua = request.headers.get("user-agent");
  const addPasskey = async (accountId: number) => {
    if (credential) await insertPasskey(db, accountId, credential, ua);
  };

  if (context.kind === "player") {
    const invite = await stillValid(env, context.inviteId);
    const isPlayer = await first(
      db,
      "SELECT 1 AS ok FROM team_memberships WHERE person_id = ? AND team_id = ? AND role = 'player'",
      context.personId,
      invite.team_id,
    );
    if (!isPlayer) throw badRequest(t`This person does not (or no longer) belong to this team.`);
    let accountId: number;
    try {
      accountId = (await first<{ id: number }>(
        db,
        "INSERT INTO accounts (person_id, webauthn_user_id) VALUES (?, ?) RETURNING id",
        context.personId,
        context.userId,
      ))!.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(t`An access has just been created for this person.`, "person_taken");
      throw err;
    }
    await addPasskey(accountId);
    return accountId;
  }

  if (context.kind === "parent") {
    const invite = await stillValid(env, context.inviteId);
    const valid = await all<{ person_id: number }>(
      db,
      `SELECT person_id FROM team_memberships WHERE team_id = ? AND role = 'player'
         AND person_id IN (SELECT value FROM json_each(?))`,
      invite.team_id,
      list(context.childIds),
    );
    if (valid.length !== context.childIds.length) throw badRequest(t`The selection of children is no longer valid.`);
    await assertGuardianCapacity(db, context.childIds, null);
    const person = await first<{ id: number }>(
      db,
      "INSERT INTO persons (first_name, last_name) VALUES (?, ?) RETURNING id",
      context.firstName,
      context.lastName,
    );
    try {
      const account = await first<{ id: number }>(
        db,
        "INSERT INTO accounts (person_id, webauthn_user_id) VALUES (?, ?) RETURNING id",
        person!.id,
        context.userId,
      );
      await db.batch(
        context.childIds.map((childId) =>
          stmt(db, "INSERT OR IGNORE INTO guardianships (guardian_id, child_id) VALUES (?, ?)", person!.id, childId),
        ),
      );
      await addPasskey(account!.id);
      return account!.id;
    } catch (err) {
      await run(db, "DELETE FROM persons WHERE id = ?", person!.id);
      throw err;
    }
  }

  if (context.kind === "personal") {
    await stillValid(env, context.inviteId);
    let accountId = context.accountId;
    if (accountId == null) {
      try {
        accountId = (await first<{ id: number }>(
          db,
          "INSERT INTO accounts (person_id, webauthn_user_id) VALUES (?, ?) RETURNING id",
          context.personId,
          context.userId,
        ))!.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(t`There is now an access for this person. Please ask for a new link.`);
        throw err;
      }
    } else {
      await notifyNewDevice(env, accountId);
      await db.batch([
        stmt(db, "DELETE FROM passkeys WHERE account_id = ?", accountId),
        stmt(db, "DELETE FROM sessions WHERE account_id = ?", accountId),
        stmt(db, "DELETE FROM push_subscriptions WHERE account_id = ?", accountId),
      ]);
    }
    await addPasskey(accountId);
    await run(db, "UPDATE invites SET used_at = ? WHERE id = ?", utcIso(), context.inviteId);
    return accountId;
  }

  // Admin bootstrap
  const used = await first(db, "SELECT 1 AS used FROM app_meta WHERE key = 'bootstrap_used_at'");
  if (used) throw gone(t`The setup link has already been used.`);
  let accountId: number;
  try {
    accountId = (await first<{ id: number }>(
      db,
      "INSERT INTO accounts (person_id, webauthn_user_id) VALUES (?, ?) RETURNING id",
      context.personId,
      context.userId,
    ))!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw gone(t`The admin access is already set up.`);
    throw err;
  }
  await addPasskey(accountId);
  await run(db, "INSERT INTO app_meta (key, value) VALUES ('bootstrap_used_at', ?)", utcIso());
  return accountId;
}

joinRoutes.post("/join/verify", async (c) => {
  const { challengeId, response } = parse(verifySchema, await readJson(c.req.raw));
  const { context, credential } = await finishRegistration<JoinContext>(
    c.env,
    c.req.raw,
    challengeId,
    response as unknown as RegistrationResponseJSON,
  );
  if (context.kind === "bootstrap") throw badRequest(t`Invalid request.`);
  const accountId = await finishJoin(c.env, c.req.raw, context, credential);
  c.executionCtx.waitUntil(requestEmailConfirmation(c.env, c.req.raw, accountId));
  const session = await createSession(c.env.DB, accountId, c.req.header("user-agent") ?? null);
  c.header("Set-Cookie", sessionCookie(session.token, session.expiresAt), { append: true });
  return c.json({ ok: true, kind: context.kind });
});

/** At most two parents per child via parent links (admins can link more). */
export const MAX_GUARDIANS = 2;

async function assertGuardianCapacity(db: D1Database, childIds: number[], guardianId: number | null): Promise<void> {
  const full = await all<{ first_name: string }>(
    db,
    `SELECT p.first_name FROM persons p
      WHERE p.id IN (SELECT value FROM json_each(?1))
        AND (SELECT count(*) FROM guardianships g WHERE g.child_id = p.id AND g.guardian_id IS NOT ?2) >= ?3
        AND NOT EXISTS (SELECT 1 FROM guardianships g WHERE g.child_id = p.id AND g.guardian_id IS ?2)`,
    list(childIds),
    guardianId,
    MAX_GUARDIANS,
  );
  if (full.length) {
    const and = t`and`;
    const names = full.map((f) => f.first_name).join(` ${and} `);
    throw conflict(t`Two parents are already registered for ${names}. Please contact the coaches.`, "child_full");
  }
}

const linkSchema = z.object({ token: z.string().min(1), childIds: z.array(z.number().int().positive()).min(1).max(10) });

/** Signed-in parents link another child via a parent link. */
joinRoutes.post("/join/link-children", async (c) => {
  const actor = requireActor(c);
  const { token, childIds } = parse(linkSchema, await readJson(c.req.raw));
  const invite = await findValidInvite(c.env, token);
  if (invite.kind !== "parent") throw badRequest(t`This is not a parent link.`);
  if (childIds.includes(actor.personId)) throw badRequest(t`You cannot link yourself as a child.`);
  const players = await teamPlayers(c.env.DB, invite.team_id!);
  if (!childIds.every((id) => players.some((p) => p.id === id))) throw badRequest(t`Invalid selection.`);
  await assertGuardianCapacity(c.env.DB, childIds, actor.personId);
  await c.env.DB.batch(
    childIds.map((childId) =>
      stmt(c.env.DB, "INSERT OR IGNORE INTO guardianships (guardian_id, child_id) VALUES (?, ?)", actor.personId, childId),
    ),
  );
  return c.json({ ok: true });
});

// Admin bootstrap -----------------------------------------------------------

/** First admin of the installation; null on a fresh installation (the setup creates it). */
async function bootstrapPerson(env: Env, token: string) {
  const expected = env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expected || expected.length < 16) throw new ApiError(404, "bootstrap_disabled", t`Setup is not enabled.`);
  if (!safeEqual(token, expected)) throw forbidden(t`This setup link is invalid.`);
  const used = await first(env.DB, "SELECT 1 AS used FROM app_meta WHERE key = 'bootstrap_used_at'");
  if (used) throw gone(t`The setup link has already been used. Sign in with your passkey.`, "bootstrap_used");
  return first<{ id: number; first_name: string; last_name: string | null; admin_email: string | null }>(
    env.DB,
    "SELECT id, first_name, last_name, admin_email FROM persons WHERE is_admin = 1 AND is_former = 0 ORDER BY id LIMIT 1",
  );
}

joinRoutes.post("/bootstrap/info", async (c) => {
  const { token } = parse(tokenSchema, await readJson(c.req.raw));
  const person = await bootstrapPerson(c.env, token);
  // Without a person, the setup asks for name and e-mail of the first admin
  return c.json(person ? { name: fullName(person.first_name, person.last_name), email: person.admin_email, needsPerson: false } : { name: null, email: null, needsPerson: true });
});

const bootstrapOptionsSchema = tokenSchema.extend({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  email: emailSchema.optional(),
});

joinRoutes.post("/bootstrap/options", async (c) => {
  const input = parse(bootstrapOptionsSchema, await readJson(c.req.raw));
  let person = await bootstrapPerson(c.env, input.token);
  if (!person) {
    if (!input.firstName || !input.lastName || !input.email) throw badRequest(t`Please enter first name, last name and e-mail address.`);
    person = await first<{ id: number; first_name: string; last_name: string | null; admin_email: string | null }>(
      c.env.DB,
      "INSERT INTO persons (first_name, last_name, is_admin, admin_email) VALUES (?, ?, 1, ?) RETURNING id, first_name, last_name, admin_email",
      input.firstName,
      input.lastName,
      input.email.toLowerCase(),
    );
  }
  const name = fullName(person!.first_name, person!.last_name);
  const context: JoinContext = { kind: "bootstrap", personId: person!.id, userId: newWebauthnUserId(), email: person!.admin_email?.toLowerCase() ?? null };
  return c.json(
    await startRegistration(c.env, c.req.raw, {
      webauthnUserId: context.userId,
      userName: person!.admin_email ?? name,
      displayName: name,
      context,
    }),
  );
});

joinRoutes.post("/bootstrap/verify", async (c) => {
  const { challengeId, response } = parse(verifySchema, await readJson(c.req.raw));
  const { context, credential } = await finishRegistration<JoinContext>(
    c.env,
    c.req.raw,
    challengeId,
    response as unknown as RegistrationResponseJSON,
  );
  if (context.kind !== "bootstrap") throw badRequest(t`Invalid request.`);
  const accountId = await finishJoin(c.env, c.req.raw, context, credential);
  // The person who sets up the installation is its protected owner
  if ((await loadClub(c.env.DB)).ownerPersonId === null) await saveClub(c.env.DB, { ownerPersonId: context.personId });
  await rememberOrigin(c.env.DB, new URL(c.req.url).origin);
  c.executionCtx.waitUntil(requestEmailConfirmation(c.env, c.req.raw, accountId));
  const session = await createSession(c.env.DB, accountId, c.req.header("user-agent") ?? null);
  c.header("Set-Cookie", sessionCookie(session.token, session.expiresAt), { append: true });
  return c.json({ ok: true });
});
