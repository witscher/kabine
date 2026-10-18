import { beforeEach, describe, expect, it } from "vitest";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, hall, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let coach: number;
let alice: number;
let bea: number;
let cleo: number;
let parent: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Trainerin");
  alice = await person("Alice", { birthYear: 2014 });
  bea = await person("Bea", { birthYear: 2015 });
  cleo = await person("Cleo", { birthYear: 2015 });
  parent = await person("Paula");
  await member(coach, wd, "coach");
  for (const p of [alice, bea, cleo]) await member(p, wd);
  await guardian(parent, bea);
});

describe("Session", () => {
  it("meldet ohne Cookie nicht angemeldet", async () => {
    const res = await api("/session");
    expect(res.body).toEqual({ authenticated: false });
  });

  it("liefert Rollen, Kinder und verwaltbare Mannschaften", async () => {
    const res = await api("/session", { cookie: await loginAs(parent) });
    expect(res.body.authenticated).toBe(true);
    expect(res.body.me.children).toEqual([
      { id: bea, firstName: "Bea", lastName: "Muster", teams: [{ id: wd, name: "wD", parentsEnabled: true }], parentsInCharge: true },
    ]);
    const coachRes = await api("/session", { cookie: await loginAs(coach) });
    expect(coachRes.body.me.manageableTeams).toEqual([{ id: wd, name: "wD" }]);
  });

  it("verweigert geschützte Endpunkte ohne Anmeldung", async () => {
    expect((await api("/events")).status).toBe(401);
  });
});

