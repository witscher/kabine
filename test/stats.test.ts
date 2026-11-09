// Statistics: coaches per team, players and parents for themselves, helper duties per family (helper duties
// module). Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PushJob } from "../worker/domain/notify";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "./helpers";

let md: number;
let coach: number;
let jonas: number;
let emil: number;
let paul: number;
let lukas: number;
let lotta: number;
let ben: number;
let anja: number;
let petra: number;
let ute: number;
let tom: number;
let coachCookie: string;
let t1: number;
let t2: number;
let t3: number;
let g1: number;
let g2: number;

/** Record entry as after recording */
async function att(eventId: number, personId: number, status: string, opts: { late?: boolean; nominated?: boolean; helper?: boolean; kind?: string } = {}) {
  await exec(
    "INSERT INTO attendance (event_id, person_id, team_id, kind, status, is_helper, is_late, nominated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    eventId,
    personId,
    md,
    opts.kind ?? "training",
    status,
    opts.helper ? 1 : 0,
    opts.late ? 1 : 0,
    opts.nominated ? 1 : 0,
  );
  await exec("UPDATE events SET attendance_recorded_at = '2026-01-01T00:00:00Z' WHERE id = ?", eventId);
}

async function block(eventId: number, typeId: number, slots: number) {
  return (
    await one<{ id: number }>(
      "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) SELECT id, ?, starts_at, starts_at, ? FROM events WHERE id = ? RETURNING id",
      typeId,
      slots,
      eventId,
    )
  ).id;
}

async function duty(blockId: number, who: { personId?: number; childId?: number; manual?: string }) {
  await exec(
    "INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id, child_id, manual_name) SELECT event_id, id, duty_type_id, ?, ?, ? FROM event_duties WHERE id = ?",
    who.personId ?? null,
    who.childId ?? null,
    who.manual ?? null,
    blockId,
  );
}

beforeEach(async () => {
  await freshDb();
  await season();
  md = await team("mD", "mD");
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", md);
  coach = await person("Theo");
  jonas = await person("Jonas", { lastName: "Berg", birthYear: 2014 });
  emil = await person("Emil", { lastName: "Kern", birthYear: 2014 });
  paul = await person("Paul", { lastName: "Mohr", birthYear: 2014 });
  lukas = await person("Lukas", { lastName: "Haas", birthYear: 2014 });
  lotta = await person("Lotta", { lastName: "Haas", birthYear: 2015 });
  ben = await person("Ben", { lastName: "Tal", birthYear: 2013 });
  anja = await person("Anja", { lastName: "Berg" });
  petra = await person("Petra", { lastName: "Haas" });
  ute = await person("Ute", { lastName: "Tal" });
  tom = await person("Tom", { lastName: "Mohr" });
  await member(coach, md, "coach");
  for (const p of [jonas, emil, paul, lukas, lotta]) await member(p, md);
  await member(ben, md, "helper");
  await guardian(anja, jonas);
  await guardian(petra, lukas);
  await guardian(petra, lotta);
  await guardian(ute, ben);
  await guardian(tom, paul);
  coachCookie = await loginAs(coach);

  // Two trainings in the last 4 weeks, one before (season)
  t1 = await eventIn(md, -3);
  t2 = await eventIn(md, -10);
  t3 = await eventIn(md, -40);
  g1 = await eventIn(md, -5, { kind: "game", time: "14:00" });
  await exec("UPDATE events SET is_home = 1, home_team = 'SV Musterstadt', guest_team = 'SG Gegner' WHERE id = ?", g1);
  await att(t1, jonas, "present");
  await att(t1, emil, "declined", { late: true });
  await att(t1, paul, "unexcused");
  await att(t1, lukas, "standing");
  await att(t1, lotta, "present");
  await att(t1, ben, "present", { helper: true });
  await att(t2, jonas, "present");
  await att(t2, emil, "present");
  await att(t2, paul, "declined");
  await att(t2, lukas, "standing");
  await att(t2, lotta, "open");
  await att(t3, jonas, "declined");
  await att(t3, emil, "present");
  await att(t3, paul, "present");
  await att(t3, lukas, "present");
  await att(t3, lotta, "present");
  await att(g1, jonas, "present", { kind: "game", nominated: true });
  await att(g1, emil, "present", { kind: "game" });
  await att(g1, paul, "declined", { kind: "game", nominated: true });
  await att(g1, lotta, "unexcused", { kind: "game", nominated: true });

  // Helper duties: past game g1, upcoming home game g2
  g2 = await eventIn(md, 5, { kind: "game", time: "14:00" });
  const past = await block(g1, 1, 2);
  await duty(past, { personId: anja, childId: jonas });
  await duty(past, { manual: "Opa Karl" });
  const next = await block(g2, 1, 4);
  await duty(next, { personId: petra, childId: lotta });
  await duty(next, { personId: ute, childId: ben });
  await duty(next, { personId: coach });
  // The youth referee (approved people from all teams) does not count
  await duty(await block(g2, 5, 1), { personId: emil });
});

