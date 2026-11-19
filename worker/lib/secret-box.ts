// Encrypts settings that must not lie in the database in plain text (SMTP password, SMS API key), and the context of a
// passkey registration that travels with its challenge ID (worker/auth/webauthn.ts) instead of being stored.
// AES-GCM with a key derived from APP_SECRET, one key per purpose: a database export alone does not reveal them.
import { b64url, fromB64url } from "./crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SETTINGS = "kabine-settings-v1";

async function key(appSecret: string, purpose: string): Promise<CryptoKey> {
  if (!appSecret || appSecret.length < 16) throw new Error("APP_SECRET missing or too short");
  const base = await crypto.subtle.importKey("raw", encoder.encode(appSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(purpose) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** "v1.<iv>.<ciphertext>" */
export async function seal(appSecret: string, plain: string, purpose = SETTINGS): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(appSecret, purpose), encoder.encode(plain));
  return `v1.${b64url(iv)}.${b64url(data)}`;
}

export async function open(appSecret: string, sealed: string, purpose = SETTINGS): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Unknown sealed format");
  return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await key(appSecret, purpose), fromB64url(data)));
}
