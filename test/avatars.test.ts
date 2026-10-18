// Profilbilder: Zustimmung der Eltern bei Minderjährigen, Sichtbarkeit, Entfernen.
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { needsConsent } from "../worker/routes/avatars";
import { api, freshDb, guardian, loginAs, member, one, person, season, team } from "./helpers";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 20, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 "), 0, 0]);

async function upload(personId: number, cookie: string, bytes: Uint8Array = JPEG, origin = "http://localhost:5173") {
  const res = await exports.default.fetch(
    new Request(`http://localhost:5173/api/persons/${personId}/avatar`, {
      method: "PUT",
      headers: { cookie, "content-type": "image/jpeg", origin },
      body: bytes,
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function image(path: string, cookie: string) {
  return exports.default.fetch(new Request(`http://localhost:5173/api${path}`, { headers: { cookie } }));
}

const thisYear = Number(new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 4));

let wd: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
});

describe("Volljährigkeit", () => {
  const base = { id: 1, firstName: "X", guardianIds: [] as number[] };
  it("richtet sich nach dem Geburtsjahr", () => {
    expect(needsConsent({ ...base, birthYear: 2010 }, 2026)).toBe(true);
    expect(needsConsent({ ...base, birthYear: 2008 }, 2026)).toBe(false);
    expect(needsConsent({ ...base, birthYear: 1980, guardianIds: [2] }, 2026)).toBe(false);
  });
  it("ohne Geburtsjahr gilt die Person als volljährig", () => {
    expect(needsConsent({ ...base, birthYear: null }, 2026)).toBe(false);
    expect(needsConsent({ ...base, birthYear: null, guardianIds: [2] }, 2026)).toBe(false);
  });
});

describe("Profilbilder", () => {
  it("Erwachsene laden ihr Bild direkt hoch, alle Angemeldeten sehen es", async () => {
    const coach = await person("Theo", { birthYear: 1985 });
    const other = await person("Otto", { birthYear: 1990 });
    await member(coach, wd, "coach");
    const cookie = await loginAs(coach);

    const res = await upload(coach, cookie, WEBP);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("approved");

    const otherCookie = await loginAs(other);
    const map = (await api("/avatars", { cookie: otherCookie })).body.avatars;
    expect(map[coach]).toBe(res.body.approved);
    const img = await image(`/persons/${coach}/avatar?v=${res.body.approved}`, otherCookie);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("cache-control")).toContain("immutable");

    // Ohne Anmeldung nichts
    expect((await image(`/persons/${coach}/avatar`, "")).status).toBe(401);
    // Fremde Bilder hochladen geht nicht
    expect((await upload(coach, otherCookie)).status).toBe(403);
  });

  it("prüft Format und Herkunft", async () => {
    const adult = await person("Ada", { birthYear: 1980 });
    const cookie = await loginAs(adult);
    expect((await upload(adult, cookie, new TextEncoder().encode("<svg onload=alert(1)>"))).status).toBe(400);
    expect((await upload(adult, cookie, new Uint8Array(200_000).fill(0xff))).status).toBe(413);
    expect((await upload(adult, cookie, JPEG, "https://evil.example")).status).toBe(403);
  });

  it("Bild eines Kindes wartet auf die Freigabe der Eltern", async () => {
    const kid = await person("Lina", { birthYear: thisYear - 11 });
    const mum = await person("Mara");
    const stranger = await person("Sven", { birthYear: 1980 });
    await member(kid, wd);
    await guardian(mum, kid);
    const kidCookie = await loginAs(kid);
    const mumCookie = await loginAs(mum);
    const strangerCookie = await loginAs(stranger);

    const res = await upload(kid, kidCookie);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "pending", approved: null });

    // Noch für niemanden sichtbar außer Kind und Eltern
    expect((await api("/avatars", { cookie: strangerCookie })).body.avatars[kid]).toBeUndefined();
    expect((await image(`/persons/${kid}/avatar?pending=1`, strangerCookie)).status).toBe(404);
    expect((await image(`/persons/${kid}/avatar?pending=1`, mumCookie)).status).toBe(200);
    expect((await api(`/persons/${kid}/avatar/info`, { cookie: mumCookie })).body).toMatchObject({ canApprove: true, needsConsent: true });

    // Nur Eltern geben frei
    expect((await api(`/persons/${kid}/avatar/approve`, { cookie: kidCookie, body: {} })).status).toBe(403);
    expect((await api(`/persons/${kid}/avatar/approve`, { cookie: mumCookie, body: {} })).status).toBe(200);
    expect((await api("/avatars", { cookie: strangerCookie })).body.avatars[kid]).toBeTypeOf("number");

    // Ein neues Bild des Kindes ersetzt das freigegebene erst nach der Freigabe
    const first = (await api("/avatars", { cookie: strangerCookie })).body.avatars[kid];
    await upload(kid, kidCookie, WEBP);
    expect((await api("/avatars", { cookie: strangerCookie })).body.avatars[kid]).toBe(first);
    // Ablehnen
    expect((await api(`/persons/${kid}/avatar?pending=1`, { cookie: mumCookie, method: "DELETE" })).status).toBe(200);
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM avatars WHERE person_id = ?", kid)).toEqual({ n: 1 });

    // Lädt ein Elternteil hoch, gilt das Bild sofort
    expect((await upload(kid, mumCookie, WEBP)).body.status).toBe("approved");
  });

  it("Spieler ohne Geburtsjahr lädt sein Bild selbst hoch", async () => {
    const frauen = await team("Frauen", "F");
    const adult = await person("Tom");
    await member(adult, frauen);
    await member(adult, wd, "coach");
    const cookie = await loginAs(adult);
    expect((await api(`/persons/${adult}/avatar/info`, { cookie })).body).toMatchObject({ canUpload: true, needsConsent: false });
    expect((await upload(adult, cookie)).status).toBe(201);
  });

  it("Kind ohne verknüpfte Eltern kann kein Bild hochladen", async () => {
    const kid = await person("Pia", { birthYear: thisYear - 15 });
    await member(kid, wd);
    const cookie = await loginAs(kid);
    const res = await upload(kid, cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("consent_required");
    expect((await api(`/persons/${kid}/avatar/info`, { cookie })).body).toMatchObject({ canUpload: false, hasGuardians: false });
  });

  it("Admins entfernen Bilder, beim Vereinsaustritt verschwinden sie", async () => {
    const admin = await person("Ada", { admin: true });
    const adult = await person("Ben", { birthYear: 1990 });
    await member(adult, wd);
    await upload(adult, await loginAs(adult));
    const cookie = await loginAs(admin);
    expect((await api(`/persons/${adult}/avatar`, { cookie, method: "DELETE" })).status).toBe(200);
    expect((await api("/avatars", { cookie })).body.avatars[adult]).toBeUndefined();

    await upload(adult, await loginAs(adult));
    expect((await api(`/persons/${adult}/leave`, { cookie, body: {} })).status).toBe(200);
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM avatars")).toEqual({ n: 0 });
  });
});
