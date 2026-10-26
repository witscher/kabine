// Kinder in der App: Grenzen pro Altersklasse und Mannschaft (eigener Zugang, Zu-/Absagen, Chat, Aushilfe). Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { chatPushRecipients } from "../worker/chat/room";
import { badgeCount } from "../worker/domain/badge";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, season, team, upgradeFrom } from "./helpers";

const NONE = { account: false, respond: false, chat: "none", help: false };
const FULL = { account: true, respond: true, chat: "write", help: true };

let we: number;
let wd: number;
let adminCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  we = await team("wE", "wE");
  wd = await team("wD", "wD");
  adminCookie = await loginAs(await person("Ada", { admin: true }));
});

/** Altersklassen über die Verwaltung setzen, E-Jugend ohne Kinderzugang (bzw. mit den angegebenen Grenzen). */
async function limitE(limits: Record<string, unknown> = NONE) {
  const { body } = await api("/age-classes", { cookie: adminCookie });
  const ageClasses = body.ageClasses.map((a: any) => (a.code === "wE" ? { ...a, childLimits: limits } : a));
  expect((await api("/age-classes", { method: "PUT", cookie: adminCookie, body: { ageClasses } })).status).toBe(200);
}

describe("Kinder in der App: Altersklasse", () => {
  it("Altersklassen speichern die Grenzen; ohne Angabe bleiben die bisherigen; eine neue Saison übernimmt sie", async () => {
    await limitE();
    const read = async () => (await api("/age-classes", { cookie: adminCookie })).body.ageClasses.find((a: any) => a.code === "wE").childLimits;
    expect(await read()).toEqual(NONE);
    // Ältere App-Version ohne childLimits: nichts geht verloren
    const { body } = await api("/age-classes", { cookie: adminCookie });
    const stripped = body.ageClasses.map(({ childLimits, ...a }: any) => a);
    await api("/age-classes", { method: "PUT", cookie: adminCookie, body: { ageClasses: stripped } });
    expect(await read()).toEqual(NONE);
    // Wer keinen eigenen Zugang hat, darf auch sonst nichts selbst
    await limitE({ account: false, respond: true, chat: "write", help: true });
    expect(await read()).toEqual(NONE);
    // Hinweis, wenn dort keine Eltern eingebunden sind
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", we);
    const again = await api("/age-classes", { cookie: adminCookie });
    const saved = await api("/age-classes", { method: "PUT", cookie: adminCookie, body: { ageClasses: again.body.ageClasses } });
    expect(saved.body.teamsWithoutParents).toEqual(["wE"]);
    // Saisonwechsel: die kommende Saison übernimmt die Grenzen, auch über ihre eigene Seite
    const next = await api("/seasons", { cookie: adminCookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } });
    expect(next.status).toBe(201);
    const copied = await one<{ child_account: number; child_chat: string }>("SELECT child_account, child_chat FROM age_classes WHERE season_id = ? AND code = 'wE'", next.body.id);
    expect(copied).toEqual({ child_account: 0, child_chat: "none" });
    const nextClasses = (await api(`/seasons/${next.body.id}/age-classes`, { cookie: adminCookie })).body.ageClasses;
    expect(nextClasses.find((a: any) => a.code === "wE").childLimits).toEqual(NONE);
  });

  it("die Altersklassen der Sportart bringen ihre Voreinstellung mit (Handball: E-Jugend ohne eigenen Zugang)", async () => {
    await exec("UPDATE app_meta SET value = json_set(value, '$.sport', 'handball') WHERE key = 'club'");
    const { body } = await api("/age-classes/from-profile", { cookie: adminCookie });
    expect(body.ageClasses.find((a: any) => a.code === "E").childLimits).toEqual(NONE);
    expect(body.ageClasses.find((a: any) => a.code === "D").childLimits).toEqual(FULL);
    expect(body.ageClasses.find((a: any) => a.code === "Adults").childLimits).toEqual(FULL);
  });

  it("ohne eigenen Zugang: kein Spielerlink, alte Spielerlinks und persönliche Links gehen nicht", async () => {
    const coach = await person("Theo");
    await member(coach, we, "coach");
    const coachCookie = await loginAs(coach);
    const old = await api(`/teams/${we}/invites`, { cookie: coachCookie, body: { kind: "player" } });
    expect(old.status).toBe(201);
    await limitE();

    const created = await api(`/teams/${we}/invites`, { cookie: coachCookie, body: { kind: "player" } });
    expect(created.status).toBe(409);
    expect(created.body.error.code).toBe("no_child_account");
    const detail = await api(`/teams/${we}`, { cookie: coachCookie });
    expect(detail.body.invites.player).toBeNull();
    expect(detail.body.childLimits.account).toBe(false);
    const token = String(old.body.url).split("#")[1];
    expect((await api("/join/info", { body: { token } })).body.error.code).toBe("no_child_account");

    // Persönlicher Link: nicht für ein Kind nur in der E, wohl aber, wenn es auch in der D spielt; Admins immer
    const lotta = await person("Lotta");
    await member(lotta, we);
    expect((await api(`/persons/${lotta}/personal-link`, { cookie: coachCookie, body: {} })).body.error.code).toBe("no_child_account");
    expect((await api(`/persons/${lotta}/personal-link`, { cookie: adminCookie, body: {} })).status).toBe(201);
    const mia = await person("Mia");
    await member(mia, we);
    await member(mia, wd, "helper");
    expect((await api(`/persons/${mia}/personal-link`, { cookie: coachCookie, body: {} })).status).toBe(201);
    // Eltern ebenso
    const mona = await person("Mona");
    await guardian(mona, lotta);
    const monaCookie = await loginAs(mona);
    expect((await api(`/persons/${lotta}/personal-link`, { cookie: monaCookie, body: {} })).body.error.code).toBe("no_child_account");
    const page = await api(`/children/${lotta}/permissions`, { cookie: monaCookie });
    expect(page.body).toMatchObject({ childAccountAllowed: false, limitedTeams: [{ name: "wE", limits: NONE }] });
  });

  it("Kind mit Zugang aus der D: in der E nur lesen, die Eltern sagen zu und ab, Chat nur für Eltern", async () => {
    const mia = await person("Mia");
    await member(mia, wd);
    await member(mia, we);
    const mona = await person("Mona");
    await guardian(mona, mia);
    await limitE();
    const tE = await eventIn(we, 3);
    const tD = await eventIn(wd, 4);
    const miaCookie = await loginAs(mia);

    const events = (await api("/events", { cookie: miaCookie })).body.events;
    const mineE = events.find((e: any) => e.id === tE).mine.find((m: any) => m.person.id === mia);
    expect(mineE).toMatchObject({ canAccept: false, canDecline: false, blockedReason: "In dieser Mannschaft übernehmen das deine Eltern." });
    expect(events.find((e: any) => e.id === tD).mine.find((m: any) => m.person.id === mia).canDecline).toBe(true);
    const own = await api(`/events/${tE}/responses`, { cookie: miaCookie, body: { personId: mia, status: "no", reason: "Schule" } });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe("child_limited");
    expect((await api(`/events/${tD}/responses`, { cookie: miaCookie, body: { personId: mia, status: "no", reason: "Schule" } })).status).toBe(200);
    expect((await api(`/events/${tE}/responses`, { cookie: await loginAs(mona), body: { personId: mia, status: "no", reason: "Schule" } })).status).toBe(200);

    const rooms = (await api("/chat/rooms", { cookie: miaCookie })).body.rooms;
    expect(rooms.find((r: any) => r.teamId === we)).toMatchObject({ canRead: false });
    expect(rooms.find((r: any) => r.teamId === wd)).toMatchObject({ canRead: true });
    const miaAccount = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", mia);
    const pushE = await chatPushRecipients(env.DB, we, 0);
    expect(pushE.some((r) => r.account_id === miaAccount.id)).toBe(false);
    expect(pushE.some((r) => r.person_id === mia)).toBe(true); // über die Mutter
    expect((await chatPushRecipients(env.DB, wd, 0)).some((r) => r.account_id === miaAccount.id)).toBe(true);

    // Erwähnung im Chat der E zählt beim Kind nicht, bei der Mutter schon
    await exec("INSERT INTO chat_mentions (team_id, message_id, person_id) VALUES (?, 1, ?)", we, mia);
    expect((await badgeCount(env.DB, miaAccount.id)).mentions).toBe(0);
    const monaAccount = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", mona);
    expect((await badgeCount(env.DB, monaAccount.id)).mentions).toBe(1);

    // Chat nur lesen: mitlesen ja, schreiben nein
    await limitE({ account: true, respond: true, chat: "read", help: true });
    const readOnly = (await api("/chat/rooms", { cookie: miaCookie })).body.rooms.find((r: any) => r.teamId === we);
    expect(readOnly).toMatchObject({ canRead: true, canWrite: false });
  });

  it("Aushilfe-Anfragen: ohne Freigabe der Altersklasse antworten die Eltern", async () => {
    const wc = await team("wC", "wC");
    const ella = await person("Ella");
    await member(ella, wd);
    const mona = await person("Mona");
    await guardian(mona, ella);
    await api("/age-classes", { cookie: adminCookie }).then(async ({ body }) => {
      const ageClasses = body.ageClasses.map((a: any) => (a.code === "wC" ? { ...a, childLimits: { ...FULL, help: false } } : a));
      await api("/age-classes", { method: "PUT", cookie: adminCookie, body: { ageClasses } });
    });
    const game = await eventIn(wc, 5, { kind: "game" });
    const help = await one<{ id: number }>("INSERT INTO help_requests (event_id, person_id, team_id) VALUES (?, ?, ?) RETURNING id", game, ella, wc);
    const ellaCookie = await loginAs(ella);
    const ellaAccount = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", ella);
    expect((await badgeCount(env.DB, ellaAccount.id)).requests).toBe(0);
    const own = await api(`/help-requests/${help.id}/answer`, { cookie: ellaCookie, body: { accept: true } });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe("child_limited");
    expect((await api(`/help-requests/${help.id}/answer`, { cookie: await loginAs(mona), body: { accept: true } })).status).toBe(200);
  });

  it("ohne Einschränkung (Standard) bleibt alles wie bisher, auch die Freigaben der Eltern gelten weiter", async () => {
    const ida = await person("Ida");
    await member(ida, wd);
    const paul = await person("Paul");
    await guardian(paul, ida);
    const tD = await eventIn(wd, 3);
    const idaCookie = await loginAs(ida);
    expect((await api(`/events/${tD}/responses`, { cookie: idaCookie, body: { personId: ida, status: "no", reason: "Krank" } })).status).toBe(200);
    expect((await api("/chat/rooms", { cookie: idaCookie })).body.rooms.find((r: any) => r.teamId === wd)).toMatchObject({ canRead: true, canWrite: true });
    // Die Eltern entziehen das Lesen: gilt wie bisher
    await api(`/children/${ida}/permissions`, { method: "PUT", cookie: await loginAs(paul), body: { permission: "may_read_chat", value: false } });
    expect((await api("/chat/rooms", { cookie: await loginAs(ida) })).body.rooms.find((r: any) => r.teamId === wd)).toMatchObject({ canRead: false });
  });

  it("Erwachsenenklassen und Gruppen sind nie begrenzt", async () => {
    const f = await team("Damen", "F");
    const { body } = await api("/age-classes", { cookie: adminCookie });
    const ageClasses = body.ageClasses.map((a: any) => (a.code === "F" ? { ...a, childLimits: NONE } : a));
    await api("/age-classes", { method: "PUT", cookie: adminCookie, body: { ageClasses } });
    const coach = await person("Theo");
    await member(coach, f, "coach");
    expect((await api(`/teams/${f}/invites`, { cookie: await loginAs(coach), body: { kind: "player" } })).status).toBe(201);
    expect((await api(`/teams/${f}`, { method: "PATCH", cookie: adminCookie, body: { childLimits: { chat: "none" } } })).body.error.code).toBe("not_youth");
  });
});

