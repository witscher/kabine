// Security checklist (docs/security.md): each case recreates the misuse and checks that it fails. Invented names.
// Finding 1 (schedule import links foreign games) is tested in modules/handball4all/test/handball4all.test.ts.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MailMessage, mailer } from "../worker/domain/email-login";
import { api, eventIn, exec, freshDb, guardian, hall, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let wc: number;
let coachD: number;
let coachC: number;
let coachDCookie: string;
let mails: MailMessage[];

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wc = await team("wC", "wC");
  coachD = await person("Doris", { lastName: "Dach" });
  coachC = await person("Carla", { lastName: "Cord" });
  await member(coachD, wd, "coach");
  await member(coachC, wc, "coach");
  coachDCookie = await loginAs(coachD);
  mails = [];
  vi.spyOn(mailer, "send").mockImplementation(async (_env, msg) => void mails.push(msg));
});
afterEach(() => vi.restoreAllMocks());

const ORIGIN = "http://localhost:5173";

describe("Sicherheitsfunde", () => {
  it("2: Trainingszeiten nur mit Mannschaften, die man trainiert", async () => {
    const loc = await hall();
    const plan = { name: "Plan", kind: "regular", validFrom: "2026-09-01", validTo: "2027-06-30" };
    const rule = { weekday: 2, startsAt: "17:00", endsAt: "18:30", locationId: loc };
    // Fremde Mannschaft beim Anlegen
    const bad = await api(`/teams/${wd}/plans`, { cookie: coachDCookie, body: { ...plan, rules: [{ ...rule, teamIds: [wc] }] } });
    expect(bad.status).toBe(403);
    const ok = await api(`/teams/${wd}/plans`, { cookie: coachDCookie, body: { ...plan, rules: [rule] } });
    expect(ok.status).toBe(201);
    // Fremde Mannschaft an eine neue Regel oder per Änderung
    expect((await api(`/plans/${ok.body.id}/rules`, { cookie: coachDCookie, body: { ...rule, weekday: 4, teamIds: [wc] } })).status).toBe(403);
    const ruleId = (await one<{ id: number }>("SELECT id FROM training_rules WHERE plan_id = ?", ok.body.id)).id;
    expect((await api(`/rules/${ruleId}`, { cookie: coachDCookie, method: "PATCH", body: { ...rule, teamIds: [wc] } })).status).toBe(403);
    expect(await rows("SELECT team_id FROM rule_teams WHERE rule_id = ?", ruleId)).toEqual([{ team_id: wd }]);

    // Gemeinsame Regel, von einer Trainerin beider Mannschaften angelegt: Doris darf die wC nicht entfernen
    await member(coachD, wc, "coach");
    expect((await api(`/rules/${ruleId}`, { cookie: await loginAs(coachD), method: "PATCH", body: { ...rule, teamIds: [wc] } })).status).toBe(200);
    await exec("DELETE FROM team_memberships WHERE person_id = ? AND team_id = ?", coachD, wc);
    const cookie = await loginAs(coachD);
    expect((await api(`/rules/${ruleId}`, { cookie, method: "PATCH", body: { ...rule, teamIds: [] } })).status).toBe(403);
    // Uhrzeit ändern, ohne die Mannschaften zu ändern, bleibt erlaubt
    expect((await api(`/rules/${ruleId}`, { cookie, method: "PATCH", body: { ...rule, startsAt: "17:15", teamIds: [wc] } })).status).toBe(200);
  });

  it("3: persönlicher Link übernimmt keinen Zugang still und keine bestätigte Adresse", async () => {
    const lina = await person("Lina", { lastName: "Lauf" });
    await member(lina, wd);
    await loginAs(lina);
    await exec("UPDATE accounts SET email = 'lina@example.org', email_verified_at = '2026-01-01T00:00:00Z' WHERE person_id = ?", lina);
    const link = await api(`/persons/${lina}/personal-link`, { cookie: coachDCookie, body: {} });
    expect(link.status).toBe(201);
    const token = String(link.body.url).split("#")[1]!;
    // Die Einladung kündigt das Abmelden an
    expect((await api("/join/info", { body: { token } })).body.revokeExisting).toBe(true);
    // Eine andere Adresse lässt sich nicht unterschieben
    const other = await api("/join/email", { body: { token, email: "fremd@example.org" } });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe("email_locked");
    expect(mails).toHaveLength(0);
    // Über die eigene Adresse: alte Sitzungen sind danach weg, die Inhaberin bekommt eine Mail
    const sessionsBefore = (await one<{ n: number }>("SELECT count(*) AS n FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.person_id = ?", lina)).n;
    expect(sessionsBefore).toBeGreaterThan(0);
    const start = await api("/join/email", { body: { token, email: "lina@example.org" } });
    expect(start.status).toBe(200);
    const code = mails[0]!.subject.match(/\d{6}/)![0];
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/api/auth/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: start.body.requestId, code }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mails.map((m) => m.subject)).toContain("Neues Gerät für deinen Zugang zu Kabine");
    expect((await one<{ n: number }>("SELECT count(*) AS n FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.person_id = ?", lina)).n).toBe(1);
    expect(await one("SELECT email FROM accounts WHERE person_id = ?", lina)).toEqual({ email: "lina@example.org" });
  });

  it("4: Austritt und Zugang lösen bei Trainern anderer Mannschaften nur durch Admins", async () => {
    // Elternteil eines Kindes der wD, das zugleich die wC trainiert
    const kid = await person("Ina", { lastName: "Cord" });
    await member(kid, wd);
    await guardian(coachC, kid);
    await loginAs(coachC);
    expect((await api(`/persons/${coachC}/account`, { cookie: coachDCookie, method: "DELETE" })).status).toBe(403);
    expect((await api(`/persons/${coachC}/leave`, { cookie: coachDCookie, body: {} })).status).toBe(403);
    expect(await rows("SELECT role FROM team_memberships WHERE person_id = ?", coachC)).toEqual([{ role: "coach" }]);
    expect(await rows("SELECT id FROM accounts WHERE person_id = ?", coachC)).toHaveLength(1);
    const admin = await loginAs(await person("Ada", { admin: true }));
    expect((await api(`/persons/${coachC}/account`, { cookie: admin, method: "DELETE" })).status).toBe(200);
  });

  it("5: WebSockets nur von der App selbst", async () => {
    const connect = (origin?: string) =>
      exports.default.fetch(
        new Request(`${ORIGIN}/api/chat/${wd}/connect`, { headers: { upgrade: "websocket", cookie: coachDCookie, ...(origin ? { origin } : {}) } }),
      );
    expect((await connect("https://verein.example.org")).status).toBe(403);
    expect((await connect()).status).toBe(403);
    const ok = await connect(ORIGIN);
    expect(ok.status).toBe(101);
    ok.webSocket!.accept();
    ok.webSocket!.close();
  });

  it("6: ohne Mailversand landen weder Text noch Adresse im Log", async () => {
    vi.restoreAllMocks();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await mailer.send({ ...env, EMAIL: undefined, APP_ENV: "staging" } as unknown as Env, {
      to: "geheim@example.org",
      subject: "Feedback",
      text: "Mein Kind Lina hat Asthma",
    });
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("Feedback");
    expect(out).not.toContain("Asthma");
    expect(out).not.toContain("geheim@example.org");
  });

  it("7: in der fremden Trainersicht löscht ein Admin keine Chatnachricht", async () => {
    const open = async (cookie: string) => {
      const res = await exports.default.fetch(new Request(`${ORIGIN}/api/chat/${wd}/connect`, { headers: { upgrade: "websocket", cookie, origin: ORIGIN } }));
      expect(res.status).toBe(101);
      const ws = res.webSocket!;
      const queue: any[] = [];
      const waiters: ((m: any) => void)[] = [];
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data as string);
        const w = waiters.shift();
        if (w) w(m);
        else queue.push(m);
      });
      ws.accept();
      const next = () => new Promise<any>((resolve) => (queue.length ? resolve(queue.shift()) : waiters.push(resolve)));
      return { ws, next };
    };
    const coach = await open(coachDCookie);
    await coach.next(); // hello
    coach.ws.send(JSON.stringify({ type: "send", text: "Bitte pünktlich", clientId: "c1" }));
    let ack = await coach.next();
    while (ack.type !== "ack") ack = await coach.next();
    // Trainersicht eines Admins mit Kind in der wD: die Sicht von Doris, schreibgeschützt
    const ada = await person("Ada", { admin: true });
    const kid = await person("Alva");
    await member(kid, wd);
    await guardian(ada, kid);
    const view = await open(`${await loginAs(ada)}; kabine_view=trainer`);
    const hello = await view.next();
    expect(hello.me).toMatchObject({ canWrite: false, isMod: true });
    view.ws.send(JSON.stringify({ type: "delete", id: ack.id }));
    // Ein Kontrollaufruf danach: die Nachricht steht noch
    view.ws.send(JSON.stringify({ type: "ping" }));
    await new Promise((r) => setTimeout(r, 100));
    coach.ws.close();
    view.ws.close();
    const again = await open(coachDCookie);
    const after = await again.next();
    expect(after.messages.find((m: any) => m.id === ack.id)).toMatchObject({ text: "Bitte pünktlich" });
    again.ws.close();
  });

  it("8: unbekannte Rolle ist ein Fehler 400", async () => {
    const res = await api(`/teams/${wd}/members/${coachD}?role=boss`, { cookie: coachDCookie, method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("9: KiHaSL-Rolle für Kinder nur, wo Eltern eingebunden sind", async () => {
    const admin = await loginAs(await person("Ada", { admin: true }));
    const token = String((await api("/admin/referee-links", { cookie: admin, body: {} })).body.url).split("#")[1];
    const kid = await person("Ole", { lastName: "Ort" });
    const parent = await person("Olga", { lastName: "Ort" });
    await member(kid, wc);
    await guardian(parent, kid);
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wc);
    const cookie = await loginAs(parent);
    expect((await api("/referee/info", { cookie, body: { token } })).body.candidates.map((c: any) => c.personId)).toEqual([parent]);
    expect((await api("/referee/accept", { cookie, body: { token, personId: kid } })).status).toBe(400);
    await exec("UPDATE teams SET parents_enabled = 1 WHERE id = ?", wc);
    expect((await api("/referee/accept", { cookie: await loginAs(parent), body: { token, personId: kid } })).status).toBe(200);
  });

  it("10: Einladungslink zeigt nur „Vorname N.“, bei Gleichheit mit Jahrgang", async () => {
    for (const [first, last, year] of [
      ["Lina", "Berg", 2014],
      ["Lina", "Brand", 2015],
      ["Mara", "Stein", 2014],
    ] as const) {
      await member(await person(first, { lastName: last, birthYear: year }), wd);
    }
    const link = await api(`/teams/${wd}/invites`, { cookie: coachDCookie, body: { kind: "player" } });
    const token = String(link.body.url).split("#")[1];
    const info = await api("/join/info", { body: { token } });
    expect(info.body.persons.map((p: any) => p.name).sort()).toEqual(["Lina B. (2014)", "Lina B. (2015)", "Mara S."]);
  });

  it("12: ein Push-Abo lässt sich nicht ohne seine Schlüssel auf ein anderes Konto umhängen", async () => {
    const sub = (p256dh: string) => ({ endpoint: "https://push.example.org/abc", keys: { p256dh, auth: "a".repeat(22) } });
    const keyA = "A".repeat(87);
    const keyB = "B".repeat(87);
    expect((await api("/push/subscriptions", { cookie: coachDCookie, body: sub(keyA) })).status).toBe(201);
    const other = await loginAs(coachC);
    const stolen = await api("/push/subscriptions", { cookie: other, body: sub(keyB) });
    expect(stolen.status).toBe(409);
    expect(stolen.body.error.code).toBe("endpoint_taken");
    // Dasselbe Gerät (gleiche Schlüssel) mit anderem Konto: erlaubt
    expect((await api("/push/subscriptions", { cookie: other, body: sub(keyA) })).status).toBe(201);
    const owner = await one<{ person_id: number }>("SELECT a.person_id FROM push_subscriptions s JOIN accounts a ON a.id = s.account_id");
    expect(owner.person_id).toBe(coachC);
  });

  it("11: Helferplan zeigt das Kind als „Vorname N.“", async () => {
    await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
    const kid = await person("Kim", { lastName: "Kaiser" });
    const mum = await person("Mona", { lastName: "Kaiser" });
    await member(kid, wd);
    await guardian(mum, kid);
    const game = await eventIn(wd, 5, { kind: "game", time: "14:00" });
    await exec("UPDATE events SET external_ref = 'handball4all:g1', is_home = 1, home_team = 'SV Musterstadt', guest_team = 'SG Gegner' WHERE id = ?", game);
    const mumCookie = await loginAs(mum);
    const list = await api(`/duties?teamId=${wd}`, { cookie: mumCookie });
    const block = list.body.games[0].blocks[0];
    expect((await api("/duties", { cookie: mumCookie, body: { blockId: block.id } })).status).toBe(201);
    const seen = await api(`/duties?teamId=${wd}`, { cookie: coachDCookie });
    expect(seen.body.games[0].blocks[0].entries[0].child).toBe("Kim K.");
  });
});
