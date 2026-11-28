// "Elsewhere" for coaches: events of other teams and groups where their players take part. Invented names.
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, hall, loginAs, member, one, person, season, team } from "./helpers";

let wc1: number;
let wc2: number;
let keepers: number;
let kid: number;
let dad: number;
let coach: number;
let keeperCoach: number;
let otherCoach: number;
let admin: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wc1 = await team("wC1", "wC");
  wc2 = await team("wC2", "wC", { level: 2 });
  keepers = await team("Goalkeepers", "wC");
  await exec("UPDATE teams SET kind = 'group' WHERE id = ?", keepers);
  kid = await person("Kira", { birthYear: 2013 });
  dad = await person("Theo");
  coach = await person("Carla");
  keeperCoach = await person("Gerd");
  otherCoach = await person("Olaf");
  admin = await person("Ada", { admin: true });
  await member(kid, wc1);
  await member(kid, keepers);
  await guardian(dad, kid);
  await member(coach, wc1, "coach");
  await member(keeperCoach, keepers, "coach");
  await member(otherCoach, wc2, "coach");
});

type Entry = { person: { id: number }; event: { id: number; kind: string }; status: string };
const sameDay = async (eventId: number, cookie: string) => (await api(`/events/${eventId}`, { cookie })).body.elsewhere as Entry[] | null;
const pairs = (list: Entry[] | null) => (list ?? []).map((x) => [x.event.id, x.status]);