describe("Zu- und Absagen", () => {
  it("Spieler sehen nur Zahlen, Trainer sehen Namen und Begründungen", async () => {
    const ev = await eventIn(wd, 3);
    await api(`/events/${ev}/responses`, { cookie: await loginAs(cleo), body: { personId: cleo, status: "no", reason: "Familienfeier" } });

    const asPlayer = await api(`/events/${ev}`, { cookie: await loginAs(alice) });
    expect(asPlayer.status).toBe(200);
    // Ohne Absage gilt man als zugesagt
    expect(asPlayer.body.counts).toMatchObject({ yes: 2, no: 1, open: 0 });
    expect(asPlayer.body.participants).toBeNull();
    expect(JSON.stringify(asPlayer.body)).not.toContain("Familienfeier");
    expect(JSON.stringify(asPlayer.body)).not.toContain("Cleo");

    const asCoach = await api(`/events/${ev}`, { cookie: await loginAs(coach) });
    const declined = asCoach.body.participants.find((p: any) => p.person.id === cleo);
    expect(declined).toMatchObject({ status: "no", reason: "Familienfeier", respondedBy: "self" });
  });

  it("ohne Absage gilt man als zugesagt, Zusagen nimmt nur eine Absage zurück", async () => {
    const training = await eventIn(wd, 3);
    const special = await eventIn(wd, 4, { kind: "special", title: "Turnier" });
    const cookie = await loginAs(alice);
    for (const ev of [training, special]) {
      expect((await api(`/events/${ev}`, { cookie })).body.mine[0]).toMatchObject({ status: "yes", canDecline: true });
    }
    // Eine Zusage ohne vorherige Absage speichert nichts
    expect((await api(`/events/${training}/responses`, { cookie, body: { personId: alice, status: "yes" } })).status).toBe(200);
    expect(await rows("SELECT * FROM responses WHERE event_id = ?", training)).toEqual([]);
    // Absagen und wieder zusagen
    await api(`/events/${training}/responses`, { cookie, body: { personId: alice, status: "no", reason: "Schule" } });
    const back = await api(`/events/${training}/responses`, { cookie, body: { personId: alice, status: "yes" } });
    expect(back.body.mine[0]).toMatchObject({ status: "yes" });

    // Spiele: Nominierte gelten als zugesagt
    const game = await eventIn(wd, 6, { kind: "game" });
    await api(`/events/${game}/squad`, { method: "PUT", cookie: await loginAs(coach), body: { personIds: [alice] } });
    expect((await api(`/events/${game}`, { cookie })).body.mine[0]).toMatchObject({ status: "yes", nominated: true });
  });

  it("Aushilfen bleiben offen, bis sie zusagen", async () => {
    const helper = await person("Hanna", { birthYear: 2016 });
    await member(helper, wd, "helper");
    await exec("UPDATE team_memberships SET helper_trainings = 1 WHERE person_id = ?", helper);
    const ev = await eventIn(wd, 3);
    const coachView = await api(`/events/${ev}`, { cookie: await loginAs(coach) });
    expect(coachView.body.participants.find((p: any) => p.person.id === helper)).toMatchObject({ status: "open" });
    expect(coachView.body.counts).toMatchObject({ yes: 3, open: 1 });
  });

  it("verlangt eine Begründung bei Absagen", async () => {
    const ev = await eventIn(wd, 3);
    const res = await api(`/events/${ev}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "no" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("reason_required");
  });

  it("markiert Absagen nach Fristende als kurzfristig", async () => {
    // Frist 96 Stunden: ein Termin in 3 Tagen liegt schon hinter der Frist
    await exec("UPDATE teams SET decline_hours_training = 96 WHERE id = ?", wd);
    const soon = await eventIn(wd, 3);
    const res = await api(`/events/${soon}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "no", reason: "Krank" } });
    expect(res.status).toBe(200);
    expect(res.body.mine[0]).toMatchObject({ status: "no", isLate: true });
    // Wieder zusagen ist nie kurzfristig
    await api(`/events/${soon}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "yes" } });
    expect(await one<{ status: string; is_late: number }>("SELECT status, is_late FROM responses WHERE event_id = ? AND person_id = ?", soon, alice)).toEqual({ status: "yes", is_late: 0 });

    const later = await eventIn(wd, 6);
    await api(`/events/${later}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "no", reason: "Krank" } });
    expect((await one<{ is_late: number }>("SELECT is_late FROM responses WHERE event_id = ?", later)).is_late).toBe(0);
  });

  it("Eltern sagen für ihr Kind ab, nicht für andere", async () => {
    const ev = await eventIn(wd, 3);
    const cookie = await loginAs(parent);
    const ok = await api(`/events/${ev}/responses`, { cookie, body: { personId: bea, status: "no", reason: "Schule" } });
    expect(ok.status).toBe(200);
    expect(ok.body.mine[0]).toMatchObject({ status: "no", respondedBy: "guardian", respondedByName: "Paula" });
    const coachView = await api(`/events/${ev}`, { cookie: await loginAs(coach) });
    expect(coachView.body.participants.find((p: any) => p.person.id === bea)).toMatchObject({ respondedBy: "guardian", respondedByName: "Paula" });
    const denied = await api(`/events/${ev}/responses`, { cookie, body: { personId: alice, status: "yes" } });
    expect(denied.status).toBe(403);
  });

  it("Elternfreigaben werden serverseitig geprüft", async () => {
    const ev = await eventIn(wd, 3);
    const parentCookie = await loginAs(parent);
    const childCookie = await loginAs(bea);
    expect((await api(`/children/${bea}/permissions`, { method: "PUT", cookie: parentCookie, body: { permission: "may_decline", value: false } })).status).toBe(200);
    const denied = await api(`/events/${ev}/responses`, { cookie: childCookie, body: { personId: bea, status: "no", reason: "Keine Lust" } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toBe("Deine Eltern kümmern sich darum.");
    expect((await api(`/events/${ev}/responses`, { cookie: childCookie, body: { personId: bea, status: "yes" } })).status).toBe(200);
    const log = await api(`/children/${bea}/permissions`, { cookie: parentCookie });
    expect(log.body.log[0]).toMatchObject({ permission: "may_decline", value: false, byName: "Paula" });
    // Kind ohne Eltern hat alle Rechte
    expect((await api(`/events/${ev}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "no", reason: "Ferien" } })).status).toBe(200);
  });

  it("inaktive Spieler werden separat gezählt und können nicht antworten", async () => {
    const ev = await eventIn(wd, 3);
    await api(`/persons/${cleo}/active`, { cookie: await loginAs(coach), body: { active: false } });
    const res = await api(`/events/${ev}`, { cookie: await loginAs(alice) });
    expect(res.body.counts).toMatchObject({ yes: 2, open: 0, inactive: 1 });
    const blocked = await api(`/events/${ev}/responses`, { cookie: await loginAs(cleo), body: { personId: cleo, status: "yes" } });
    expect(blocked.status).toBe(409);
  });

  it("Dauerabwesenheit setzt den Status, eine Zusage überschreibt sie", async () => {
    const h = await hall();
    await exec("INSERT INTO training_plans (id, team_id, name, kind, valid_from, valid_to) VALUES (1, ?, 'Plan', 'regular', '2026-01-01', '2030-12-31')", wd);
    await exec("INSERT INTO training_rules (id, plan_id, weekday, starts_at, ends_at, location_id) VALUES (1, 1, 1, '17:00', '18:00', ?)", h);
    await exec("INSERT INTO rule_teams (rule_id, team_id) VALUES (1, ?)", wd);
    const date = addDays(todayLocal(), 4);
    const ev = (await one<{ id: number }>("INSERT INTO events (kind, starts_at, ends_at, rule_id, rule_date) VALUES ('training', ?, ?, 1, ?) RETURNING id", `${date}T17:00`, `${date}T18:00`, date)).id;
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", ev, wd);

    const coachCookie = await loginAs(coach);
    expect((await api(`/rules/1/standing-absences/${alice}`, { method: "PUT", cookie: coachCookie, body: { active: true } })).status).toBe(200);
    // Spieler dürfen keine Dauerabwesenheit setzen
    expect((await api(`/rules/1/standing-absences/${alice}`, { method: "PUT", cookie: await loginAs(alice), body: { active: true } })).status).toBe(403);

    let detail = await api(`/events/${ev}`, { cookie: coachCookie });
    expect(detail.body.participants.find((p: any) => p.person.id === alice).status).toBe("standing");
    await api(`/events/${ev}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "yes" } });
    detail = await api(`/events/${ev}`, { cookie: coachCookie });
    expect(detail.body.participants.find((p: any) => p.person.id === alice).status).toBe("yes");
  });

  it("Trainer sagen Termine ab, Spieler nicht", async () => {
    const ev = await eventIn(wd, 3);
    expect((await api(`/events/${ev}/cancel`, { cookie: await loginAs(alice), body: { reason: "x" } })).status).toBe(403);
    expect((await api(`/events/${ev}/cancel`, { cookie: await loginAs(coach), body: { reason: "Halle belegt" } })).status).toBe(200);
    const res = await api(`/events/${ev}`, { cookie: await loginAs(alice) });
    expect(res.body.cancelled).toMatchObject({ byName: "Trainerin", reason: "Halle belegt" });
    expect(res.body.mine[0].canAccept).toBe(false);
  });

  it("Termine anderer Mannschaften sind unsichtbar", async () => {
    const other = await team("wC", "wC");
    const ev = await eventIn(other, 3);
    expect((await api(`/events/${ev}`, { cookie: await loginAs(alice) })).status).toBe(404);
    const list = await api(`/events`, { cookie: await loginAs(alice) });
    expect(list.body.events.find((e: any) => e.id === ev)).toBeUndefined();
  });
});