const stats = async (range: "4w" | "season", cookie = coachCookie) => api(`/teams/${md}/stats?range=${range}`, { cookie });
const helpers = async (range: "4w" | "season", cookie = coachCookie) => api(`/duties/teams/${md}/stats?range=${range}`, { cookie });
const playerOf = (body: any, id: number) => body.players.find((p: any) => p.person.id === id);

describe("Statistik für Trainer", () => {
  it("letzte 4 Wochen: zählt nur erwartete Termine, Wochen, Spiele mit Einsätzen", async () => {
    const { status, body } = await stats("4w");
    expect(status).toBe(200);
    expect(body).toMatchObject({ range: "4w", from: addDays(todayLocal(), -27), trainings: 2, games: 1, avgSquad: 3 });
    expect(body.players.map((p: any) => p.person.firstName)).toEqual(["Emil", "Jonas", "Lotta", "Lukas", "Paul"]); // without the stand-in
    expect(body.helperPlan).toBe(true);
    expect(playerOf(body, jonas).training).toMatchObject({ expected: 2, present: 2 });
    expect(playerOf(body, emil).training).toMatchObject({ expected: 2, present: 1, declined: 1, late: 1 });
    expect(playerOf(body, paul).training).toMatchObject({ expected: 2, present: 0, declined: 1, unexcused: 1 });
    expect(playerOf(body, lukas).training).toMatchObject({ expected: 0, standing: 2 });
    expect(playerOf(body, lotta).training).toMatchObject({ expected: 2, present: 1, open: 1 });
    // Per event, newest first: the real number with the stand-in (Ben at t1), without those away long-term
    expect(body.events.map((e: any) => [e.eventId, e.present, e.expected, e.unexcused])).toEqual([
      [t1, 3, 5, 1],
      [g1, 2, 4, 1],
      [t2, 2, 4, 0],
    ]);
    // Games: an appearance is nominated and present
    expect(playerOf(body, jonas).games).toMatchObject({ expected: 1, played: 1 });
    expect(playerOf(body, emil).games).toMatchObject({ expected: 1, played: 0, presentNotNominated: 1 });
    expect(playerOf(body, paul).games).toMatchObject({ declined: 1 });
    expect(playerOf(body, lotta).games).toMatchObject({ unexcused: 1 });
  });

  it("Saison: auch ältere Termine, „Daten seit“ wenn die App später anfing", async () => {
    const { body } = await stats("season");
    expect(body).toMatchObject({ range: "season", from: "2026-07-01", trainings: 3 });
    expect(body.events).toHaveLength(4);
    expect(body.dataSince).toBe(addDays(todayLocal(), -40));
    expect(playerOf(body, jonas).training).toMatchObject({ expected: 3, present: 2, declined: 1 });
    expect(playerOf(body, lukas).training).toMatchObject({ expected: 1, present: 1, standing: 2 });
  });

  it("einzelne Termine einer Person, neueste zuerst", async () => {
    const { body } = await api(`/teams/${md}/stats/persons/${paul}?range=4w`, { cookie: coachCookie });
    expect(body.events.map((e: any) => [e.eventId, e.status, e.nominated])).toEqual([
      [t1, "unexcused", false],
      [g1, "declined", true],
      [t2, "declined", false],
    ]);
    expect(body.events[1].title).toBe("SG Gegner");
  });

  it("nur Trainer der Mannschaft und Admins", async () => {
    expect((await stats("4w", await loginAs(jonas))).status).toBe(403);
    expect((await stats("4w", await loginAs(anja))).status).toBe(403);
    const other = await person("Olga");
    await member(other, await team("wC", "wC"), "coach");
    expect((await stats("4w", await loginAs(other))).status).toBe(403);
    expect((await api(`/teams/${md}/stats/persons/${paul}`, { cookie: await loginAs(other) })).status).toBe(403);
    expect((await stats("4w", await loginAs(await person("Ada", { admin: true })))).status).toBe(200);
    expect((await api(`/teams/${md}/stats?range=jahr`, { cookie: coachCookie })).status).toBe(400);
  });
});

