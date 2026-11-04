// Hinweise für Trainer auf der Startseite: Spielplan lange nicht abgeglichen, Treffpunkt fehlt. Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveClub } from "../worker/domain/club";
import { SCHEDULE_STALE_DAYS } from "../worker/domain/coach-hints";
import { utcIso } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let md: number;
let coach: string;

const hints = async (cookie: string) => (await api("/coach-hints", { cookie })).body.hints;
const daysAgo = (n: number) => utcIso(Date.now() - n * 86_400_000);

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "D");
  md = await team("mD", "D");
  const carla = await person("Carla");
  await member(carla, wd, "coach");
  coach = await loginAs(carla);
});

describe("Hinweise für Trainer", () => {
  it("Treffpunkt fehlt: nur Spiele der nächsten 3 Tage der eigenen Mannschaften, weg sobald eingetragen", async () => {
    const game = await eventIn(wd, 2, { kind: "game" });
    await exec("UPDATE events SET is_home = 1, home_team = 'SV Musterstadt', guest_team = 'TSV Testdorf' WHERE id = ?", game);
    await eventIn(wd, 5, { kind: "game" });
    await eventIn(wd, 1, { kind: "training" });
    await eventIn(md, 1, { kind: "game" });
    const cancelled = await eventIn(wd, 1, { kind: "game" });
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", cancelled);
    expect(await hints(coach)).toEqual([{ kind: "meeting", eventId: game, team: "wD", startsAt: expect.any(String), opponent: "TSV Testdorf" }]);
    await exec("UPDATE events SET meeting_time = '17:00' WHERE id = ?", game);
    expect(await hints(coach)).toEqual([]);
  });

  it("Spielplan: ab 14 Tagen nach dem Abgleich, nur mit verlinktem Spielplan, nicht wenn die Saison gespielt ist, nicht bei ausgeschaltetem Modul", async () => {
    // Ohne verlinkten Spielplan gibt es nichts abzugleichen
    const upcoming = await eventIn(wd, 10, { kind: "game" });
    expect(await hints(coach)).toEqual([]);
    await exec("DELETE FROM events WHERE id = ?", upcoming);
    await exec("UPDATE teams SET fixture_connector = 'handball4all', fixture_source = '{\"x\":1}', fixture_synced_at = NULL WHERE id = ?", wd);
    expect(await hints(coach)).toEqual([{ kind: "schedule", teamId: wd, team: "wD", days: null, source: "handball4all" }]);
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", daysAgo(SCHEDULE_STALE_DAYS - 1), wd);
    expect(await hints(coach)).toEqual([]);
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", daysAgo(SCHEDULE_STALE_DAYS + 3), wd);
    expect(await hints(coach)).toMatchObject([{ kind: "schedule", days: SCHEDULE_STALE_DAYS + 3 }]);
    // Nur noch vergangene Spiele: die Saison ist gespielt
    const past = await eventIn(wd, -7, { kind: "game" });
    await exec("UPDATE events SET meeting_time = '17:00' WHERE id = ?", past);
    expect(await hints(coach)).toEqual([]);
    await eventIn(wd, 12, { kind: "game" });
    expect(await hints(coach)).toMatchObject([{ kind: "schedule" }]);
    await exec("DELETE FROM events WHERE id = ?", past);
    await saveClub(env.DB, { modules: { handball4all: false } as never });
    expect(await hints(coach)).toEqual([]);
  });

  it("Admins nur für eigene Mannschaften, Spieler bekommen nichts", async () => {
    await eventIn(wd, 1, { kind: "game" });
    const admin = await loginAs(await person("Ada", { admin: true }));
    const player = await person("Pia");
    await member(player, wd);
    expect(await hints(admin)).toEqual([]);
    expect(await hints(await loginAs(player))).toEqual([]);
    expect((await api("/coach-hints")).status).toBe(401);
  });
});