describe("Spiele und Kader", () => {
  it("nur nominierte Spieler können zu- oder absagen", async () => {
    const game = await eventIn(wd, 6, { kind: "game" });
    const coachCookie = await loginAs(coach);
    expect((await api(`/events/${game}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "yes" } })).status).toBe(403);
    const squad = await api(`/events/${game}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, bea] } });
    expect(squad.body).toMatchObject({ added: 2, removed: 0 });
    expect((await api(`/events/${game}/responses`, { cookie: await loginAs(alice), body: { personId: alice, status: "yes" } })).status).toBe(200);
    const cleoView = await api(`/events/${game}`, { cookie: await loginAs(cleo) });
    expect(cleoView.body.mine[0]).toMatchObject({ participant: false, nominated: false, canAccept: false });
    const view = await api(`/events/${game}/squad`, { cookie: coachCookie });
    expect(view.body.candidates.filter((c: any) => c.nominated).length).toBe(2);
  });

  it("begrenzt die Kadergröße und lässt inaktive nicht zu", async () => {
    await exec("UPDATE teams SET max_squad = 1 WHERE id = ?", wd);
    const game = await eventIn(wd, 6, { kind: "game" });
    const coachCookie = await loginAs(coach);
    expect((await api(`/events/${game}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, bea] } })).status).toBe(400);
    await exec("UPDATE teams SET max_squad = 14 WHERE id = ?", wd);
    await exec("UPDATE persons SET is_active = 0 WHERE id = ?", cleo);
    expect((await api(`/events/${game}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [cleo] } })).status).toBe(400);
  });

  it("Aushilfe-Anfrage aus der nächstjüngeren Jugend", async () => {
    const wc = await team("wC", "wC");
    const wcCoach = await person("Coach C");
    await member(wcCoach, wc, "coach");
    const game = await eventIn(wc, 6, { kind: "game" });
    const cookie = await loginAs(wcCoach);
    const candidates = await api(`/events/${game}/help-candidates`, { cookie });
    expect(candidates.body.candidates.map((c: any) => c.person.id).sort()).toEqual([alice, bea, cleo].sort());
    expect((await api(`/events/${game}/help-requests`, { cookie, body: { personId: bea } })).status).toBe(201);

    // Bea sieht das Spiel mit der Anfrage, ihre Mutter kann annehmen
    const parentCookie = await loginAs(parent);
    const seen = await api(`/events/${game}`, { cookie: parentCookie });
    const help = seen.body.mine[0].helpRequest;
    expect(help).toMatchObject({ status: "open", teamName: "wC", canAnswer: true });
    expect((await api(`/help-requests/${help.id}/answer`, { cookie: parentCookie, body: { accept: true } })).status).toBe(200);
    const nomination = await one<{ is_helper: number }>("SELECT is_helper FROM nominations WHERE event_id = ? AND person_id = ?", game, bea);
    expect(nomination.is_helper).toBe(1);
  });
});

