// Polls module: choice, scheduling, orders, who sees what, editing, sync and reminders. Names invented.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { api, exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "../../../test/helpers";
import { saveClub } from "../../../worker/domain/club";
import type { PushJob } from "../../../worker/domain/notify";
import { addDays, addMinutesLocal, localToInstant, nowLocal, todayLocal } from "../../../worker/lib/time";
import { runPolls } from "../worker/domain";

let wd: number;
let coach: number;
let kim: number;
let ben: number;
let lea: number;
let mona: number;
let paul: number;
let max: number;
let coachCookie: string;
let monaCookie: string;

const later = (days = 7) => `${addDays(todayLocal(), days)}T20:00`;

async function pollsOn() {
  await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, polls: true } });
}

beforeEach(async () => {
  await freshDb();
  await season();
  await pollsOn();
  wd = await team("wD", "wD");
  coach = await person("Tara", { lastName: "Trainer" });
  kim = await person("Kim", { lastName: "Kaiser", birthYear: 2014 });
  ben = await person("Ben", { lastName: "Kaiser", birthYear: 2015 });
  lea = await person("Lea", { lastName: "Lang", birthYear: 2014 });
  mona = await person("Mona", { lastName: "Kaiser" });
  paul = await person("Paul", { lastName: "Kaiser" });
  max = await person("Max", { lastName: "Lang" });
  await member(coach, wd, "coach");
  for (const p of [kim, ben, lea]) await member(p, wd);
  await guardian(mona, kim);
  await guardian(mona, ben);
  await guardian(paul, kim);
  await guardian(paul, ben);
  await guardian(max, lea);
  coachCookie = await loginAs(coach);
  monaCookie = await loginAs(mona);
});

function choice(extra: Record<string, unknown> = {}) {
  return {
    teamId: wd,
    kind: "choice",
    title: "Abschlussfahrt",
    options: [{ label: "Kletterhalle" }, { label: "Freibad" }, { label: "Kino" }],
    whoPlayers: true,
    endsAt: later(),
    ...extra,
  };
}

const badge = async (cookie: string) => (await api("/badge", { cookie })).body;
const openPolls = async (cookie: string) => (await api("/polls/open", { cookie })).body.polls.map((p: any) => p.id);