describe("Elsewhere", () => {
  it("coaches see on their event and on the player page the events of other groups, with status, without reasons", async () => {
    const own = await eventIn(wc1, 1, { time: "18:00" });
    const group = await eventIn(keepers, 1, { kind: "special", title: "Goalkeeper training 2", time: "18:30" });
    const later = await eventIn(keepers, 5, { kind: "special", title: "Goalkeeper training 3", time: "18:30" });
    await eventIn(keepers, 20, { kind: "special", title: "Too far ahead" });
    await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'Dentist', '2026-01-01T00:00:00Z')", group, kid);

    const coachCookie = await loginAs(coach);
    const detail = (await api(`/events/${own}`, { cookie: coachCookie })).body;
    expect(detail.elsewhere).toHaveLength(1);
    expect(detail.elsewhere[0]).toMatchObject({
      person: { id: kid, firstName: "Kira" },
      status: "no",
      event: { id: group, kind: "special", title: "Goalkeeper training 2", teams: ["Goalkeepers"] },
    });
    expect(JSON.stringify(detail.elsewhere)).not.toContain("Dentist");
    expect(Object.keys(detail.elsewhere[0]).sort()).toEqual(["event", "person", "status"]);

    // Player page: next two weeks, without the own team
    const entries = (await api(`/teams/${wc1}/players/${kid}/elsewhere`, { cookie: coachCookie })).body.entries as Entry[];
    expect(pairs(entries)).toEqual([
      [group, "no"],
      [later, "yes"],
    ]);
    expect(JSON.stringify(entries)).not.toContain("Dentist");

    // The other way round, the group's coach sees the wC1 training; admins see it too
    expect(pairs(await sameDay(group, await loginAs(keeperCoach)))).toEqual([[own, "yes"]]);
    expect(pairs(await sameDay(own, await loginAs(admin)))).toEqual([[group, "no"]]);
    expect((await api(`/teams/${wc1}/players/${kid}/elsewhere`, { cookie: await loginAs(admin) })).status).toBe(200);
  });

  it("only coaches and admins of the team; 404 for people who do not play in it", async () => {
    const own = await eventIn(wc1, 1);
    await eventIn(keepers, 1, { kind: "special", title: "Goalkeeper training" });
    await exec("UPDATE teams SET show_responses = 1 WHERE id = ?", wc1);
    // Parents and the player themselves see the event, but not where else
    for (const who of [dad, kid]) {
      const cookie = await loginAs(who);
      const res = await api(`/events/${own}`, { cookie });
      expect(res.status).toBe(200);
      expect(res.body.elsewhere).toBeNull();
      expect((await api(`/teams/${wc1}/players/${kid}/elsewhere`, { cookie })).status).toBe(403);
    }
    // Coach of another team
    expect((await api(`/teams/${wc1}/players/${kid}/elsewhere`, { cookie: await loginAs(otherCoach) })).status).toBe(403);
    const coachCookie = await loginAs(coach);
    // Not a player of the team: the parent, the coach, a player of another team
    expect((await api(`/teams/${wc1}/players/${dad}/elsewhere`, { cookie: coachCookie })).status).toBe(404);
    expect((await api(`/teams/${wc1}/players/${coach}/elsewhere`, { cookie: coachCookie })).status).toBe(404);
    const stranger = await person("Sina");
    await member(stranger, wc2);
    expect((await api(`/teams/${wc1}/players/${stranger}/elsewhere`, { cookie: coachCookie })).status).toBe(404);
    expect((await api(`/teams/${wc1}/players/${stranger}/elsewhere`, { cookie: await loginAs(admin) })).status).toBe(404);
    expect((await api(`/teams/${wc1}/players/${kid}/elsewhere`)).status).toBe(401);
  });

  it("games of other teams only with a nomination", async () => {
    const own = await eventIn(wc1, 2, { time: "10:00" });
    const game = await eventIn(wc2, 2, { kind: "game", time: "14:00" });
    // Whole team at games: the not nominated still play nowhere
    await exec("UPDATE teams SET game_all_players = 1 WHERE id = ?", wc2);
    await member(kid, wc2);
    const coachCookie = await loginAs(coach);
    expect(await sameDay(own, coachCookie)).toEqual([]);
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", game, kid);
    const list = await sameDay(own, coachCookie);
    expect(list!.map((x) => [x.event.id, x.event.kind, x.status])).toEqual([[game, "game", "yes"]]);
  });

  it("nominated as a guest player in a team they are not a member of", async () => {
    const own = await eventIn(wc1, 2, { time: "10:00" });
    const game = await eventIn(wc2, 2, { kind: "game", time: "14:00" });
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", game, kid);
    expect(pairs(await sameDay(own, await loginAs(coach)))).toEqual([[game, "yes"]]);
  });

  it("standing absences show as such, without the reason", async () => {
    const own = await eventIn(wc1, 1, { time: "17:00" });
    const training = await eventIn(keepers, 1, { time: "19:00" });
    const today = todayLocal();
    const plan = await one<{ id: number }>(
      "INSERT INTO training_plans (team_id, name, kind, valid_from, valid_to) VALUES (?, 'Season', 'regular', ?, ?) RETURNING id",
      keepers,
      today,
      addDays(today, 30),
    );
    const rule = await one<{ id: number }>(
      "INSERT INTO training_rules (plan_id, weekday, starts_at, ends_at, location_id) VALUES (?, 1, '19:00', '20:00', ?) RETURNING id",
      plan.id,
      await hall(),
    );
    await exec("UPDATE events SET rule_id = ?, rule_date = substr(starts_at, 1, 10) WHERE id = ?", rule.id, training);
    await exec("INSERT INTO standing_absences (person_id, rule_id, reason) VALUES (?, ?, 'Music school')", kid, rule.id);
    const list = await sameDay(own, await loginAs(coach));
    expect(pairs(list)).toEqual([[training, "standing"]]);
    expect(JSON.stringify(list)).not.toContain("Music school");
  });

  it("optional events only with a yes", async () => {
    const own = await eventIn(wc1, 3, { time: "17:00" });
    // Optional joint training: the group may join the wC2 training
    const joint = await eventIn(wc2, 3, { time: "19:00" });
    await exec("INSERT INTO event_teams (event_id, team_id, optional) VALUES (?, ?, 1)", joint, keepers);
    const party = await eventIn(keepers, 3, { kind: "special", title: "Optional get-together", time: "20:00" });
    await exec("UPDATE events SET optional_attendance = 1 WHERE id = ?", party);
    const coachCookie = await loginAs(coach);
    expect(await sameDay(own, coachCookie)).toEqual([]);
    await exec("INSERT INTO responses (event_id, person_id, status, responded_at) VALUES (?, ?, 'yes', '2026-01-01T00:00:00Z')", joint, kid);
    await exec("INSERT INTO responses (event_id, person_id, status, responded_at) VALUES (?, ?, 'yes', '2026-01-01T00:00:00Z')", party, kid);
    expect(pairs(await sameDay(own, coachCookie))).toEqual([
      [joint, "yes"],
      [party, "yes"],
    ]);
  });

  it("cancelled events, other days, joint events with the own team, events without attendance and inactive people are left out", async () => {
    const own = await eventIn(wc1, 1, { time: "17:00" });
    const cancelled = await eventIn(keepers, 1, { time: "19:00" });
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", cancelled);
    await eventIn(keepers, 2, { time: "19:00" });
    const joint = await eventIn(keepers, 1, { time: "20:00" });
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", joint, wc1);
    const noAttendance = await eventIn(keepers, 1, { kind: "special", title: "Team photo", time: "16:00" });
    await exec("UPDATE events SET no_attendance = 1 WHERE id = ?", noAttendance);
    const coachCookie = await loginAs(coach);
    expect(await sameDay(own, coachCookie)).toEqual([]);

    const active = await eventIn(keepers, 1, { time: "21:00" });
    expect(pairs(await sameDay(own, coachCookie))).toEqual([[active, "yes"]]);
    await exec("UPDATE persons SET is_active = 0 WHERE id = ?", kid);
    expect(await sameDay(own, coachCookie)).toEqual([]);
    expect((await api(`/teams/${wc1}/players/${kid}/elsewhere`, { cookie: coachCookie })).body.entries).toEqual([]);
  });

  it("club-wide events get no list", async () => {
    const clubWide = await one<{ id: number }>(
      "INSERT INTO events (kind, title, starts_at, club_wide) VALUES ('special', 'Club party', ?, 1) RETURNING id",
      `${addDays(todayLocal(), 1)}T15:00`,
    );
    await eventIn(keepers, 1, { kind: "special", title: "Goalkeeper training" });
    expect(await sameDay(clubWide.id, await loginAs(admin))).toBeNull();
  });
});
