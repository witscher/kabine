// Saisonwechsel Schritt 1: kommende Saison korrigieren oder verwerfen.
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, loginAs, person, rows, season } from "./helpers";

let cookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  cookie = await loginAs(await person("Ada", { admin: true }));
});

describe("Kommende Saison", () => {
  it("prüft, dass sie nach der laufenden beginnt", async () => {
    const res = await api("/seasons", { cookie, body: { name: "2025/26", startsOn: "2025-07-01", endsOn: "2026-06-30" } });
    expect(res.status).toBe(400);
    expect(await rows("SELECT id FROM seasons")).toHaveLength(1);
  });

  it("lässt sich korrigieren, die Altersklassen bleiben", async () => {
    const id = (await api("/seasons", { cookie, body: { name: "2027/28", startsOn: "2027-08-01", endsOn: "2028-06-30" } })).body.id;
    expect((await api(`/seasons/${id}`, { cookie, method: "PATCH", body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } })).status).toBe(200);
    expect(await rows("SELECT name, starts_on FROM seasons WHERE id = ?", id)).toEqual([{ name: "2027/28", starts_on: "2027-07-01" }]);
    expect(await rows("SELECT code FROM age_classes WHERE season_id = ?", id)).toHaveLength(6);
    // Falsches Datum auch beim Korrigieren abgelehnt
    expect((await api(`/seasons/${id}`, { cookie, method: "PATCH", body: { name: "2027/28", startsOn: "2026-01-01", endsOn: "2028-06-30" } })).status).toBe(400);
  });

  it("lässt sich verwerfen, die laufende Saison nicht", async () => {
    const id = (await api("/seasons", { cookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } })).body.id;
    expect((await api(`/seasons/${id}`, { cookie, method: "DELETE" })).status).toBe(200);
    expect(await rows("SELECT id FROM seasons")).toEqual([{ id: 1 }]);
    expect(await rows("SELECT code FROM age_classes WHERE season_id = ?", id)).toEqual([]);
    expect((await api("/seasons/1", { cookie, method: "DELETE" })).status).toBe(409);
    // Danach kann man neu anlegen
    expect((await api("/seasons", { cookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } })).status).toBe(201);
  });

  it("nur Admins", async () => {
    const id = (await api("/seasons", { cookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } })).body.id;
    const other = await loginAs(await person("Theo"));
    expect((await api(`/seasons/${id}`, { cookie: other, method: "DELETE" })).status).toBe(403);
  });
});
