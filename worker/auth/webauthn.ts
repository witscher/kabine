import { t } from "@lingui/core/macro";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { b64url, fromB64url, randomToken } from "../lib/crypto";
import { loadClub } from "../domain/club";
import { run } from "../lib/db";
import { badRequest, gone } from "../lib/http";
import { utcIso } from "../lib/time";

/**
 * Registration challenges live briefly in KV and can be used only once. Every route that starts a registration
 * needs a session, a valid invitation link or the setup password, so nobody can fill KV anonymously.
 */
const CHALLENGE_TTL_SECONDS = 300;

export interface RelyingParty {
  rpID: string;
  origin: string;
}

/**
 * RP ID and origin. Without configuration they are derived from the request
 * (workers.dev). With an own domain, set them in wrangler.jsonc, because a
 * change makes all passkeys unusable.
 */
export function relyingParty(env: Env, request: Request): RelyingParty {
  const url = new URL(request.url);
  return {
    rpID: env.RP_ID || url.hostname,
    origin: env.ORIGIN || url.origin,
  };
}

interface StoredChallenge<C> {
  challenge: string;
  purpose: "register";
  context: C;
}

async function storeChallenge<C>(kv: KVNamespace, value: StoredChallenge<C>): Promise<string> {
  const id = randomToken(18);
  await kv.put(`webauthn:${id}`, JSON.stringify(value), { expirationTtl: CHALLENGE_TTL_SECONDS });
  return id;
}

async function takeChallenge<C>(kv: KVNamespace, id: string, purpose: StoredChallenge<C>["purpose"]): Promise<StoredChallenge<C>> {
  if (!/^[\w-]{10,64}$/.test(id)) throw badRequest(t`Invalid request.`);
  const key = `webauthn:${id}`;
  const value = await kv.get<StoredChallenge<C>>(key, "json");
  if (!value || value.purpose !== purpose) {
    throw gone(t`Signing in took too long. Please try again.`, "challenge_expired");
  }
  await kv.delete(key);
  return value;
}

export function newWebauthnUserId(): string {
  return randomToken(16);
}

export async function startRegistration<C>(
  env: Env,
  request: Request,
  input: {
    webauthnUserId: string;
    userName: string;
    displayName: string;
    excludeCredentialIds?: { id: string; transports?: string[] }[];
    context: C;
  },
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const { rpID } = relyingParty(env, request);
  const options = await generateRegistrationOptions({
    rpName: (await loadClub(env.DB)).shortName,
    rpID,
    userID: fromB64url(input.webauthnUserId),
    userName: input.userName,
    userDisplayName: input.displayName,
    attestationType: "none",
    excludeCredentials: input.excludeCredentialIds ?? [],
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    timeout: 120_000,
  });
  const challengeId = await storeChallenge(env.KV, { challenge: options.challenge, purpose: "register", context: input.context });
  return { challengeId, options };
}

export interface NewCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
}

export async function finishRegistration<C>(
  env: Env,
  request: Request,
  challengeId: string,
  response: RegistrationResponseJSON,
): Promise<{ context: C; credential: NewCredential }> {
  const stored = await takeChallenge<C>(env.KV, challengeId, "register");
  const { rpID, origin } = relyingParty(env, request);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn("Passkey registration rejected", err instanceof Error ? err.message : err);
    throw badRequest(t`The passkey could not be verified. Please try again.`, "webauthn_failed");
  }
  if (!verification.verified) throw badRequest(t`The passkey could not be verified.`, "webauthn_failed");
  const info = verification.registrationInfo;
  return {
    context: stored.context,
    credential: {
      id: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports ?? response.response.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    },
  };
}

/**
 * Sign-in challenges are stateless: the sign-in page asks for one on every visit, without a login, and a KV write per
 * request would let anyone use up the account's daily KV writes (about 1,000 on the free plan). The challenge ID
 * carries the challenge, its expiry and a MAC with a key derived from APP_SECRET; only a valid passkey signature
 * books the challenge as used (D1, finishLogin).
 */
