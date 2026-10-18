// Web Push without Node dependencies, only with the Web Crypto API.
//   * VAPID authentication per RFC 8292 (ES256 JWT)
//   * Payload encryption "aes128gcm" per RFC 8291 / RFC 8188

import { b64url, fromB64url } from "./crypto";

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm.slice(), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt.slice(), info: info.slice() }, key, length * 8);
  return new Uint8Array(bits);
}

/** Private P-256 key from the scalar d and the uncompressed public point. */
export async function importP256Private(d: string, publicKey: Uint8Array, usage: "ECDSA" | "ECDH"): Promise<CryptoKey> {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("Public key must be uncompressed (65 bytes)");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d,
    x: b64url(publicKey.slice(1, 33)),
    y: b64url(publicKey.slice(33, 65)),
    ext: false,
  };
  return usage === "ECDSA"
    ? crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
    : crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

export interface EncryptOptions {
  /** Tests only: fixed values instead of randomness. */
  salt?: Uint8Array;
  serverKeys?: { publicKey: Uint8Array; privateKey: CryptoKey };
}

/** Encrypts a message for a push subscription (a single record, rs = 4096). */
export async function encryptPayload(
  plaintext: Uint8Array,
  uaPublicB64: string,
  authSecretB64: string,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(uaPublicB64);
  const authSecret = fromB64url(authSecretB64);
  if (plaintext.length > 3993) throw new Error("Push message is too large");

  let asPublic: Uint8Array;
  let asPrivate: CryptoKey;
  if (options.serverKeys) {
    asPublic = options.serverKeys.publicKey;
    asPrivate = options.serverKeys.privateKey;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    asPrivate = pair.privateKey;
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivate, 256));

  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface Vapid {
  publicKey: string; // base64url, uncompressed point
  privateKey: CryptoKey;
  subject: string;
}

export async function loadVapid(publicKeyB64: string, privateKeyD: string, subject: string): Promise<Vapid> {
  return {
    publicKey: publicKeyB64,
    privateKey: await importP256Private(privateKeyD, fromB64url(publicKeyB64), "ECDSA"),
    subject,
  };
}

/** Authorization header per RFC 8292. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const header = b64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })),
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.privateKey, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = "sent" | "gone" | "retry" | "failed";

export async function sendWebPush(
  sub: PushSubscriptionRow,
  payload: string,
  vapid: Vapid,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; fetcher?: typeof fetch } = {},
): Promise<PushOutcome> {
  const body = await encryptPayload(encoder.encode(payload), sub.p256dh, sub.auth);
  const res = await (opts.fetcher ?? fetch)(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl ?? 86_400),
      Urgency: opts.urgency ?? "normal",
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return "gone";
  if (res.status === 429 || res.status >= 500) return "retry";
  if (!res.ok) {
    console.warn(`Push to ${new URL(sub.endpoint).host} rejected: ${res.status}`);
    return "failed";
  }
  return "sent";
}
