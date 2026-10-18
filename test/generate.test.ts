import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { generateTrainings, plannedOccurrences } from "../worker/domain/generate";
import { exec, freshDb, hall, one, person, rows, season, team, member } from "./helpers";

// Montag, 05.10.2026, 10:00 Uhr Berlin
const NOW = Date.parse("2026-10-05T08:00:00Z");

describe("Geplante Termine (rein)", () => {
  const plans = [
    { id: 1, team_id: 10, kind: "regular" as const, valid_from: "2026-09-14", valid_to: "2027-07-28" },
    { id: 2, team_id: 10, kind: "holiday" as const, valid_from: "2026-10-26", valid_to: "2026-10-30" },
  ];
  const rules = [
    { id: 1, plan_id: 1, weekday: 2, starts_at: "17:00", ends_at: "18:30", location_id: 1 },
    { id: 2, plan_id: 1, weekday: 5, starts_at: "18:00", ends_at: "19:30", location_id: 2 },
  ];

  it("erzeugt Dienstag und Freitag, Ferienplan ohne Regeln bedeutet Pause", () => {
    const occ = plannedOccurrences(plans, rules, new Map([[1, [10, 11]]]), "2026-10-05", "2026-11-08", "2026-10-05T10:00");
    const dates = [...occ.values()].map((o) => o.date).sort();
    expect(dates).toEqual([
      "2026-10-06",
      "2026-10-09",
      "2026-10-13",
      "2026-10-16",
      "2026-10-20",
      "2026-10-23",
      // 27.10. und 30.10. entfallen (Ferienplan)
      "2026-11-03",
      "2026-11-06",
    ]);
    // Gemeinsame Regel: ein Termin für beide Mannschaften
    expect(occ.get("1|2026-10-06")!.teamIds).toEqual([10, 11]);
    expect(occ.get("2|2026-10-09")!.teamIds).toEqual([10]);
  });

  it("lässt vergangene Uhrzeiten von heute weg", () => {
    const occ = plannedOccurrences(plans, rules, new Map(), "2026-10-06", "2026-10-06", "2026-10-06T17:30");
    expect(occ.size).toBe(0);
  });
});

describe("Termingenerierung mit D1", () => {
  let teamId: number;
  let playerId: number;
  let hallA: number;
  let hallB: number;

  beforeEach(async () => {
    await freshDb();
    await season();
    teamId = await team("wD", "wD");
    playerId = await person("Testa");
    await member(playerId, teamId);
    hallA = await hall("Halle A");
    hallB = await hall("Halle B");
    await exec("INSERT INTO training_plans (id, team_id, name, kind, valid_from, valid_to) VALUES (1, ?, 'Plan', 'regular', '2026-09-14', '2027-07-28')", teamId);
    await exec("INSERT INTO training_rules (id, plan_id, weekday, starts_at, ends_at, location_id) VALUES (1, 1, 2, '17:00', '18:30', ?)", hallA);
    await exec("INSERT INTO rule_teams (rule_id, team_id) VALUES (1, ?)", teamId);
  });

  it("ist idempotent", async () => {
    const first = await generateTrainings(env.DB, NOW);
    expect(first.created).toBe(10);
    const second = await generateTrainings(env.DB, NOW);
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    const n = await one<{ n: number }>("SELECT count(*) AS n FROM events");
    expect(n.n).toBe(10);
  });

  it("behält Rückmeldungen bei geänderter Uhrzeit und löscht sie bei anderem Wochentag", async () => {
    await generateTrainings(env.DB, NOW);
    const ev = await one<{ id: number }>("SELECT id FROM events WHERE rule_date = '2026-10-13'");
    await exec("INSERT INTO responses (event_id, person_id, status, responded_at) VALUES (?, ?, 'yes', '2026-10-05T08:00:00Z')", ev.id, playerId);

    await exec("UPDATE training_rules SET starts_at = '17:30', location_id = ? WHERE id = 1", hallB);
    const changed = await generateTrainings(env.DB, NOW);
    expect(changed.updated).toBe(10);
    const after = await one<{ starts_at: string; location_id: number }>("SELECT starts_at, location_id FROM events WHERE id = ?", ev.id);
    expect(after).toEqual({ starts_at: "2026-10-13T17:30", location_id: hallB });
    expect((await rows("SELECT * FROM responses")).length).toBe(1);

    await exec("UPDATE training_rules SET weekday = 3 WHERE id = 1");
    const moved = await generateTrainings(env.DB, NOW);
    expect(moved.deleted).toBe(10);
    expect(moved.created).toBe(10);
    expect((await rows("SELECT * FROM responses")).length).toBe(0);
  });

  it("lässt manuell verschobene Termine in Ruhe", async () => {
    await generateTrainings(env.DB, NOW);
    await exec("UPDATE events SET starts_at = '2026-10-14T19:00', is_detached = 1 WHERE rule_date = '2026-10-13'");
    await exec("UPDATE training_rules SET starts_at = '16:00' WHERE id = 1");
    await generateTrainings(env.DB, NOW);
    const detached = await one<{ starts_at: string }>("SELECT starts_at FROM events WHERE rule_date = '2026-10-13'");
    expect(detached.starts_at).toBe("2026-10-14T19:00");
  });

  it("Ferienplan einer Mannschaft hat Vorrang vor ihrem regulären Plan", async () => {
    await exec("INSERT INTO training_plans (id, team_id, name, kind, valid_from, valid_to) VALUES (2, ?, 'Herbstferien', 'holiday', '2026-10-26', '2026-10-30')", teamId);
    await exec("INSERT INTO training_rules (id, plan_id, weekday, starts_at, ends_at, location_id) VALUES (2, 2, 4, '10:00', '11:30', ?)", hallA);
    await generateTrainings(env.DB, NOW);
    const inHolidays = await rows<{ starts_at: string }>("SELECT starts_at FROM events WHERE starts_at BETWEEN '2026-10-26' AND '2026-10-31' ORDER BY starts_at");
    expect(inHolidays.map((e) => e.starts_at)).toEqual(["2026-10-29T10:00"]);
  });
});
