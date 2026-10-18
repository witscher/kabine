// Optional joint training ("together with"): a team may join another team's training by choice.
// Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordAttendance } from "../worker/domain/attendance";
import { generateTrainings } from "../worker/domain/generate";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, hall, loginAs, member, one, person, rows, season, team } from "./helpers";

let wc: number;
let wd: number;
let coach: number;
let cookie: string;
let carla: number; // wC
let dana: number; // wD
let both: number; // plays in wC and wD
let training: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wc = await team("wC", "wC");
  wd = await team("wD", "wD");
  coach = await person("Theo");
  await member(coach, wc, "coach");
  await member(coach, wd, "coach");
  carla = await person("Carla");
  dana = await person("Dana");
  both = await person("Bea");
  await member(carla, wc);
  await member(dana, wd);
  await member(both, wc);
  await member(both, wd);
  cookie = await loginAs(coach);
  const today = todayLocal();
  const weekday = ((new Date(`${addDays(today, 2)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const res = await api(`/teams/${wc}/plans`, {
    cookie,
    body: {
      name: "Saison",
      kind: "regular",
      validFrom: today,
      validTo: addDays(today, 20),
      rules: [{ weekday, startsAt: "18:00", endsAt: "19:30", locationId: await hall(), teamIds: [wd], optionalTeamIds: [wd] }],
    },
  });
  expect(res.status).toBe(201);
  training = (await one<{ id: number }>("SELECT id FROM events WHERE starts_at LIKE ? ORDER BY starts_at LIMIT 1", `${addDays(today, 2)}%`)).id;
});

const detail = async (id: number) => (await api(`/events/${id}`, { cookie })).body;
const part = (d: { participants: { person: { id: number }; status: string; optional: boolean }[] }, id: number) => d.participants.find((p) => p.person.id === id)!;

describe("Optionales Mittrainieren", () => {
  it("die optionale Mannschaft gilt nicht als zugesagt, wer in beiden spielt, schon", async () => {
    const d = await detail(training);
    expect(d.optionalTeamIds).toEqual([wd]);
    expect(part(d, carla)).toMatchObject({ status: "yes", optional: false });
    expect(part(d, dana)).toMatchObject({ status: "open", optional: true });
    expect(part(d, both)).toMatchObject({ status: "yes", optional: false });
    expect(d.counts).toMatchObject({ yes: 2, open: 0, optional: 1 });
    const plans = (await api(`/teams/${wc}/plans`, { cookie })).body;
    expect(plans.plans[0].rules[0].teams).toEqual(
      expect.arrayContaining([{ id: wd, name: "wD", optional: true }, { id: wc, name: "wC", optional: false }]),
    );
  });

  it("Zusage freiwillig, Rückzug ohne Grund, keine Erinnerung, kein „unentschuldigt“", async () => {
    const danaCookie = await loginAs(dana);
    expect((await api(`/events/${training}/responses`, { cookie: danaCookie, body: { personId: dana, status: "yes" } })).status).toBe(200);
    expect((await detail(training)).counts).toMatchObject({ yes: 3, optional: 0 });
    expect((await api(`/events/${training}/responses`, { cookie: danaCookie, body: { personId: dana, status: "no" } })).status).toBe(200);
    expect((await detail(training)).counts).toMatchObject({ yes: 2, no: 0, optional: 1 });
    // Pflicht-Mannschaft braucht weiter einen Grund
    const carlaCookie = await loginAs(carla);
    expect((await api(`/events/${training}/responses`, { cookie: carlaCookie, body: { personId: carla, status: "no" } })).status).toBe(400);
    expect((await api(`/events/${training}/remind`, { cookie, body: {} })).body).toMatchObject({ sent: 0 });

    await exec("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?", `${addDays(todayLocal(), -1)}T18:00`, `${addDays(todayLocal(), -1)}T19:30`, training);
    expect((await api(`/events/${training}/unexcused/${dana}`, { method: "PUT", cookie, body: { unexcused: true } })).status).toBe(409);
  });

  it("Anwesenheit: Optionale nur mit Zusage", async () => {
    const other = await person("Olga");
    await member(other, wd);
    await exec("INSERT INTO responses (event_id, person_id, status, responded_at) VALUES (?, ?, 'yes', '2026-01-01T00:00:00Z')", training, dana);
    await exec("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?", `${addDays(todayLocal(), -1)}T18:00`, `${addDays(todayLocal(), -1)}T19:30`, training);
    await recordAttendance(env.DB);
    const recorded = await rows<{ person_id: number; status: string }>("SELECT person_id, status FROM attendance WHERE event_id = ? ORDER BY person_id", training);
    expect(recorded).toEqual(
      [
        { person_id: carla, status: "present" },
        { person_id: dana, status: "present" },
        { person_id: both, status: "present" },
      ].sort((a, b) => a.person_id - b.person_id),
    );
  });

  it("pro Termin umschaltbar, bleibt beim Neugenerieren, nie alle optional", async () => {
    let res = await api(`/events/${training}/teams/${wd}/optional`, { method: "PUT", cookie, body: { optional: false } });
    expect(res.status).toBe(200);
    expect(part(res.body, dana)).toMatchObject({ status: "yes", optional: false });
    await generateTrainings(env.DB);
    expect(part(await detail(training), dana).optional).toBe(false);
    // Andere Termine folgen weiter der Regel
    const later = await one<{ optional: number }>(
      "SELECT et.optional FROM event_teams et JOIN events e ON e.id = et.event_id WHERE et.team_id = ? AND e.id <> ? ORDER BY e.starts_at LIMIT 1",
      wd,
      training,
    );
    expect(later.optional).toBe(1);
    res = await api(`/events/${training}/teams/${wc}/optional`, { method: "PUT", cookie, body: { optional: true } });
    expect(res.status).toBe(200);
    res = await api(`/events/${training}/teams/${wd}/optional`, { method: "PUT", cookie, body: { optional: true } });
    expect(res.status).toBe(400);
    const outsider = await loginAs(await person("Uwe"));
    expect((await api(`/events/${training}/teams/${wd}/optional`, { method: "PUT", cookie: outsider, body: { optional: false } })).status).toBe(403);
  });

  it("Regel ändern: aus optional wird Pflicht für alle künftigen Termine", async () => {
    const rule = await one<{ id: number; weekday: number; location_id: number }>("SELECT id, weekday, location_id FROM training_rules LIMIT 1");
    const res = await api(`/rules/${rule.id}`, {
      method: "PATCH",
      cookie,
      body: { weekday: rule.weekday, startsAt: "18:00", endsAt: "19:30", locationId: rule.location_id, teamIds: [wd], optionalTeamIds: [] },
    });
    expect(res.status).toBe(200);
    expect(part(await detail(training), dana)).toMatchObject({ status: "yes", optional: false });
    const bad = await api(`/rules/${rule.id}`, {
      method: "PATCH",
      cookie,
      body: { weekday: rule.weekday, startsAt: "18:00", endsAt: "19:30", locationId: rule.location_id, teamIds: [wd], optionalTeamIds: [wc, wd] },
    });
    expect(bad.status).toBe(400);
  });
});
