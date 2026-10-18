// Holiday plans and training breaks as notes in the event overview. Invented names.
import { describe, expect, it } from "vitest";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, exec, freshDb, guardian, hall, loginAs, member, person, season, team } from "./helpers";

async function holidayPlan(teamId: number, name: string, from: number, to: number, withTraining: boolean) {
  const plan = await exec(
    "INSERT INTO training_plans (team_id, name, kind, valid_from, valid_to) VALUES (?, ?, 'holiday', ?, ?)",
    teamId,
    name,
    addDays(todayLocal(), from),
    addDays(todayLocal(), to),
  );
  if (withTraining) {
    await exec("INSERT INTO training_rules (plan_id, weekday, starts_at, ends_at, location_id) VALUES (?, 3, '10:00', '11:30', ?)", plan.meta.last_row_id, await hall());
  }
}

describe("Ferienpläne in der Terminübersicht", () => {
  it("eigene und Kinder-Mannschaften, gleiche Pläne zusammengefasst, vergangene weg", async () => {
    await freshDb();
    await season();
    const wd = await team("wD", "wD");
    const wc = await team("wC", "wC");
    const other = await team("mB", "mB");
    const kim = await person("Kim");
    const parent = await person("Pia");
    await member(kim, wd);
    await member(parent, wc, "coach");
    await guardian(parent, kim);
    await holidayPlan(wd, "Herbstferien", 5, 12, true);
    await holidayPlan(wc, "Herbstferien", 5, 12, true);
    await holidayPlan(wc, "Hallensperrung", -2, 3, false);
    await holidayPlan(other, "Herbstferien", 5, 12, false);
    await holidayPlan(wd, "Sommerferien", -40, -2, false);

    const page = (await api("/events?limit=20", { cookie: await loginAs(parent) })).body;
    expect(page.breaks).toEqual([
      { name: "Hallensperrung", startsOn: addDays(todayLocal(), -2), endsOn: addDays(todayLocal(), 3), training: false, teams: ["wC"] },
      { name: "Herbstferien", startsOn: addDays(todayLocal(), 5), endsOn: addDays(todayLocal(), 12), training: true, teams: ["wC", "wD"] },
    ]);
    const forKim = (await api(`/events?limit=20&team=${wd}`, { cookie: await loginAs(kim) })).body;
    expect(forKim.breaks.map((b: { name: string }) => b.name)).toEqual(["Herbstferien"]);
    expect((await api("/events?limit=20&past=1", { cookie: await loginAs(kim) })).body.breaks).toEqual([]);
  });
});