describe("Auswahl", () => {
  it("Trainer fragt die Spieler: Eltern stimmen für ihre Kinder, Ergebnis ohne Namen, der Trainer sieht Namen und wer fehlt", async () => {
    const created = await api("/polls", { cookie: coachCookie, body: choice() });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    // Mona votes for Ben and Kim, not for herself
    const detail = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    expect(detail.myUnits.map((u: any) => [u.unitId, u.who, u.name])).toEqual([
      [ben, "other", "Ben K."],
      [kim, "other", "Kim K."],
    ]);
    expect(detail.total).toBe(3);
    expect((await badge(monaCookie)).modules).toBe(1);
    expect(await openPolls(monaCookie)).toEqual([id]);
    const [klettern, freibad] = detail.options.map((o: any) => o.id);
    // Only one answer
    const two = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: klettern, value: 1 }, { optionId: freibad, value: 1 }] } });
    expect(two.body.error.code).toBe("single_answer");
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: klettern, value: 1 }] } })).status).toBe(200);
    // Ben still open
    expect((await badge(monaCookie)).modules).toBe(1);
    // Change the vote
    const changed = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: freibad, value: 1 }] } });
    expect(changed.body.myUnits.find((u: any) => u.unitId === kim).answers).toEqual([{ optionId: freibad, size: "", value: 1 }]);
    // Participants see the result without names
    expect(changed.body.tallies).toEqual([{ optionId: freibad, size: "", value: 1, units: 1, quantity: 1 }]);
    expect(changed.body.pending).toBeNull();
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: ben, answers: [{ optionId: freibad, value: 1 }] } });
    expect((await badge(monaCookie)).modules).toBe(0);
    expect(await openPolls(monaCookie)).toEqual([]);

    // Kim with her own access can vote herself
    const kimCookie = await loginAs(kim);
    expect((await api(`/polls/${id}`, { cookie: kimCookie })).body.myUnits.map((u: any) => u.who)).toEqual(["self"]);
    // Mona may not vote for Lea
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: lea, answers: [{ optionId: freibad, value: 1 }] } })).body.error.code).toBe("not_voter");

    // Coach: names and who is missing
    const coachView = (await api(`/polls/${id}`, { cookie: coachCookie })).body;
    expect(coachView.canManage).toBe(true);
    expect(coachView.myUnits).toEqual([]);
    expect(coachView.tallies[0].names).toEqual(["Ben Kaiser", "Kim Kaiser"]);
    expect(coachView.pending).toEqual(["Lea Lang"]);

    // Withdraw a vote
    await api(`/polls/${id}/ballot/${kim}`, { method: "DELETE", cookie: monaCookie });
    expect((await api(`/polls/${id}`, { cookie: coachCookie })).body.voted).toBe(1);
  });

  it("wer nicht dazugehört, sieht die Umfrage nicht; nur Trainer der Mannschaft legen an, vereinsweit nur Admins", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: choice() })).body.id;
    const other = await team("wC", "wC");
    const carla = await person("Carla");
    await member(carla, other);
    const carlaCookie = await loginAs(carla);
    expect((await api(`/polls/${id}`, { cookie: carlaCookie })).status).toBe(404);
    expect((await api("/polls", { cookie: carlaCookie })).body.polls).toEqual([]);
    expect((await api("/polls", { cookie: carlaCookie, body: choice() })).status).toBe(403);
    expect((await api("/polls", { cookie: coachCookie, body: choice({ teamId: null }) })).status).toBe(403);
    // Max is a parent, players are asked: Max votes for Lea
    const maxCookie = await loginAs(max);
    expect((await api("/polls", { cookie: maxCookie })).body.polls.map((p: any) => [p.id, p.openUnits])).toEqual([[id, 1]]);
  });

  it("Ergebnis erst nach dem Ende: Teilnehmer sehen es nach „Beenden“, abstimmen geht dann nicht mehr", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: choice({ results: "after" }) })).body.id;
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    const opt = d.options[0].id;
    const voted = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: opt, value: 1 }] } });
    expect(voted.body.resultsVisible).toBe(false);
    expect(voted.body.tallies).toBeNull();
    expect((await api(`/polls/${id}/close`, { method: "POST", cookie: monaCookie })).status).toBe(403);
    expect((await api(`/polls/${id}/close`, { method: "POST", cookie: coachCookie })).body.poll.open).toBe(false);
    const after = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    expect(after.resultsVisible).toBe(true);
    expect(after.tallies[0].units).toBe(1);
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: ben, answers: [{ optionId: opt, value: 1 }] } })).body.error.code).toBe("closed");
    expect((await badge(monaCookie)).modules).toBe(0);
    // A later end reopens it
    expect((await api(`/polls/${id}`, { method: "PATCH", cookie: coachCookie, body: { endsAt: later(3) } })).body.poll.open).toBe(true);
  });

  it("Mehrfachauswahl, mindestens zwei Antworten, Ende in der Zukunft, jemand muss abstimmen", async () => {
    expect((await api("/polls", { cookie: coachCookie, body: choice({ options: [{ label: "Nur eine" }] }) })).body.error.code).toBe("bad_options");
    expect((await api("/polls", { cookie: coachCookie, body: choice({ endsAt: `${addDays(todayLocal(), -1)}T20:00` }) })).body.error.code).toBe("bad_end");
    expect((await api("/polls", { cookie: coachCookie, body: choice({ whoPlayers: false }) })).body.error.code).toBe("no_voters");
    const id = (await api("/polls", { cookie: coachCookie, body: choice({ multiple: true }) })).body.id;
    const [a, b] = (await api(`/polls/${id}`, { cookie: monaCookie })).body.options.map((o: any) => o.id);
    const res = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: a, value: 1 }, { optionId: b, value: 1 }] } });
    expect(res.status).toBe(200);
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: ben, answers: [] } })).body.error.code).toBe("no_answer");
  });
});

