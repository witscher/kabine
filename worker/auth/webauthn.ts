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
import { badRequest, gone } from "../lib/http";

/** Challenges live briefly in KV and can be used only once. */
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
  purpose: "register" | "login";
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

export async function startLogin(
  env: Env,
  request: Request,
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const { rpID } = relyingParty(env, request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", timeout: 120_000 });
  const challengeId = await storeChallenge(env.KV, { challenge: options.challenge, purpose: "login", context: null });
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
  challengeId: string,
  response: AuthenticationResponseJSON,
  passkey: StoredPasskey,
): Promise<{ newCounter: number }> {
  const stored = await takeChallenge<null>(env.KV, challengeId, "login");
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
  return { newCounter: verification.authenticationInfo.newCounter };
}


export { b64url };
