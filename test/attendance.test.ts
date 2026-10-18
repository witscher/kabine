// Anwesenheitsprotokoll und Saisonstatistik. Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordAttendance, seasonStatsStatements } from "../worker/domain/attendance";
import { api, eventIn, exec, freshDb, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let coach: number;
let mia: number;
let ella: number;
let nina: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Tina");
  mia = await person("Mia", { birthYear: 2014 });
  ella = await person("Ella", { birthYear: 2014 });
  nina = await person("Nina", { birthYear: 2014, active: false });
  await member(coach, wd, "coach");
  await member(mia, wd);
  await member(ella, wd);
  await member(nina, wd);
});

const statusOf = async (eventId: number) =>
  Object.fromEntries((await rows<{ person_id: number; status: string }>("SELECT person_id, status FROM attendance WHERE event_id = ?", eventId)).map((r) => [r.person_id, r.status]));

describe("Anwesenheitsprotokoll", () => {
  it("schreibt begonnene Termine einmal fest, spätere Änderungen wirken nicht zurück", async () => {
    const past = await eventIn(wd, -3);
    const future = await eventIn(wd, 2);
    const cancelled = await eventIn(wd, -2);
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", cancelled);
    await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'krank', '2026-01-01T00:00:00Z')", past, ella);

    expect(await recordAttendance(env.DB)).toBe(1);
    expect(await statusOf(past)).toEqual({ [mia]: "present", [ella]: "declined", [nina]: "inactive" });
    expect(await statusOf(future)).toEqual({});
    expect(await statusOf(cancelled)).toEqual({});

    // Danach ändert sich die Mannschaft: kein Einfluss auf das Protokoll
    const neu = await person("Lotta", { birthYear: 2014 });
    await member(neu, wd);
    await exec("UPDATE persons SET is_active = 1 WHERE id = ?", nina);
    expect(await recordAttendance(env.DB)).toBe(0);
    expect(await statusOf(past)).toEqual({ [mia]: "present", [ella]: "declined", [nina]: "inactive" });
  });

  it("„fehlt unentschuldigt“ zieht das Protokoll nach, auch zurück", async () => {
    const past = await eventIn(wd, -3);
    await recordAttendance(env.DB);
    const cookie = await loginAs(coach);
    expect((await api(`/events/${past}/unexcused/${mia}`, { method: "PUT", cookie, body: { unexcused: true } })).status).toBe(200);
    expect((await statusOf(past))[mia]).toBe("unexcused");
    await api(`/events/${past}/unexcused/${mia}`, { method: "PUT", cookie, body: { unexcused: false } });
    expect((await statusOf(past))[mia]).toBe("present");
  });

  it("Spiele: nur Nominierte", async () => {
    const game = await eventIn(wd, -1, { kind: "game" });
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", game, mia);
    await recordAttendance(env.DB);
    expect(await statusOf(game)).toEqual({ [mia]: "present" });
  });
});

describe("Kurzfristige Absagen", () => {
  it("werden im Protokoll markiert und in der Saisonstatistik gezählt", async () => {
    const t = await eventIn(wd, -2);
    const g = await eventIn(wd, -1, { kind: "game" });
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", g, mia);
    await exec("INSERT INTO responses (event_id, person_id, status, reason, is_late, responded_at) VALUES (?, ?, 'no', 'krank', 1, '2026-01-01T00:00:00Z')", t, mia);
    await exec("INSERT INTO responses (event_id, person_id, status, reason, is_late, responded_at) VALUES (?, ?, 'no', 'Schule', 0, '2026-01-01T00:00:00Z')", t, ella);
    await exec("INSERT INTO responses (event_id, person_id, status, reason, is_late, responded_at) VALUES (?, ?, 'no', 'krank', 1, '2026-01-01T00:00:00Z')", g, mia);
    await recordAttendance(env.DB);
    expect(await rows("SELECT person_id, status, is_late FROM attendance WHERE event_id = ? AND person_id IN (?, ?) ORDER BY person_id", t, mia, ella)).toEqual([
      { person_id: mia, status: "declined", is_late: 1 },
      { person_id: ella, status: "declined", is_late: 0 },
    ]);
    await env.DB.batch(seasonStatsStatements(env.DB, 1));
    expect(await rows("SELECT metric, value FROM season_stats WHERE person_id = ? AND metric LIKE '%late' ORDER BY metric", mia)).toEqual([
      { metric: "game_late", value: 1 },
      { metric: "training_late", value: 1 },
    ]);
    expect(await rows("SELECT metric FROM season_stats WHERE person_id = ? AND metric LIKE '%late'", ella)).toEqual([]);
  });
});

describe("Saisonstatistik", () => {
  it("verdichtet Protokoll und Dienste und bleibt nach dem Löschen der Termine", async () => {
    const t1 = await eventIn(wd, -10);
    const t2 = await eventIn(wd, -3);
    const game = await eventIn(wd, -1, { kind: "game" });
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?), (?, ?)", game, mia, game, ella);
    await exec("INSERT INTO unexcused_absences (event_id, person_id) VALUES (?, ?)", t2, mia);
    const parent = await person("Paula");
    const b1 = await one<{ id: number }>("INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at) SELECT id, 1, starts_at, starts_at FROM events WHERE id = ? RETURNING id", game);
    const b2 = await one<{ id: number }>("INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at) SELECT id, 4, starts_at, starts_at FROM events WHERE id = ? RETURNING id", game);
    await exec("INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id) VALUES (?, ?, 1, ?), (?, ?, 4, ?)", game, b1.id, parent, game, b2.id, parent);
    await recordAttendance(env.DB);
    expect(t1).toBeTruthy();

    await env.DB.batch(seasonStatsStatements(env.DB, 1));
    await exec("DELETE FROM events");
    const stats = await rows<{ person_id: number; team_name: string; metric: string; value: number }>(
      "SELECT person_id, team_name, metric, value FROM season_stats WHERE season_id = 1 ORDER BY person_id, metric",
    );
    const of = (p: number) => Object.fromEntries(stats.filter((s) => s.person_id === p).map((s) => [s.metric, s.value]));
    expect(of(mia)).toEqual({ game_present: 1, game_total: 1, training_present: 1, training_total: 2, training_unexcused: 1 });
    expect(of(ella)).toEqual({ game_present: 1, game_total: 1, training_present: 2, training_total: 2 });
    // Inaktiv zählt nicht als erwartet
    expect(of(nina)).toEqual({});
    expect(of(parent)).toEqual({ duties: 2 });
    expect(stats.every((s) => s.team_name === "wD")).toBe(true);
  });

  it("Saisonwechsel schreibt die Statistik fest", async () => {
    await eventIn(wd, -3);
    await exec("INSERT INTO seasons (id, name, starts_on, ends_on, is_current) VALUES (2, '2027/28', '2027-07-01', '2028-06-30', 0)");
    const admin = await person("Ada", { admin: true });
    const res = await api("/season-change/execute", {
      cookie: await loginAs(admin),
      body: { seasonId: 2, confirmName: "2027/28", assignments: [{ personId: mia, teamIds: [wd], former: false }, { personId: ella, teamIds: [wd], former: false }] },
    });
    expect(res.status).toBe(200);
    expect(await rows("SELECT metric, value FROM season_stats WHERE season_id = 1 AND person_id = ? ORDER BY metric", mia)).toEqual([
      { metric: "training_present", value: 1 },
      { metric: "training_total", value: 1 },
    ]);
    expect(await rows("SELECT * FROM attendance")).toEqual([]);
  });
});