describe("Terminfindung", () => {
  it("je Familie: eine gemeinsame Stimme, Teilnehmer sehen Namen; anonym sieht niemand Namen", async () => {
    const options = [{ startsAt: addDays(todayLocal(), 20) }, { startsAt: `${addDays(todayLocal(), 21)}T15:00` }];
    const id = (
      await api("/polls", { cookie: coachCookie, body: { teamId: wd, kind: "schedule", title: "Sommerfest", options, whoPlayers: true, whoParents: true, perFamily: true, endsAt: later() } })
    ).body.id;
    expect((await api("/polls", { cookie: coachCookie, body: { teamId: wd, kind: "schedule", title: "Doppelt", options: [options[0], options[0]], whoPlayers: true, endsAt: later() } })).body.error.code).toBe(
      "bad_options",
    );
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    // The Kaiser family and the Lang family
    expect(d.total).toBe(2);
    expect(d.myUnits.map((u: any) => u.who)).toEqual(["family"]);
    const unit = d.myUnits[0].unitId;
    const [a, b] = d.options.map((o: any) => o.id);
    // Every date needs an answer
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: unit, answers: [{ optionId: a, value: 2 }] } })).body.error.code).toBe("no_answer");
    // Paul votes, Mona sees it
    const paulCookie = await loginAs(paul);
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: paulCookie, body: { unitId: unit, answers: [{ optionId: a, value: 2 }, { optionId: b, value: 1 }] } })).status).toBe(200);
    const mine = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    expect(mine.myUnits[0].votedBy).toBe("Paul");
    expect((await badge(monaCookie)).modules).toBe(0);
    // Kim (child with access) belongs to the family and sees the vote
    expect((await api(`/polls/${id}`, { cookie: await loginAs(kim) })).body.myUnits[0].answers).toHaveLength(2);
    // Names for participants, short
    expect(mine.tallies.find((x: any) => x.optionId === a && x.value === 2).names).toEqual(["Familie von Ben und Kim"]);

    // Anonymous: no names, not even for the coach
    const anon = (
      await api("/polls", { cookie: coachCookie, body: { teamId: wd, kind: "schedule", title: "Weihnachtsfeier", options, whoParents: true, anonymous: true, endsAt: later() } })
    ).body.id;
    const md = (await api(`/polls/${anon}`, { cookie: monaCookie })).body;
    await api(`/polls/${anon}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: md.myUnits[0].unitId, answers: md.options.map((o: any) => ({ optionId: o.id, value: 2 })) } });
    const cv = (await api(`/polls/${anon}`, { cookie: coachCookie })).body;
    expect(cv.tallies.every((x: any) => x.names === undefined)).toBe(true);
    expect(cv.pending).toBeNull();
    expect([cv.voted, cv.total]).toEqual([1, 3]);
  });

  it("Auswahl: Teilnehmer sehen keine Namen, auch nicht ohne „anonym“", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: choice() })).body.id;
    const opt = (await api(`/polls/${id}`, { cookie: monaCookie })).body.options[0].id;
    const res = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: opt, value: 1 }] } });
    expect(res.body.tallies[0].names).toBeUndefined();
  });
});

describe("Bestellung", () => {
  it("je Familie mit Größen und Preisen; Kinder bestellen nicht selbst; Teilnehmende sehen nur die eigene Bestellung", async () => {
    const body = {
      teamId: wd,
      kind: "order",
      title: "Vereinsausrüstung",
      perFamily: true,
      whoPlayers: true,
      endsAt: later(),
      options: [
        { label: "Socken", priceCents: 800, sizes: ["31-34", "35-38"] },
        { label: "Beanie", priceCents: 1500 },
      ],
    };
    expect((await api("/polls", { cookie: coachCookie, body: { ...body, anonymous: true } })).body.error.code).toBe("order_anonymous");
    expect((await api("/polls", { cookie: coachCookie, body: { ...body, options: [{ label: "Ohne Preis" }] } })).body.error.code).toBe("bad_options");
    // One item is enough
    expect((await api("/polls", { cookie: coachCookie, body: { ...body, options: [{ label: "Beanie", priceCents: 1500 }] } })).status).toBe(201);
    const id = (await api("/polls", { cookie: coachCookie, body })).body.id;
    // Kim does not see the order (the parents order)
    expect((await api(`/polls/${id}`, { cookie: await loginAs(kim) })).status).toBe(404);
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    const unit = d.myUnits[0].unitId;
    const [socks, beanie] = d.options.map((o: any) => o.id);
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: unit, answers: [{ optionId: socks, size: "XL", value: 1 }] } })).body.error.code).toBe("bad_answer");
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: unit, answers: [{ optionId: beanie, size: "M", value: 1 }] } })).body.error.code).toBe("bad_answer");
    const ordered = await api(`/polls/${id}/ballot`, {
      method: "PUT",
      cookie: monaCookie,
      body: { unitId: unit, answers: [{ optionId: socks, size: "31-34", value: 1 }, { optionId: socks, size: "35-38", value: 2 }, { optionId: beanie, value: 1 }] },
    });
    expect(ordered.status).toBe(200);
    expect(ordered.body.orders).toBeNull();
    // Participants see only their own order: no totals, no counts, not in the list either
    expect(ordered.body).toMatchObject({ resultsVisible: false, tallies: null, pending: null, voted: 0, total: 0 });
    expect(ordered.body.myUnits[0].answers).toHaveLength(3);
    expect(ordered.body.myUnits[0].payment).toEqual({ totalCents: 3900, paidCents: 0, reportedCents: 0 });
    const summary = (await api(`/polls?teamId=${wd}`, { cookie: monaCookie })).body.polls.find((x: any) => x.id === id);
    expect([summary.voted, summary.total]).toEqual([0, 0]);
    // Max orders nothing: counts as voted
    const maxCookie = await loginAs(max);
    const maxUnit = (await api(`/polls/${id}`, { cookie: maxCookie })).body.myUnits[0].unitId;
    expect((await api(`/polls/${id}/ballot`, { method: "PUT", cookie: maxCookie, body: { unitId: maxUnit, answers: [] } })).status).toBe(200);

    const cv = (await api(`/polls/${id}`, { cookie: coachCookie })).body;
    expect([cv.voted, cv.total]).toEqual([2, 2]);
    expect(cv.orders.map((o: any) => [o.label, o.totalCents, o.paid])).toEqual([
      ["Familie von Ben und Kim", 3900, false],
      ["Familie von Lea", 0, false],
    ]);
    expect(cv.tallies.find((x: any) => x.optionId === socks && x.size === "35-38").quantity).toBe(2);
    await api(`/polls/${id}/close`, { method: "POST", cookie: coachCookie });
    const closed = (await api(`/polls/${id}`, { cookie: maxCookie })).body;
    expect(closed).toMatchObject({ resultsVisible: false, tallies: null, voted: 0, total: 0 });
  });
});

describe("Verein, Abgleich und Benachrichtigungen", () => {
  let pushes: PushJob[] = [];
  const testEnv = () => ({ ...env, PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } }) as unknown as Env;

  beforeEach(() => {
    pushes = [];
  });

  async function withDevice(personId: number) {
    await loginAs(personId);
    const { id } = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", id, `https://push.example/${id}`);
    return id;
  }

  it("Admins fragen den ganzen Verein, Gruppen gehören nicht dazu", async () => {
    const admin = await person("Ada", { admin: true });
    const group = await one<{ id: number }>("INSERT INTO teams (name, age_class_code, kind) VALUES ('Trainerteam', '', 'group') RETURNING id");
    const gina = await person("Gina");
    await member(gina, group.id, "coach");
    const id = (await api("/polls", { cookie: await loginAs(admin), body: choice({ teamId: null, whoPlayers: false, whoParents: true, whoCoaches: true }) })).body.id;
    const units = await rows<{ unit_id: number }>("SELECT DISTINCT unit_id FROM poll_voters WHERE poll_id = ? ORDER BY unit_id", id);
    expect(units.map((u) => u.unit_id)).toEqual([coach, mona, paul, max].sort((a, b) => a - b));
  });

  it("Gruppen: Verantwortliche fragen ihre Mitglieder, ohne Eltern", async () => {
    const group = await one<{ id: number }>("INSERT INTO teams (name, age_class_code, kind) VALUES ('Orga', '', 'group') RETURNING id");
    const gina = await person("Gina");
    await member(gina, group.id, "coach");
    await member(mona, group.id);
    await member(kim, group.id);
    const id = (await api("/polls", { cookie: await loginAs(gina), body: choice({ teamId: group.id, whoParents: true }) })).body.id;
    expect(await rows("SELECT unit_id, person_id FROM poll_voters WHERE poll_id = ? ORDER BY unit_id", id)).toEqual(
      [
        { unit_id: kim, person_id: kim },
        { unit_id: mona, person_id: mona },
      ].sort((a, b) => a.unit_id - b.unit_id),
    );
  });

  it("neue Spieler kommen stündlich dazu; Erinnerung einen Tag vor Ende nur an Offene, einmal", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: choice({ endsAt: `${addDays(todayLocal(), 2)}T12:00` }) })).body.id;
    const nina = await person("Nina", { birthYear: 2014 });
    await member(nina, wd);
    const monaAccount = await withDevice(mona);
    const maxAccount = await withDevice(max);
    const ninaAccount = await withDevice(nina);
    // Max switched "Polls" off
    expect((await api("/me/notifications", { method: "PUT", cookie: await loginAs(max), body: { personId: max, topic: "polls", enabled: false } })).status).toBeLessThan(300);
    expect(await rows("SELECT topic, enabled FROM notification_settings WHERE account_id = ?", maxAccount)).toEqual([{ topic: "polls", enabled: 0 }]);
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: d.options[0].id, value: 1 }] } });
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: ben, answers: [{ optionId: d.options[0].id, value: 1 }] } });

    // Today: sync, no reminder yet (end more than 24 hours away)
    await runPolls(testEnv(), localToInstant(nowLocal()));
    expect(await rows("SELECT 1 FROM poll_voters WHERE poll_id = ? AND unit_id = ?", id, nina)).toHaveLength(1);
    expect(pushes).toEqual([]);
    // Unchanged teams and parent links: the next run does not compute the voters again
    const synced = (await one<{ voters_synced: string }>("SELECT voters_synced FROM polls WHERE id = ?", id)).voters_synced;
    expect(synced).toMatch(/^\d+:\d+$/);
    await exec("DELETE FROM poll_voters WHERE poll_id = ? AND unit_id = ?", id, nina);
    await runPolls(testEnv(), localToInstant(nowLocal()));
    expect(await rows("SELECT 1 FROM poll_voters WHERE poll_id = ? AND unit_id = ?", id, nina)).toHaveLength(0);
    await exec("UPDATE polls SET voters_synced = NULL WHERE id = ?", id);
    // Tomorrow after 12:00: reminder to Nina, not to Mona (all voted) and not to Max (switched off)
    const tomorrow = localToInstant(addMinutesLocal(`${addDays(todayLocal(), 1)}T12:00`, 30));
    await exec("UPDATE polls SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", id);
    await runPolls(testEnv(), tomorrow);
    expect(pushes.flatMap((p) => p.accountIds)).toEqual([ninaAccount]);
    expect(pushes[0]!.payload.title).toBe("Umfrage endet bald · wD");
    await runPolls(testEnv(), tomorrow + 3600_000);
    expect(pushes).toHaveLength(1);
    expect(monaAccount).toBeGreaterThan(0);
  });
});