describe("Kinder in der App: Einschränkung durch die Mannschaft", () => {
  let coachCookie: string;
  let mia: number;
  let miaCookie: string;

  beforeEach(async () => {
    const coach = await person("Theo");
    await member(coach, wd, "coach");
    coachCookie = await loginAs(coach);
    mia = await person("Mia");
    await member(mia, wd);
    await guardian(await person("Mona"), mia);
    miaCookie = await loginAs(mia);
  });

  it("Trainer schränken ihre Mannschaft weiter ein, aber nicht über die Altersklasse hinaus", async () => {
    const patch = (body: unknown, cookie = coachCookie) => api(`/teams/${wd}`, { method: "PATCH", cookie, body });
    expect((await patch({ childLimits: { chat: "none" } })).status).toBe(200);
    const detail = (await api(`/teams/${wd}`, { cookie: coachCookie })).body;
    expect(detail).toMatchObject({ childLimits: { ...FULL, chat: "none" }, ageClassChildLimits: FULL, teamChildLimits: { chat: "none" } });
    expect((await api("/chat/rooms", { cookie: miaCookie })).body.rooms.find((r: any) => r.teamId === wd)).toMatchObject({ canRead: false });
    const miaAccount = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", mia);
    expect((await chatPushRecipients(env.DB, wd, 0)).some((r) => r.account_id === miaAccount.id)).toBe(false);

    // Ein Feld ohne Angabe bleibt, null folgt wieder der Altersklasse
    expect((await patch({ childLimits: { respond: false } })).status).toBe(200);
    expect((await api(`/teams/${wd}`, { cookie: coachCookie })).body.teamChildLimits).toEqual({ chat: "none", respond: false });
    const t = await eventIn(wd, 3);
    expect((await api(`/events/${t}/responses`, { cookie: miaCookie, body: { personId: mia, status: "yes" } })).body.error.code).toBe("child_limited");
    expect((await patch({ childLimits: { chat: null } })).status).toBe(200);
    expect((await api(`/teams/${wd}`, { cookie: coachCookie })).body.teamChildLimits).toEqual({ respond: false });
    expect((await patch({ childLimits: null })).status).toBe(200);
    expect((await api(`/teams/${wd}`, { cookie: coachCookie })).body.teamChildLimits).toEqual({});

    // Lockerer als die Altersklasse geht nicht
    const { body } = await api("/age-classes", { cookie: adminCookie });
    const ageClasses = body.ageClasses.map((a: any) => (a.code === "wD" ? { ...a, childLimits: { ...FULL, chat: "read" } } : a));
    await api("/age-classes", { method: "PUT", cookie: adminCookie, body: { ageClasses } });
    const looser = await patch({ childLimits: { chat: "write", respond: true } });
    expect(looser.status).toBe(400);
    expect(looser.body.error.code).toBe("loosens");
    expect((await patch({ childLimits: { chat: "none" } })).status).toBe(200);

    // Trainer anderer Mannschaften nicht
    const other = await person("Otto");
    await member(other, we, "coach");
    expect((await patch({ childLimits: { help: false } }, await loginAs(other))).status).toBe(403);
  });

  it("ohne eigenen Zugang in der Mannschaft verfallen die Spielerlinks; ohne Eltern lässt sich nichts einschränken", async () => {
    const link = await api(`/teams/${wd}/invites`, { cookie: coachCookie, body: { kind: "player" } });
    expect((await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { childLimits: { account: false } } })).status).toBe(200);
    expect((await one<{ revoked: number }>("SELECT revoked_at IS NOT NULL AS revoked FROM invites WHERE id = ?", link.body.id)).revoked).toBe(1);
    expect((await api(`/teams/${wd}`, { cookie: coachCookie })).body.childLimits).toEqual(NONE);

    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", we);
    const coachE = await person("Erik");
    await member(coachE, we, "coach");
    const res = await api(`/teams/${we}`, { method: "PATCH", cookie: await loginAs(coachE), body: { childLimits: { chat: "read" } } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("no_parents");
  });
});

describe("Kinder in der App: Migration", () => {
  it("Altersklassen und Mannschaften bekommen die Spalten, bestehende Vereine behalten alle Rechte", async () => {
    await upgradeFrom("202610262230_core_child-access.sql");
    await exec("INSERT INTO seasons (id, name, starts_on, ends_on, is_current) VALUES (1, '2026/27', '2026-07-01', '2027-06-30', 1)");
    await exec("INSERT INTO age_classes (season_id, code, name, rank, is_youth) VALUES (1, 'E', 'E-Jugend', 1, 1)");
    await exec("INSERT INTO teams (name, age_class_code) VALUES ('mE', 'E')");
    await migrateRest();
    expect(await one("SELECT child_account, child_respond, child_chat, child_help FROM age_classes WHERE code = 'E'")).toEqual({
      child_account: 1,
      child_respond: 1,
      child_chat: "write",
      child_help: 1,
    });
    expect(await one("SELECT child_account, child_respond, child_chat, child_help FROM teams WHERE name = 'mE'")).toEqual({
      child_account: null,
      child_respond: null,
      child_chat: null,
      child_help: null,
    });
  });
});