describe("Einladungen", () => {
  it("Spielerlink zeigt Kurznamen ohne Geburtsjahr und vergebene Personen", async () => {
    await loginAs(alice); // Alice hat bereits einen Zugang
    const created = await api(`/teams/${wd}/invites`, { cookie: await loginAs(coach), body: { kind: "player" } });
    expect(created.status).toBe(201);
    const token = created.body.url.split("#")[1];
    const info = await api(`/join/info`, { body: { token } });
    expect(info.body.kind).toBe("player");
    expect(info.body.persons).toEqual([
      { id: alice, name: "Alice M.", taken: true, linkedToMe: false },
      { id: bea, name: "Bea M.", taken: false, linkedToMe: false },
      { id: cleo, name: "Cleo M.", taken: false, linkedToMe: false },
    ]);
    expect(JSON.stringify(info.body)).not.toContain("2014");
  });

  it("neuer Link widerruft den alten, Trainer sieht den aktuellen erneut", async () => {
    const cookie = await loginAs(coach);
    const first = await api(`/teams/${wd}/invites`, { cookie, body: { kind: "parent" } });
    const second = await api(`/teams/${wd}/invites`, { cookie, body: { kind: "parent" } });
    const old = await api(`/join/info`, { body: { token: first.body.url.split("#")[1] } });
    expect(old.body.error.code).toBe("invite_revoked");
    const detail = await api(`/teams/${wd}`, { cookie });
    expect(detail.body.invites.parent.url).toBe(second.body.url);
    const stored = await rows<{ token_hash: string; nonce: string }>("SELECT token_hash, nonce FROM invites");
    expect(JSON.stringify(stored)).not.toContain(second.body.url.split("#")[1]);
  });

  it("Spieler können keine Einladungen erzeugen", async () => {
    expect((await api(`/teams/${wd}/invites`, { cookie: await loginAs(alice), body: { kind: "player" } })).status).toBe(403);
  });
});