const LOGIN_CHALLENGE_VERSION = "l1";
const encoder = new TextEncoder();
const loginKeys = new Map<string, Promise<CryptoKey>>();

function loginKey(appSecret: string): Promise<CryptoKey> {
  if (!appSecret || appSecret.length < 16) throw new Error("APP_SECRET missing or too short");
  let key = loginKeys.get(appSecret);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(appSecret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("kabine-webauthn-login-v1") },
          base,
          { name: "HMAC", hash: "SHA-256", length: 256 },
          false,
          ["sign", "verify"],
        ),
      );
    loginKeys.set(appSecret, key);
  }
  return key;
}

/** "l1.<challenge>.<expiry in seconds>.<mac>" */
async function sealLoginChallenge(env: Env, challenge: string, expiresAt: number): Promise<string> {
  const body = `${LOGIN_CHALLENGE_VERSION}.${challenge}.${Math.floor(expiresAt / 1000)}`;
  const mac = await crypto.subtle.sign("HMAC", await loginKey(env.APP_SECRET), encoder.encode(body));
  return `${body}.${b64url(mac)}`;
}

export interface LoginChallenge {
  challenge: string;
  /** ms */
  expiresAt: number;
}

const tookTooLong = () => gone(t`Signing in took too long. Please try again.`, "challenge_expired");

/** Checks MAC and expiry, before anything else of a sign-in is looked at. */
export async function openLoginChallenge(env: Env, challengeId: string, now = Date.now()): Promise<LoginChallenge> {
  const match = /^(l1)\.([\w-]{16,128})\.(\d{1,12})\.([\w-]{43})$/.exec(challengeId);
  // Also an ID from before the update (KV): the app fetches a new challenge with the next tap
  if (!match) throw tookTooLong();
  const [, version, challenge, expiry, mac] = match as unknown as [string, string, string, string, string];
  const valid = await crypto.subtle.verify(
    "HMAC",
    await loginKey(env.APP_SECRET),
    fromB64url(mac),
    encoder.encode(`${version}.${challenge}.${expiry}`),
  );
  if (!valid) throw badRequest(t`Invalid request.`);
  const expiresAt = Number(expiry) * 1000;
  if (expiresAt <= now) throw tookTooLong();
  return { challenge, expiresAt };
}

export async function startLogin(
  env: Env,
  request: Request,
  now = Date.now(),
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const { rpID } = relyingParty(env, request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", timeout: 120_000 });
  const challengeId = await sealLoginChallenge(env, options.challenge, now + CHALLENGE_TTL_SECONDS * 1000);
  return { challengeId, options };
}

export interface StoredPasskey {
  id: string;
  account_id: number;
  public_key: ArrayBuffer;
  counter: number;
  transports: string | null;
}

export async function finishLogin(
  env: Env,
  request: Request,
  stored: LoginChallenge,
  response: AuthenticationResponseJSON,
  passkey: StoredPasskey,
): Promise<{ newCounter: number }> {
  const { rpID, origin } = relyingParty(env, request);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports ? (JSON.parse(passkey.transports) as AuthenticatorTransport[]) : undefined,
      },
    });
  } catch (err) {
    console.warn("Passkey login rejected", err instanceof Error ? err.message : err);
    throw badRequest(t`The sign-in could not be verified.`, "webauthn_failed");
  }
  if (!verification.verified) throw badRequest(t`The sign-in could not be verified.`, "webauthn_failed");
  // Only now, after a valid signature, a write: the challenge counts as used until it expires (no replay). One
  // statement, so two parallel requests with the same assertion cannot both pass.
  const booked = await run(
    env.DB,
    "INSERT INTO webauthn_used_challenges (challenge, expires_at) VALUES (?, ?) ON CONFLICT (challenge) DO NOTHING",
    stored.challenge,
    utcIso(stored.expiresAt),
  );
  if (!booked.meta.changes) throw tookTooLong();
  return { newCounter: verification.authenticationInfo.newCounter };
}


export { b64url };