describe("Bearbeiten", () => {
  it("Ersteller und Admins bearbeiten; mit Stimmen bleiben Familie, Mehrfachauswahl und Anonymität", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: choice({ anonymous: true }) })).body.id;
    const d = (await api(`/polls/${id}`, { cookie: coachCookie })).body;
    const [klettern, freibad, kino] = d.options.map((o: any) => o.id);
    const body = (extra: Record<string, unknown> = {}) => ({
      ...choice({ anonymous: true }),
      title: "Abschlussfahrt 2027",
      options: [{ id: klettern, label: "Kletterwald" }, { id: freibad, label: "Freibad" }, { label: "Minigolf" }],
      ...extra,
    });
    // Another coach of the team manages, but does not edit
    const coach2 = await person("Uwe");
    await member(coach2, wd, "coach");
    expect((await api(`/polls/${id}`, { method: "PUT", cookie: await loginAs(coach2), body: body() })).status).toBe(403);
    // The kind stays
    expect((await api(`/polls/${id}`, { method: "PUT", cookie: coachCookie, body: { ...body(), kind: "schedule" } })).body.error.code).toBe("fixed");

    // Votes: Kim chooses cinema (removed), Ben climbing (renamed)
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: kim, answers: [{ optionId: kino, value: 1 }] } });
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: ben, answers: [{ optionId: klettern, value: 1 }] } });
    expect((await api(`/polls/${id}`, { method: "PUT", cookie: coachCookie, body: body({ anonymous: false }) })).body.error.code).toBe("votes_exist");
    expect((await api(`/polls/${id}`, { method: "PUT", cookie: coachCookie, body: body({ perFamily: true }) })).body.error.code).toBe("votes_exist");
    expect((await api(`/polls/${id}`, { method: "PUT", cookie: coachCookie, body: body({ multiple: true }) })).body.error.code).toBe("votes_exist");

    const adminCookie = await loginAs(await person("Ada", { admin: true }));
    const saved = await api(`/polls/${id}`, { method: "PUT", cookie: adminCookie, body: body() });
    expect(saved.status).toBe(200);
    expect(saved.body.poll.title).toBe("Abschlussfahrt 2027");
    expect(saved.body.options.map((o: any) => o.label)).toEqual(["Kletterwald", "Freibad", "Minigolf"]);
    // Ben stays with the climbing forest, Kim votes again
    expect(saved.body.tallies).toEqual([{ optionId: klettern, size: "", value: 1, units: 1, quantity: 1 }]);
    const mine = (await api(`/polls/${id}`, { cookie: monaCookie })).body.myUnits;
    expect(mine.find((u: any) => u.unitId === kim).answers).toBeNull();
    expect(mine.find((u: any) => u.unitId === ben).answers).toEqual([{ optionId: klettern, size: "", value: 1 }]);
  });

  it("ohne Stimmen lässt sich alles außer der Art umstellen; beendete Umfrage mit späterem Ende wieder offen", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: choice() })).body.id;
    const d = (await api(`/polls/${id}`, { cookie: coachCookie })).body;
    await api(`/polls/${id}/close`, { method: "POST", cookie: coachCookie });
    const res = await api(`/polls/${id}`, {
      method: "PUT",
      cookie: coachCookie,
      body: { ...choice({ multiple: true, perFamily: true, whoParents: true, results: "after", endsAt: later(3) }), options: d.options.map((o: any) => ({ id: o.id, label: o.label })) },
    });
    expect(res.body.poll).toMatchObject({ multiple: true, perFamily: true, whoParents: true, results: "after", open: true });
    expect(res.body.total).toBe(2);
  });

  it("Bestellung: entfernte Größen verlieren ihre Mengen, Preise ändern die Summe", async () => {
    const id = (
      await api("/polls", {
        cookie: coachCookie,
        body: { teamId: wd, kind: "order", title: "Socken", perFamily: true, whoPlayers: true, endsAt: later(), options: [{ label: "Socken", priceCents: 800, sizes: ["31-34", "35-38"] }] },
      })
    ).body.id;
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    const socks = d.options[0].id;
    const unit = d.myUnits[0].unitId;
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: unit, answers: [{ optionId: socks, size: "31-34", value: 1 }, { optionId: socks, size: "35-38", value: 2 }] } });
    const res = await api(`/polls/${id}`, {
      method: "PUT",
      cookie: coachCookie,
      body: { teamId: wd, kind: "order", title: "Socken", perFamily: true, whoPlayers: true, endsAt: later(), options: [{ id: socks, label: "Socken", priceCents: 900, sizes: ["35-38", "39-42"] }] },
    });
    expect(res.body.orders.map((o: any) => [o.items, o.totalCents])).toEqual([[[{ optionId: socks, size: "35-38", quantity: 2 }], 1800]]);
  });
});
