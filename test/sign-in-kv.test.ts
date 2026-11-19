// Security rule 19 (docs/dev/security.md): requests without a login write nothing to KV. Passkey sign-in with a
// software authenticator (ES256, as a phone would sign), sign-in codes per sender in D1. Invented names.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLogin } from "../worker/auth/webauthn";
import { cleanup } from "../worker/cron";
import { ipHash, mailer } from "../worker/domain/email-login";
import { b64url } from "../worker/lib/crypto";
import { utcIso } from "../worker/lib/time";
import { api, exec, freshDb, loginAs, migrateRest, one, person, rows, upgradeFrom } from "./helpers";

const ORIGIN = "http://localhost:5173";
const encoder = new TextEncoder();

beforeEach(async () => {
  await freshDb();
  vi.spyOn(mailer, "send").mockImplementation(async () => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function kvKeys(): Promise<string[]> {
  return (await env.KV.list()).keys.map((k) => k.name).sort();
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", concat(data)));
}

/** DER sequence of two integers, as WebAuthn wants ECDSA signatures (Web Crypto returns r || s). */
function derSignature(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const v = bytes.slice(i);
    const body = v[0]! & 0x80 ? concat(new Uint8Array([0]), v) : v;
    return concat(new Uint8Array([0x02, body.length]), body);
  };
  const seq = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, seq.length]), seq);
}

/** A passkey of Paula's access: key pair here, public key (COSE) in the database. */
async function passkeyOf(personId: number) {
  await loginAs(personId);
  const account = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId);
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
  // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
  const cose = concat(new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), raw.slice(1, 33), new Uint8Array([0x22, 0x58, 0x20]), raw.slice(33));
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await exec("INSERT INTO passkeys (id, account_id, public_key, counter) VALUES (?, ?, ?, 0)", id, account.id, cose);
  return {
    async assertion(challenge: string) {
      const clientData = encoder.encode(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
      // rpIdHash, flags user present + verified, counter 0 (synced passkeys keep it at 0, so it prevents no replay)
      const authData = concat(await sha256(encoder.encode("localhost")), new Uint8Array([0x05, 0, 0, 0, 0]));
      const signed = concat(authData, await sha256(clientData));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
      return {
        id,
        rawId: id,
        type: "public-key",
        response: { authenticatorData: b64url(authData), clientDataJSON: b64url(clientData), signature: b64url(derSignature(sig)) },
        clientExtensionResults: {},
      };
    },
  };
}

async function options(): Promise<{ challengeId: string; challenge: string }> {
  const res = await api("/auth/login/options", { body: {} });
  expect(res.status).toBe(200);
  return { challengeId: res.body.challengeId, challenge: res.body.options.challenge };
}

