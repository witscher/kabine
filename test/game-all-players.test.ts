// Whole team at games: every player takes part, the nomination only decides who plays. Pushes still go to the
// nominated players only. Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sendGameReminders } from "../worker/cron";
import type { PushJob } from "../worker/domain/notify";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, season, team, upgradeFrom } from "./helpers";

let wd: number;
let coach: number;
let ida: number;
let lea: number;
let mona: number;
let coachCookie: string;
let idaCookie: string;
let leaCookie: string;
let game: number;

const pushes: PushJob[] = [];
const testEnv = () => ({ ...env, PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } }) as unknown as Env;
const accountOf = async (personId: number) => (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;

beforeEach(async () => {
  await freshDb();
  await season();
  pushes.length = 0;
  wd = await team("mD", "mD");
  coach = await person("Theo");
  ida = await person("Ida", { birthYear: 2014 });
  lea = await person("Lea", { birthYear: 2014 });
  mona = await person("Mona");
  await member(coach, wd, "coach");
  await member(ida, wd);
  await member(lea, wd);
  await guardian(mona, lea);
  coachCookie = await loginAs(coach);
  idaCookie = await loginAs(ida);
  leaCookie = await loginAs(lea);
  await loginAs(mona);
  game = await eventIn(wd, 2, { kind: "game" });
  await exec("UPDATE events SET is_home = 0, home_team = 'HSG Gegner', guest_team = 'SV Musterstadt' WHERE id = ?", game);
  await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
});

const mine = async (cookie: string, personId: number) => (await api(`/events/${game}`, { cookie })).body.mine.find((m: any) => m.person.id === personId);

describe("Ganze Mannschaft bei Spielen dabei", () => {
  it("ausgeschaltet wie bisher: nur Nominierte sind Teilnehmer", async () => {
    expect(await mine(leaCookie, lea)).toMatchObject({ participant: false, nominated: false });
    expect((await api(`/events/${game}`, { cookie: leaCookie })).body.game.allPlayers).toBe(false);
  });

  it("alle Spieler sind dabei und sagen ab; die Nominierung legt fest, wer spielt", async () => {
    expect((await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { gameAllPlayers: true } })).status).toBe(200);
    expect((await api(`/teams/${wd}`, { cookie: coachCookie })).body.gameAllPlayers).toBe(true);

    // Before the squad: taking part, accepted, counts visible
    const before = (await api(`/events/${game}`, { cookie: leaCookie })).body;
    expect(before.game).toMatchObject({ allPlayers: true, squadPublished: false, nominatedCount: 0 });
    expect(before.counts).toMatchObject({ yes: 2 });
    expect(await mine(leaCookie, lea)).toMatchObject({ participant: true, nominated: false, status: "yes" });

    // Squad: only Ida plays
    expect((await api(`/events/${game}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [ida] } })).status).toBe(200);
    expect(await mine(idaCookie, ida)).toMatchObject({ participant: true, nominated: true });
    expect(await mine(leaCookie, lea)).toMatchObject({ participant: true, nominated: false, status: "yes" });
    const detail = (await api(`/events/${game}`, { cookie: coachCookie })).body;
    expect(detail.game.nominatedCount).toBe(1);
    expect(detail.participants.map((p: any) => [p.person.id, p.nominated])).toEqual(expect.arrayContaining([[ida, true], [lea, false]]));

    // Lea declines, with a reason; the coach sees it in the nomination
    expect((await api(`/events/${game}/responses`, { cookie: leaCookie, body: { personId: lea, status: "no", reason: "Geburtstag" } })).status).toBe(200);
    expect(await mine(leaCookie, lea)).toMatchObject({ status: "no" });
    const squad = (await api(`/events/${game}/squad`, { cookie: coachCookie })).body;
    expect(squad.candidates.find((c: any) => c.person.id === lea)).toMatchObject({ nominated: false, status: "no", reason: "Geburtstag" });
  });

  it("nicht für Gruppen", async () => {
    const adminCookie = await loginAs(await person("Anna", { admin: true }));
    const g = (await api("/groups", { cookie: adminCookie, body: { name: "Trainerteam" } })).body.id;
    expect(g).toBeTruthy();
    const res = await api(`/teams/${g}`, { method: "PATCH", cookie: adminCookie, body: { gameAllPlayers: true } });
    expect(res.body.error?.code).toBe("group_not_supported");
  });

  it("Fahrgemeinschaften für alle Teilnehmer, auch vor dem Kader und ohne Nominierung", async () => {
    expect((await api(`/events/${game}`, { cookie: await loginAs(mona) })).body.modules.carpools).toBeUndefined();
    await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { gameAllPlayers: true } });
    expect((await api(`/events/${game}`, { cookie: await loginAs(mona) })).body.modules.carpools).toMatchObject({ canOffer: true });
  });

  it("Pushes nur an Nominierte: Erinnerung vorher, keine kurzfristige Absage-Push für Nicht-Nominierte", async () => {
    await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { gameAllPlayers: true } });
    await api(`/events/${game}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [ida] } });
    pushes.length = 0;
    await sendGameReminders(testEnv(), Date.now() + 25 * 3_600_000);
    const reminded = pushes.filter((p) => p.payload.title === "Du bist im Kader").flatMap((p) => p.accountIds);
    expect(reminded).toContain(await accountOf(ida));
    expect(reminded).not.toContain(await accountOf(lea));
    expect(reminded).not.toContain(await accountOf(mona));

    // Short-notice decline (deadline 72 hours before the game has passed): only for nominated players to the coach
    await exec("UPDATE teams SET decline_hours_game = 72 WHERE id = ?", wd);
    const decline = async (cookie: string, personId: number) => {
      pushes.length = 0;
      const { default: worker } = await import("../worker/index");
      const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
      const ctx = createExecutionContext();
      await worker.fetch(
        new Request(`http://localhost:5173/api/events/${game}/responses`, {
          method: "POST",
          headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" },
          body: JSON.stringify({ personId, status: "no", reason: "Krank" }),
        }),
        testEnv(),
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return pushes.filter((p) => p.payload.title === "Kurzfristige Absage").length;
    };
    expect(await decline(leaCookie, lea)).toBe(0);
    expect(await decline(idaCookie, ida)).toBe(1);
  });
});

describe("migration 202611092300_core_game-all-players.sql", () => {
  it("existing teams stay as they were: only nominated players take part", async () => {
    await upgradeFrom("202611092300_core_game-all-players.sql");
    const id = (await one<{ id: number }>("INSERT INTO teams (name, age_class_code) VALUES ('mC', 'mC') RETURNING id")).id;
    await migrateRest();
    expect(await one("SELECT game_all_players FROM teams WHERE id = ?", id)).toEqual({ game_all_players: 0 });
  });
});