describe("Vereinsaustritt und Saisonwechsel", () => {
  it("Austritt deaktiviert den Zugang und das Elternkonto ohne weitere Kinder", async () => {
    await loginAs(bea);
    const parentCookie = await loginAs(parent);
    const res = await api(`/persons/${bea}/leave`, { cookie: await loginAs(coach), body: {} });
    expect(res.body).toMatchObject({ ok: true, parentsDeactivated: 1 });
    const p = await one<{ is_former: number }>("SELECT is_former FROM persons WHERE id = ?", bea);
    expect(p.is_former).toBe(1);
    expect((await rows("SELECT * FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.person_id IN (?, ?)", bea, parent)).length).toBe(0);
    expect((await api("/session", { cookie: parentCookie })).body).toEqual({ authenticated: false });
  });

  it("Saisonwechsel ordnet nach Jahrgang zu und setzt zurück", async () => {
    const wc = await team("wC", "wC");
    const admin = await person("Ada", { admin: true });
    const cookie = await loginAs(admin);
    await eventIn(wd, 3);
    const created = await api(`/seasons`, { cookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } });
    expect(created.status).toBe(201);
    const preview = await api(`/season-change/preview?seasonId=${created.body.id}`, { cookie });
    const byId = new Map(preview.body.players.map((p: any) => [p.person.id, p]));
    expect(byId.get(alice)).toMatchObject({ category: "auto", suggestedTeamIds: [wc] }); // 2014 -> wC
    expect(byId.get(bea)).toMatchObject({ category: "auto", suggestedTeamIds: [wd] }); // 2015 bleibt wD

    const wrong = await api(`/season-change/execute`, { cookie, body: { seasonId: created.body.id, confirmName: "falsch", assignments: [] } });
    expect(wrong.status).toBe(400);
    const done = await api(`/season-change/execute`, {
      cookie,
      body: {
        seasonId: created.body.id,
        confirmName: "2027/28",
        assignments: [
          { personId: alice, teamIds: [wc], former: false },
          { personId: bea, teamIds: [wd], former: false },
          { personId: cleo, teamIds: [], former: true },
        ],
      },
    });
    expect(done.body).toMatchObject({ ok: true, assigned: 2, deletedPersons: 1 });
    expect((await rows("SELECT * FROM events")).length).toBe(0);
    expect((await rows("SELECT * FROM persons WHERE id = ?", cleo)).length).toBe(0);
    expect((await rows("SELECT * FROM team_memberships WHERE role = 'coach'")).length).toBe(0);
    expect((await one<{ name: string }>("SELECT name FROM seasons WHERE is_current = 1")).name).toBe("2027/28");
    // Eltern bleiben erhalten, da Bea bleibt
    expect((await rows("SELECT * FROM guardianships WHERE child_id = ?", bea)).length).toBe(1);
  });
});

describe("Spieler in zwei Mannschaften", () => {
  it("Saisonwechsel: Jugend nach Jahrgang in die 1. Mannschaft, Erwachsene behalten beide Teams", async () => {
    const wd2 = await team("wD2", "wD", { level: 2 });
    const wc1 = await team("wC1", "wC");
    const wc2 = await team("wC2", "wC", { level: 2 });
    const h1 = await team("Damen 1", "F");
    const h2 = await team("Damen 2", "F", { level: 2 });
    const max = await person("Mara", { birthYear: 1990 });
    await member(alice, wd2); // Alice spielt in wD und wD2
    await member(max, h1);
    await member(max, h2);
    await member(bea, h2); // Jugendspielerin hilft auch bei den Damen 2
    const admin = await person("Ada", { admin: true });
    const cookie = await loginAs(admin);
    const created = await api(`/seasons`, { cookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } });
    const preview = await api(`/season-change/preview?seasonId=${created.body.id}`, { cookie });
    const byId = new Map(preview.body.players.map((p: any) => [p.person.id, p]));
    expect(byId.get(alice)).toMatchObject({ category: "choose", suggestedTeamIds: [wc1] });
    expect(wc2).toBeGreaterThan(0);
    expect(byId.get(bea)).toMatchObject({ suggestedTeamIds: [wd, h2] });
    expect([...(byId.get(max) as any).suggestedTeamIds].sort()).toEqual([h1, h2].sort());

    const done = await api(`/season-change/execute`, {
      cookie,
      body: {
        seasonId: created.body.id,
        confirmName: "2027/28",
        assignments: preview.body.players.map((p: any) => ({ personId: p.person.id, teamIds: p.suggestedTeamIds, former: false })),
      },
    });
    expect(done.status).toBe(200);
    const teamsOf = async (id: number) =>
      (await rows<{ team_id: number }>("SELECT team_id FROM team_memberships WHERE person_id = ? AND role = 'player' ORDER BY team_id", id)).map((r) => r.team_id);
    expect(await teamsOf(alice)).toEqual([wc1]);
    expect(await teamsOf(max)).toEqual([h1, h2].sort((a, b) => a - b));
  });
});

