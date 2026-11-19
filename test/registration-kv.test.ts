// Security rule 19 (docs/dev/security.md): starting a passkey registration with an invitation link writes nothing to
// KV. The challenge ID carries the sealed context; a verified passkey books the challenge in D1, so it works once.
// Registration with a software authenticator (ES256, attestation "none"). Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { b64url } from "../worker/lib/crypto";
import { api, freshDb, loginAs, member, one, person, rows, season, team } from "./helpers";

const ORIGIN = "http://localhost:5173";
const encoder = new TextEncoder();

let wd: number;
let ida: number;
let token: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  const coach = await person("Doris");
  await member(coach, wd, "coach");
  ida = await person("Ida", { lastName: "Probe", birthYear: 2014 });
  await member(ida, wd);
  const link = await api(`/teams/${wd}/invites`, { cookie: await loginAs(coach), body: { kind: "player" } });
  token = String(link.body.url).split("#")[1]!;
});

async function kvKeys(): Promise<string[]> {
  return (await env.KV.list()).keys.map((k) => k.name).sort();
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

/** A registration response as a phone would send it: attestation "none", a new ES256 key. */
async function registration(challenge: string) {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
  const cose = concat(new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), raw.slice(1, 33), new Uint8Array([0x22, 0x58, 0x20]), raw.slice(33));
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode("localhost")));
  // flags: user present, user verified, attested credential data; counter 0; AAGUID zero
  const authData = concat(rpIdHash, new Uint8Array([0x45, 0, 0, 0, 0]), new Uint8Array(16), new Uint8Array([0, credId.length]), credId, cose);
  // CBOR {"fmt": "none", "attStmt": {}, "authData": bytes}
  const attestation = concat(
    new Uint8Array([0xa3, 0x63]),
    encoder.encode("fmt"),
    new Uint8Array([0x64]),
    encoder.encode("none"),
    new Uint8Array([0x67]),
    encoder.encode("attStmt"),
    new Uint8Array([0xa0, 0x68]),
    encoder.encode("authData"),
    new Uint8Array([0x59, authData.length >> 8, authData.length & 0xff]),
    authData,
  );
  const clientData = encoder.encode(JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: false }));
  const id = b64url(credId);
  return {
    id,
    rawId: id,
    type: "public-key",
    response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestation), transports: ["internal"] },
    clientExtensionResults: {},
  };
}

describe("passkey registration without KV", () => {
  it("/join/options writes nothing to KV, and the context in the challenge ID cannot be read", async () => {
    const before = await kvKeys();
    for (let i = 0; i < 5; i++) {
      const res = await api("/join/options", { body: { token, personId: ida, email: "ida.probe@example.org" } });
      expect(res.status).toBe(200);
      expect(res.body.challengeId).toMatch(/^r1\./);
      expect(res.body.challengeId).not.toContain("example.org");
      expect(atob(res.body.challengeId.split(".").at(-1)!.replace(/-/g, "+").replace(/_/g, "/"))).not.toContain("ida.probe");
    }
    expect(await kvKeys()).toEqual(before);
  });

  it("a verified passkey sets up the access once; a replay, a changed or an old challenge ID does not", async () => {
    const start = await api("/join/options", { body: { token, personId: ida } });
    const response = await registration(start.body.options.challenge);

    // Changed by the client: one character of the sealed part
    const id: string = start.body.challengeId;
    const flipped = id.slice(0, -2) + (id.at(-2) === "A" ? "B" : "A") + id.at(-1);
    expect((await api("/join/verify", { body: { challengeId: flipped, response } })).status).toBe(400);
    // An ID from before the update (KV): start again
    expect((await api("/join/verify", { body: { challengeId: "abcdefghijklmnopqrstuvwx", response } })).body.error.code).toBe("challenge_expired");

    const kvBefore = await kvKeys();
    const done = await api("/join/verify", { body: { challengeId: id, response } });
    expect(done.status).toBe(200);
    expect(await kvKeys()).toEqual(kvBefore);
    const account = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", ida);
    expect(await rows("SELECT id FROM passkeys WHERE account_id = ?", account.id)).toEqual([{ id: response.id }]);
    expect(await rows("SELECT challenge FROM webauthn_used_challenges")).toEqual([{ challenge: start.body.options.challenge }]);

    // The same response again
    const replay = await api("/join/verify", { body: { challengeId: id, response } });
    expect(replay.status).toBe(410);
    expect(replay.body.error.code).toBe("challenge_expired");
  });
});