describe("19: passkey sign-in without KV", () => {
  it("login/options writes nothing to KV", async () => {
    const before = await kvKeys();
    for (let i = 0; i < 5; i++) await options();
    expect(await kvKeys()).toEqual(before);
    expect(await rows("SELECT * FROM webauthn_used_challenges")).toHaveLength(0);
  });

  it("signs in with a valid assertion and books the challenge only then, in D1", async () => {
    const key = await passkeyOf(await person("Paula", { lastName: "Pfeil" }));
    const before = await kvKeys();
    const { challengeId, challenge } = await options();
    const res = await api("/auth/login/verify", { body: { challengeId, response: await key.assertion(challenge) } });
    expect(res.status).toBe(200);
    expect(await kvKeys()).toEqual(before);
    expect(await rows("SELECT challenge FROM webauthn_used_challenges")).toEqual([{ challenge }]);
  });

  it("a replayed assertion fails", async () => {
    const key = await passkeyOf(await person("Paula", { lastName: "Pfeil" }));
    const { challengeId, challenge } = await options();
    const body = { challengeId, response: await key.assertion(challenge) };
    expect((await api("/auth/login/verify", { body })).status).toBe(200);
    const sessions = await rows("SELECT id FROM sessions");
    const replay = await api("/auth/login/verify", { body });
    expect(replay.status).toBe(410);
    expect(replay.body.error.code).toBe("challenge_expired");
    // Also in parallel, only one of them gets in
    const next = await options();
    const twice = { challengeId: next.challengeId, response: await key.assertion(next.challenge) };
    const both = await Promise.all([api("/auth/login/verify", { body: twice }), api("/auth/login/verify", { body: twice })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(await rows("SELECT id FROM sessions")).toHaveLength(sessions.length + 1);
  });

  it("an expired challenge fails, even with a valid signature", async () => {
    const key = await passkeyOf(await person("Paula", { lastName: "Pfeil" }));
    const old = await startLogin(env, new Request(`${ORIGIN}/api/auth/login/options`), Date.now() - 6 * 60_000);
    const res = await api("/auth/login/verify", { body: { challengeId: old.challengeId, response: await key.assertion(old.options.challenge) } });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("challenge_expired");
    expect(await rows("SELECT * FROM webauthn_used_challenges")).toHaveLength(0);
  });

  it("a tampered challenge fails", async () => {
    const key = await passkeyOf(await person("Paula", { lastName: "Pfeil" }));
    const { challengeId, challenge } = await options();
    const [version, , expiry, mac] = challengeId.split(".");
    // Own challenge, signed by the passkey, under the MAC of another one
    const own = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const forged = await api("/auth/login/verify", { body: { challengeId: `${version}.${own}.${expiry}.${mac}`, response: await key.assertion(own) } });
    expect(forged.status).toBe(400);
    // Longer lifetime under the same MAC
    const later = await api("/auth/login/verify", {
      body: { challengeId: `${version}.${challenge}.${Number(expiry) + 3600}.${mac}`, response: await key.assertion(challenge) },
    });
    expect(later.status).toBe(400);
    // A signature over another challenge than the one in the ID
    const other = await api("/auth/login/verify", { body: { challengeId, response: await key.assertion(own) } });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe("webauthn_failed");
    expect(await rows("SELECT * FROM sessions")).toHaveLength(1); // only the one passkeyOf created
    // The untouched challenge still works
    expect((await api("/auth/login/verify", { body: { challengeId, response: await key.assertion(challenge) } })).status).toBe(200);
  });

  it("the hourly clean-up removes expired challenges", async () => {
    await exec("INSERT INTO webauthn_used_challenges (challenge, expires_at) VALUES ('old', ?), ('new', ?)", utcIso(Date.now() - 1000), utcIso(Date.now() + 60_000));
    await cleanup(env.DB);
    expect(await rows("SELECT challenge FROM webauthn_used_challenges")).toEqual([{ challenge: "new" }]);
  });
});

async function codeRequest(email: string, ip: string) {
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}/api/auth/email/start`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email }),
    }),
  );
  return res.status;
}

describe("19: sign-in codes without KV", () => {
  it("counts the limit per sender in D1, not in KV", async () => {
    const before = await kvKeys();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push(await codeRequest(`nobody${i}@example.org`, "203.0.113.7"));
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(409);
    // Another sender is not affected
    expect(await codeRequest("nobody-else@example.org", "203.0.113.8")).toBe(200);
    expect(await kvKeys()).toEqual(before);
    // The database keeps a keyed hash, never the address
    const stored = await rows<{ ip_hash: string }>("SELECT DISTINCT ip_hash FROM email_codes");
    expect(stored.map((r) => r.ip_hash).join()).not.toContain("203.0.113");
  });

  it("an IPv6 connection counts by its /64 prefix", async () => {
    expect(await ipHash(env, "2001:db8:1:2::1")).toBe(await ipHash(env, "2001:0db8:0001:0002:ffff:1:2:3"));
    expect(await ipHash(env, "2001:db8:1:2::1")).not.toBe(await ipHash(env, "2001:db8:1:3::1"));
    expect(await ipHash(env, "203.0.113.7")).not.toBe(await ipHash(env, "203.0.113.8"));
    for (let i = 0; i < 20; i++) expect(await codeRequest(`nobody${i}@example.org`, `2001:db8:1:2::${i.toString(16)}`)).toBe(200);
    expect(await codeRequest("nobody-more@example.org", "2001:db8:1:2:abcd::1")).toBe(409);
  });

  it("counting per sender and emptying the hash use the index, not every code", async () => {
    const plans = async (sql: string, ...params: unknown[]) =>
      (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((r) => r.detail).join(" | ");
    expect(await plans("SELECT count(*) FROM email_codes WHERE ip_hash = ? AND created_at > ?", "x", utcIso())).toMatch(/USING (COVERING )?INDEX email_codes_ip/);
    expect(await plans("UPDATE email_codes SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?", utcIso())).toMatch(/INDEX email_codes_ip/);
  });

  it("the hourly clean-up empties the sender's hash after an hour", async () => {
    await codeRequest("nobody@example.org", "203.0.113.7");
    await exec("UPDATE email_codes SET created_at = ?", utcIso(Date.now() - 2 * 3_600_000));
    await codeRequest("nobody2@example.org", "203.0.113.7");
    await cleanup(env.DB);
    expect((await rows<{ ip_hash: string | null }>("SELECT ip_hash FROM email_codes ORDER BY id")).map((r) => r.ip_hash === null)).toEqual([true, false]);
  });
});

describe("migration 202611191515_core_sign-in-without-kv.sql", () => {
  it("keeps the codes a club has and adds the sender column empty", async () => {
    await upgradeFrom("202611191515_core_sign-in-without-kv.sql");
    await exec(
      "INSERT INTO email_codes (request_id, purpose, email, token_hash, code_hash, expires_at) VALUES ('r1', 'login', 'nobody@example.org', 't1', 'c1', ?)",
      utcIso(Date.now() + 600_000),
    );
    await migrateRest();
    expect(await rows("SELECT request_id, ip_hash FROM email_codes")).toEqual([{ request_id: "r1", ip_hash: null }]);
    expect(await rows("SELECT * FROM webauthn_used_challenges")).toEqual([]);
  });
});
