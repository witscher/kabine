// Letzte Aktivität am Zugang: tagesgenau, gesetzt bei Anmeldung und täglicher Verlängerung. Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, extendSessionIfDue, findSession, ABSOLUTE_MS } from "../worker/auth/session";
import { todayLocal } from "../worker/lib/time";
import { api, exec, freshDb, loginAs, one, person, season } from "./helpers";

const DAY = 86_400_000;
let admin: number;
let lina: number;
let ole: number;

beforeEach(async () => {
  await freshDb();
  await season();
  admin = await person("Ada", { admin: true });
  lina = await person("Lina");
  ole = await person("Ole");
});

async function account(personId: number): Promise<number> {
  return (await one<{ id: number }>("INSERT INTO accounts (person_id, webauthn_user_id) VALUES (?, ?) RETURNING id", personId, `uid-${personId}`)).id;
}

async function seen(accountId: number): Promise<string | null> {
  return (await one<{ last_seen_on: string | null }>("SELECT last_seen_on FROM accounts WHERE id = ?", accountId)).last_seen_on;
}

describe("Letzte Aktivität", () => {
  it("Anmeldung setzt das Datum, die tägliche Verlängerung schreibt es fort", async () => {
    const acc = await account(lina);
    expect(await seen(acc)).toBeNull();
    const start = Date.parse("2026-10-01T10:00:00Z");
    const { token } = await createSession(env.DB, acc, null, start);
    expect(await seen(acc)).toBe(todayLocal(start));

    // Am selben Tag keine weitere Schreibung
    let session = (await findSession(env.DB, token, start + 3_600_000))!;
    expect(await extendSessionIfDue(env.DB, session, start + 3_600_000)).toBeNull();
    expect(await seen(acc)).toBe(todayLocal(start));

    // Zwei Tage später: verlängert und vermerkt
    const later = start + 2 * DAY;
    session = (await findSession(env.DB, token, later))!;
    expect(await extendSessionIfDue(env.DB, session, later)).not.toBeNull();
    expect(await seen(acc)).toBe(todayLocal(later));
  });

  it("auch an der absoluten Obergrenze wird die Aktivität vermerkt", async () => {
    const acc = await account(lina);
    const start = Date.parse("2026-07-01T10:00:00Z");
    const { token } = await createSession(env.DB, acc, null, start);
    // Sitzung kurz vor Ende der Obergrenze, Ablauf schon am Maximum
    await exec("UPDATE sessions SET expires_at = ?, extended_at = ?", new Date(start + ABSOLUTE_MS).toISOString(), new Date(start + ABSOLUTE_MS - 5 * DAY).toISOString());
    const now = start + ABSOLUTE_MS - DAY;
    const session = (await findSession(env.DB, token, now))!;
    expect(await extendSessionIfDue(env.DB, session, now)).toBeNull();
    expect(await seen(acc)).toBe(todayLocal(now));
  });

  it("Admins sehen das Datum in der Personenliste, andere nicht", async () => {
    await loginAs(lina);
    await account(ole);
    const res = await api("/admin/persons", { cookie: await loginAs(admin) });
    const byId = new Map(res.body.persons.map((p: any) => [p.person.id, p]));
    expect(byId.get(lina)).toMatchObject({ hasAccount: true, lastSeenOn: todayLocal() });
    expect(byId.get(ole)).toMatchObject({ hasAccount: true, lastSeenOn: null });
    expect((await api("/admin/persons", { cookie: await loginAs(lina) })).status).toBe(403);
  });
});