describe("Rückmeldung durch Trainer", () => {
  it("Trainer und Admins sagen für Spieler ab und wieder zu, andere nicht", async () => {
    const ev = await eventIn(wd, 3);
    const coachCookie = await loginAs(coach);
    // Ohne Grund geht keine Absage
    expect((await api(`/events/${ev}/responses`, { cookie: coachCookie, body: { personId: alice, status: "no" } })).status).toBe(400);
    expect((await api(`/events/${ev}/responses`, { cookie: coachCookie, body: { personId: alice, status: "no", reason: "Krank" } })).status).toBe(200);
    expect(await one("SELECT status, reason, by_person FROM responses WHERE event_id = ? AND person_id = ?", ev, alice)).toEqual({ status: "no", reason: "Krank", by_person: coach });
    expect((await api(`/events/${ev}/responses`, { cookie: coachCookie, body: { personId: alice, status: "yes" } })).status).toBe(200);
    expect(await one("SELECT status FROM responses WHERE event_id = ? AND person_id = ?", ev, alice)).toEqual({ status: "yes" });

    const admin = await person("Ada", { admin: true });
    expect((await api(`/events/${ev}/responses`, { cookie: await loginAs(admin), body: { personId: bea, status: "no", reason: "Schule" } })).status).toBe(200);

    // Trainer einer anderen Mannschaft und Mitspieler dürfen nicht
    const other = await team("wE", "wE");
    const otherCoach = await person("Olga");
    await member(otherCoach, other, "coach");
    // Fremde Mannschaft: Termin gar nicht sichtbar
    expect((await api(`/events/${ev}/responses`, { cookie: await loginAs(otherCoach), body: { personId: cleo, status: "no", reason: "Krank" } })).status).toBe(404);
    expect((await api(`/events/${ev}/responses`, { cookie: await loginAs(alice), body: { personId: cleo, status: "no", reason: "Krank" } })).status).toBe(403);
  });
});

describe("Sondertermine", () => {
  it("Admins legen Termine für mehrere Mannschaften an", async () => {
    const wc = await team("wC", "wC");
    const kid = await person("Clara", { birthYear: 2013 });
    await member(kid, wc);
    const cookie = await loginAs(await person("Ada", { admin: true }));
    const res = await api("/events", {
      cookie,
      body: { title: "Turnier", startsAt: `${addDays(todayLocal(), 5)}T10:00`, teamIds: [wd, wc] },
    });
    expect(res.status).toBe(201);
    expect((await rows<{ team_id: number }>("SELECT team_id FROM event_teams WHERE event_id = ? ORDER BY team_id", res.body.id)).map((r) => r.team_id)).toEqual([wd, wc].sort((a, b) => a - b));
    // Beide Mannschaften sehen ihn
    expect((await api(`/events/${res.body.id}`, { cookie: await loginAs(kid) })).status).toBe(200);
    expect((await api(`/events/${res.body.id}`, { cookie: await loginAs(alice) })).status).toBe(200);
  });
});