describe("Helfer je Familie", () => {
  it("erledigte und eingetragene Dienste, Geschwister als eine Familie, Aushilfen markiert, Rest unter „weitere“", async () => {
    const { body } = await helpers("season");
    expect(body).toMatchObject({ done: 2, planned: 3, others: 2, openSlots: 1, remindedToday: false });
    const fam = (childId: number) => body.families.find((f: any) => f.children.some((c: any) => c.id === childId));
    expect(fam(jonas)).toMatchObject({ done: 1, planned: 0, helper: false, guardians: [expect.objectContaining({ id: anja, hasAccount: false })] });
    expect(fam(lukas)).toBe(fam(lotta));
    expect(fam(lotta)).toMatchObject({ done: 0, planned: 1, children: [expect.objectContaining({ id: lotta }), expect.objectContaining({ id: lukas })] });
    expect(fam(ben)).toMatchObject({ planned: 1, helper: true });
    expect(fam(emil)).toMatchObject({ done: 0, planned: 0, guardians: [] });
    expect(fam(paul)).toMatchObject({ done: 0, planned: 0 });
    expect(body.families).toHaveLength(5);

    // 4 weeks: g1 is in it, upcoming duties always count
    expect((await helpers("4w")).body).toMatchObject({ done: 2, planned: 3 });
    // Without a helper plan no helper figures
    await exec("UPDATE teams SET helper_plan = 0 WHERE id = ?", md);
    expect((await stats("season")).body.helperPlan).toBe(false);
    expect((await helpers("season")).body.error.code).toBe("no_helper_plan");
    // Only coaches of the team and admins
    await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", md);
    expect((await helpers("season", await loginAs(anja))).status).toBe(403);
  });

  it("Erinnerung an Familien ohne Dienst: an die Eltern, mit Ansporn, einmal am Tag", async () => {
    const pushes: PushJob[] = [];
    const testEnv = { ...env, PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } } as unknown as Env;
    await loginAs(tom);
    await loginAs(petra);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
    const remind = async (cookie: string, body: unknown = { range: "season" }) => {
      const { default: worker } = await import("../worker/index");
      const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
      const ctx = createExecutionContext();
      const res = await worker.fetch(
        new Request(`http://localhost:5173/api/duties/teams/${md}/stats/remind`, {
          method: "POST",
          headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        testEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return { status: res.status, body: (await res.json()) as any };
    };

    expect((await remind(await loginAs(jonas))).status).toBe(403);
    const first = await remind(coachCookie);
    expect(first).toMatchObject({ status: 200, body: { families: 2, accounts: 1, message: "Erinnerung an 2 Familien verschickt." } });
    const tomAccount = (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", tom)).id;
    const sent = pushes.filter((p) => p.payload.title === "Helfer gesucht · mD");
    expect(sent.flatMap((p) => p.accountIds)).toEqual([tomAccount]);
    expect(sent[0]!.payload.body).toContain("2 von 4 Familien haben schon geholfen");
    expect(sent[0]!.payload.url).toBe(`/helfer?mannschaft=${md}`);

    expect((await remind(coachCookie)).body.error.code).toBe("already_reminded");
    expect((await helpers("season")).body.remindedToday).toBe(true);
  });

  it("ohne freie Plätze keine Erinnerung", async () => {
    await exec("UPDATE event_duties SET slots = 3 WHERE event_id = ? AND duty_type_id = 1", g2);
    const res = await api(`/duties/teams/${md}/stats/remind`, { cookie: coachCookie, body: {} });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("no_open_slots");
  });
});

describe("Eigene Statistik", () => {
  it("Spieler sieht sich, Eltern sehen das Kind mit den Diensten der Familie", async () => {
    const own = (await api("/stats/me", { cookie: await loginAs(paul) })).body;
    expect(own.persons).toHaveLength(1);
    expect(own.persons[0]).toMatchObject({ self: true, person: { id: paul } });
    expect(own.persons[0].teams[0].ranges["4w"].training).toMatchObject({ expected: 2, declined: 1, unexcused: 1 });
    expect(own.persons[0].teams[0].ranges.season.training).toMatchObject({ expected: 3, present: 1 });

    const mom = (await api("/stats/me", { cookie: await loginAs(petra) })).body;
    expect(mom.persons.map((p: any) => [p.person.id, p.self])).toEqual([
      [lotta, false],
      [lukas, false],
    ]);
    const lottaTeam = mom.persons[0].teams[0];
    expect(lottaTeam.ranges["4w"].games).toMatchObject({ expected: 1, unexcused: 1 });
    // The family's helper duties come from the helper duties module
    const family = (await api("/duties/stats/me", { cookie: await loginAs(petra) })).body;
    expect(family.persons.find((p: any) => p.personId === lotta).teams[0]).toMatchObject({ teamId: md, done: 0, planned: 1, next: { label: "Kuchen & Theke", name: "Petra" } });

    // Team without parents: parents see nothing
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", md);
    expect((await api("/stats/me", { cookie: await loginAs(petra) })).body.persons).toEqual([]);
    // A coach without a team as player: empty
    expect((await api("/stats/me", { cookie: coachCookie })).body.persons).toEqual([]);
  });
});

describe("migration 202611100100_core_attendance-nominated.sql", () => {
  it("earlier game rows count as nominated (only nominated players took part in games before)", async () => {
    await upgradeFrom("202611100100_core_attendance-nominated.sql");
    await season();
    const t = await team("mC", "mC");
    const p = await person("Ida");
    const g = await eventIn(t, -2, { kind: "game" });
    const tr = await eventIn(t, -3);
    await exec("INSERT INTO attendance (event_id, person_id, team_id, kind, status) VALUES (?, ?, ?, 'game', 'present'), (?, ?, ?, 'training', 'present')", g, p, t, tr, p, t);
    await migrateRest();
    expect(await rows("SELECT kind, nominated FROM attendance ORDER BY kind")).toEqual([
      { kind: "game", nominated: 1 },
      { kind: "training", nominated: 0 },
    ]);
  });
});
