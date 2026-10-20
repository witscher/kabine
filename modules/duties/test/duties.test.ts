// Helferplan: Sichtbarkeit, Eintragen, Plätze, Verwaltung, Kalender. Alle Namen erfunden.
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "../../../test/helpers";

let wd: number;
let wb: number;
let coach: number;
let kim: number;
let lea: number;
let mona: number;
let mia: number;
let monaCookie: string;
let coachCookie: string;
let home: number;
let away: number;

async function game(teamId: number, days: number, isHome: 0 | 1 | null) {
  const id = await eventIn(teamId, days, { kind: "game", time: "14:00" });
  await exec("UPDATE events SET external_ref = 'handball4all:g' || id, is_home = ?, home_team = ?, guest_team = ? WHERE id = ?", isHome, isHome === 0 ? "SG Gegner" : "SV Musterstadt", isHome === 0 ? "SV Musterstadt" : "SG Gegner", id);
  return id;
}

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wb = await team("wB", "wB");
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
  await exec("UPDATE teams SET helper_plan = 1, parents_enabled = 0 WHERE id = ?", wb);
  coach = await person("Tara");
  kim = await person("Kim", { lastName: "Kaiser" });
  lea = await person("Lea", { lastName: "Lang" });
  mona = await person("Mona", { lastName: "Kaiser" });
  mia = await person("Mia", { lastName: "Berg" });
  await member(coach, wd, "coach");
  await member(kim, wd);
  await member(lea, wd);
  await member(mia, wb);
  await guardian(mona, kim);
  monaCookie = await loginAs(mona);
  coachCookie = await loginAs(coach);
  home = await game(wd, 5, 1);
  away = await game(wd, 9, 0);
});

/** Block eines Termins nach Code der Dienstart; erzeugt die Blöcke vorher über die Liste. */
async function blockOf(eventId: number, code: string, teamId = wd): Promise<number> {
  await api(`/duties?teamId=${teamId}`, { cookie: coachCookie });
  const row = await one<{ id: number }>(
    "SELECT ed.id FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id WHERE ed.event_id = ? AND dt.code = ? ORDER BY ed.id LIMIT 1",
    eventId,
    code,
  );
  return row.id;
}

const ZEITNEHMER = 2;
const SEKRETAER = 3;

describe("Helferplan", () => {
  it("zeigt Eltern die Spiele mit den Diensten der Vorlage, mit Uhrzeit, und trägt atomar ein", async () => {
    const me = await api("/session", { cookie: monaCookie });
    expect(me.body.me.helperTeams).toEqual([{ id: wd, name: "wD", own: true }]);

    const list = await api(`/duties?teamId=${wd}`, { cookie: monaCookie });
    expect(list.body.games.map((g: any) => g.blocks.map((b: any) => `${b.label}:${b.total}`))).toEqual([
      // wD ist Jugend D: bei Heimspielen zusätzlich Jugendschiedsrichter
      ["Kuchen & Theke:2", "Zeitnehmer:1", "Jugendschiedsrichter:1", "Trikots waschen:1"],
      ["Sekretär:1", "Trikots waschen:1"],
    ]);
    // Zeiten aus der Vorlage: Anpfiff 14:00, D-Jugend 90 min
    const [cake, timer, referee, jerseys] = list.body.games[0].blocks;
    expect([cake.startsAt.slice(11), cake.endsAt.slice(11)]).toEqual(["13:40", "15:50"]);
    expect([timer.startsAt.slice(11), timer.endsAt.slice(11)]).toEqual(["13:45", "15:30"]);
    expect(referee).toMatchObject({ referee: true, roles: [] });
    expect(jerseys).toMatchObject({ mode: "task", startsAt: jerseys.endsAt });
    expect(jerseys.startsAt.slice(11)).toBe("15:30");
    expect(cake.roles).toEqual([{ childId: kim, childName: "Kim" }]);

    // Kuchen mit Notiz, Kind wird automatisch gewählt (nur eins in der Mannschaft)
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: cake.id, note: "Marmorkuchen" } })).status).toBe(201);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: cake.id } })).body.error.code).toBe("already_signed_up");

    const after = await api(`/duties?teamId=${wd}`, { cookie: monaCookie });
    expect(after.body.games[0].blocks[0].entries).toEqual([{ id: expect.any(Number), name: "Mona K.", child: "Kim K.", note: "Marmorkuchen", mine: true, forMyChild: true }]);

    // Letzter Platz: zwei gleichzeitige Versuche, nur einer gewinnt
    const coachAsHelper = api("/duties", { cookie: coachCookie, body: { blockId: jerseys.id } });
    const monaAgain = api("/duties", { cookie: monaCookie, body: { blockId: jerseys.id } });
    const results = (await Promise.all([coachAsHelper, monaAgain])).map((r) => r.status).sort();
    expect(results).toEqual([201, 409]);
    expect(await one("SELECT count(*) AS n FROM duties WHERE event_duty_id = ?", jerseys.id)).toEqual({ n: 1 });
  });

  it("verschobenes Spiel: Blöcke ziehen mit, Einträge bleiben", async () => {
    const cake = await blockOf(home, "kuchen");
    await api("/duties", { cookie: monaCookie, body: { blockId: cake } });
    const before = await one<{ starts_at: string }>("SELECT starts_at FROM events WHERE id = ?", home);
    await exec("UPDATE events SET starts_at = substr(starts_at, 1, 11) || '16:30' WHERE id = ?", home);
    const list = await api(`/duties?teamId=${wd}`, { cookie: monaCookie });
    const block = list.body.games.find((g: any) => g.id === home).blocks[0];
    expect(block.startsAt).toBe(`${before.starts_at.slice(0, 11)}16:10`);
    expect(block.entries).toHaveLength(1);
  });

  it("Admins sehen alle Mannschaften, die eigenen zuerst", async () => {
    const chef = await person("Chef", { admin: true });
    await guardian(chef, mia);
    await exec("UPDATE teams SET parents_enabled = 1 WHERE id = ?", wb);
    const me = await api("/session", { cookie: await loginAs(chef) });
    // wB (eigenes Kind) vor wD, obwohl alphabetisch später
    expect(me.body.me.helperTeams).toEqual([
      { id: wb, name: "wB", own: true },
      { id: wd, name: "wD", own: false },
    ]);
    const coachMe = await api("/session", { cookie: coachCookie });
    expect(coachMe.body.me.helperTeams).toEqual([{ id: wd, name: "wD", own: true }]);
  });

  it("Terminübersicht zeigt eigene Dienste und die für das eigene Kind", async () => {
    const vater = await person("Olaf", { lastName: "Kaiser" });
    await guardian(vater, kim);
    const vaterCookie = await loginAs(vater);
    await api("/duties", { cookie: monaCookie, body: { blockId: await blockOf(home, "kuchen") } });
    await api("/duties", { cookie: vaterCookie, body: { blockId: await blockOf(home, "trikots") } });
    // Fremder Eintrag (Trainerin, ohne Kind) taucht bei Mona nicht auf
    expect((await api("/duties", { cookie: coachCookie, body: { blockId: await blockOf(away, "trikots") } })).status).toBe(201);

    const duties = async (cookie: string) => {
      const res = await api("/events", { cookie });
      return Object.fromEntries(res.body.events.filter((e: any) => e.myDuties.length).map((e: any) => [e.id, e.myDuties]));
    };
    expect(await duties(monaCookie)).toEqual({
      [home]: [
        { dutyTypeId: 1, referee: false, label: "Kuchen & Theke", child: null, mine: true },
        { dutyTypeId: 4, referee: false, label: "Trikots waschen", child: "Kim", mine: false },
      ],
    });
    expect((await api(`/events/${home}`, { cookie: monaCookie })).body.myDuties).toHaveLength(2);
    expect(Object.keys(await duties(coachCookie))).toEqual([String(away)]);

    // Ausgeblendet oder Helferplan aus: kein Hinweis
    await exec("UPDATE events SET duty_hidden = 1 WHERE id = ?", home);
    expect(await duties(monaCookie)).toEqual({});
    await exec("UPDATE events SET duty_hidden = 0 WHERE id = ?", home);
    await exec("UPDATE teams SET helper_plan = 0 WHERE id = ?", wd);
    expect(await duties(monaCookie)).toEqual({});
  });

  it("Terminübersicht: „Helfer benötigt“ je nach Wer hilft und Vorkenntnissen", async () => {
    const needed = async (cookie: string) => {
      const res = await api("/events", { cookie });
      return Object.fromEntries(res.body.events.filter((e: any) => e.kind === "game").map((e: any) => [e.id, e.helpersNeeded]));
    };
    // Neues Konto: Zeitnehmer und Sekretär erst nach „Das kann ich“. Heim: Kuchen 2, Trikots 1; Auswärts: Trikots 1
    expect(await needed(monaCookie)).toEqual({ [home]: 3, [away]: 1 });
    // Trainerin ohne Kind in der Mannschaft: kein Aufruf
    expect(await needed(coachCookie)).toEqual({ [home]: 0, [away]: 0 });

    await api("/profile/duty-prefs", { method: "PUT", cookie: monaCookie, body: { skills: [{ dutyTypeId: ZEITNEHMER, on: true }, { dutyTypeId: SEKRETAER, on: true }] } });
    expect(await needed(monaCookie)).toEqual({ [home]: 4, [away]: 2 });
    const prefs = await api("/profile/duty-prefs", { cookie: monaCookie });
    expect(prefs.body.skills).toEqual([
      { dutyTypeId: ZEITNEHMER, code: "zeitnehmer", name: "Zeitnehmer", on: true },
      { dutyTypeId: SEKRETAER, code: "sekretaer", name: "Sekretär", on: true },
    ]);
    await api("/profile/duty-prefs", { method: "PUT", cookie: monaCookie, body: { skills: [{ dutyTypeId: SEKRETAER, on: false }] } });
    // Auswärts nur noch Sekretär frei: kein Aufruf
    await api("/duties", { cookie: coachCookie, body: { blockId: await blockOf(away, "trikots") } });
    expect((await needed(monaCookie))[away]).toBe(0);

    // Schon eingetragen: statt des Aufrufs die eigene Marke
    await api("/duties", { cookie: monaCookie, body: { blockId: await blockOf(home, "kuchen") } });
    const ev = await api(`/events/${home}`, { cookie: monaCookie });
    expect(ev.body.helpersNeeded).toBe(0);
    expect(ev.body.myDuties).toHaveLength(1);

    // Ausgeblendet: kein Aufruf
    await api("/profile/duty-prefs", { method: "PUT", cookie: monaCookie, body: { skills: [{ dutyTypeId: SEKRETAER, on: true }] } });
    await exec("UPDATE events SET duty_hidden = 1 WHERE id = ?", away);
    expect((await needed(monaCookie))[away]).toBe(0);
  });

  it("Vorkenntnisse nur mit Freigabe, keine Vergangenheit, Spieler ohne Eltern selbst", async () => {
    const timer = await blockOf(home, "zeitnehmer");
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: timer } })).body.error.code).toBe("skill_missing");
    await api("/profile/duty-prefs", { method: "PUT", cookie: monaCookie, body: { skills: [{ dutyTypeId: ZEITNEHMER, on: true }] } });
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: timer } })).status).toBe(201);

    const past = await game(wd, -2, 1);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: await blockOf(past, "kuchen") } })).body.error.code).toBe("game_in_past");

    // wB ohne Eltern: Mia selbst, Lea (wD-Spielerin mit Eltern-Einbindung) sieht keinen Helferplan
    const miaCookie = await loginAs(mia);
    expect((await api("/session", { cookie: miaCookie })).body.me.helperTeams).toEqual([{ id: wb, name: "wB", own: true }]);
    const bGame = await game(wb, 4, 0);
    const miaList = await api(`/duties?teamId=${wb}`, { cookie: miaCookie });
    const bJerseys = miaList.body.games[0].blocks.find((b: any) => b.label === "Trikots waschen");
    expect((await api("/duties", { cookie: miaCookie, body: { blockId: bJerseys.id } })).status).toBe(201);
    expect(bGame).toBeGreaterThan(0);
    expect((await api("/session", { cookie: await loginAs(lea) })).body.me.helperTeams).toEqual([]);
    expect((await api(`/duties?teamId=${wd}`, { cookie: await loginAs(lea) })).status).toBe(403);
  });

  it("Wer hilft je Dienstart: Spieler dürfen, wenn die Dienstart es erlaubt", async () => {
    const admin = await person("Ada", { admin: true });
    const adminCookie = await loginAs(admin);
    // Neue Dienstart nur für Spieler, in der Heimspiel-Vorlage
    const created = await api("/admin/duty-types", {
      cookie: adminCookie,
      body: { name: "Wischen", mode: "onsite", whoParents: false, whoPlayers: true, whoCoaches: false, noteAllowed: false, needsSkill: false },
    });
    expect(created.status).toBe(201);
    expect((await api("/admin/duty-types", { cookie: coachCookie, body: { name: "X", mode: "onsite", whoParents: true, whoPlayers: false, whoCoaches: false, noteAllowed: false, needsSkill: false } })).status).toBe(403);
    const tpl = (await api("/duty-templates", { cookie: coachCookie })).body.templates.find((t: any) => t.defaultFor === "home");
    const items = [...tpl.items, { dutyTypeId: created.body.id, slots: 2, beforeMin: 0, afterMin: 15, taskWhen: "after" }];
    expect((await api(`/admin/duty-templates/${tpl.id}`, { method: "PUT", cookie: adminCookie, body: { name: tpl.name, items } })).status).toBe(200);
    const fresh = await game(wd, 12, 1);
    // Lea (Spielerin in wD mit Eltern) sieht jetzt den Helferplan und kann nur „Wischen“
    const leaCookie = await loginAs(lea);
    expect((await api("/session", { cookie: leaCookie })).body.me.helperTeams).toEqual([{ id: wd, name: "wD", own: true }]);
    const list = await api(`/duties?teamId=${wd}`, { cookie: leaCookie });
    const blocks = list.body.games.find((g: any) => g.id === fresh).blocks;
    const wipe = blocks.find((b: any) => b.label === "Wischen");
    expect(wipe.roles).toEqual([{ childId: null, childName: null }]);
    expect(blocks.find((b: any) => b.label === "Kuchen & Theke").roles).toEqual([]);
    expect((await api("/duties", { cookie: leaCookie, body: { blockId: wipe.id } })).status).toBe(201);
    expect((await api("/duties", { cookie: leaCookie, body: { blockId: blocks[0].id } })).body.error.code).toBe("not_allowed");
    // Mona (Elternteil) darf „Wischen“ nicht
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: wipe.id } })).status).toBe(403);
  });

  it("Trainer verwalten: Blöcke, Ausblenden, für andere eintragen, manuelle Spiele", async () => {
    const cake = await blockOf(home, "kuchen");
    expect((await api(`/duties/games/${home}`, { method: "PATCH", cookie: monaCookie, body: { hidden: true } })).status).toBe(403);
    await api(`/duties/games/${home}`, { method: "PATCH", cookie: coachCookie, body: { hidden: true } });
    expect((await api(`/duties/blocks/${cake}`, { method: "PATCH", cookie: monaCookie, body: { slots: 3 } })).status).toBe(403);
    expect((await api(`/duties/blocks/${cake}`, { method: "PATCH", cookie: coachCookie, body: { slots: 3 } })).status).toBe(200);
    expect((await api(`/duties?teamId=${wd}`, { cookie: monaCookie })).body.games.map((g: any) => g.id)).toEqual([away]);
    const coachView = await api(`/duties?teamId=${wd}`, { cookie: coachCookie });
    expect(coachView.body.games[0]).toMatchObject({ id: home, hidden: true });
    expect(coachView.body.games[0].blocks[0].total).toBe(3);
    await api(`/duties/games/${home}`, { method: "PATCH", cookie: coachCookie, body: { hidden: false } });

    // Zusätzlicher Block am Spiel, Uhrzeit ändern, löschen
    const date = (await one<{ starts_at: string }>("SELECT starts_at FROM events WHERE id = ?", home)).starts_at.slice(0, 10);
    const extra = await api(`/duties/events/${home}/blocks`, { cookie: coachCookie, body: { dutyTypeId: 1, startsAt: `${date}T16:00`, endsAt: `${date}T17:00`, slots: 1 } });
    expect(extra.status).toBe(201);
    expect((await api(`/duties/blocks/${extra.body.id}`, { method: "PATCH", cookie: coachCookie, body: { endsAt: `${date}T15:00` } })).status).toBe(400);
    expect((await api(`/duties/blocks/${extra.body.id}`, { method: "DELETE", cookie: coachCookie })).status).toBe(200);

    // Eltern können nicht für andere eintragen, Trainer schon (Elternteil oder Freitext)
    const awayJerseys = await blockOf(away, "trikots");
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: awayJerseys, manualName: "Oma Ilse" } })).status).toBe(403);
    expect((await api("/duties", { cookie: coachCookie, body: { blockId: awayJerseys, manualName: "Oma Ilse" } })).status).toBe(201);
    expect((await api("/duties", { cookie: coachCookie, body: { blockId: await blockOf(away, "sekretaer"), onBehalfPersonId: mona, childId: kim } })).status).toBe(201);
    // Jede aktive Person im Verein, auch aus einer anderen Mannschaft und ohne passendes „Wer hilft“; Ehemalige nicht
    const stranger = await person("Fritzi", { lastName: "Fremd" });
    await member(stranger, wb);
    expect((await api("/duties", { cookie: coachCookie, body: { blockId: cake, onBehalfPersonId: stranger } })).status).toBe(201);
    const former = await person("Elsa", { lastName: "Ehemalig" });
    await exec("UPDATE persons SET is_former = 1 WHERE id = ?", former);
    expect((await api("/duties", { cookie: coachCookie, body: { blockId: cake, onBehalfPersonId: former } })).body.error.code).toBe("unknown_person");
    // Suche im ganzen Verein nur für Trainer und Admins, ab 2 Zeichen, ohne Ehemalige
    const found = await api(`/duties/teams/${wd}/people?q=fr`, { cookie: coachCookie });
    expect(found.body.people).toEqual([{ personId: stranger, name: "Fritzi F.", childId: null, childName: null, teams: "wB" }]);
    expect((await api(`/duties/teams/${wd}/people?q=eh`, { cookie: coachCookie })).body.people).toEqual([]);
    expect((await api(`/duties/teams/${wd}/people?q=fr`, { cookie: monaCookie })).status).toBe(403);
    // Block mit Einträgen lässt sich nicht löschen, Plätze nicht unter die Einträge senken
    expect((await api(`/duties/blocks/${awayJerseys}`, { method: "DELETE", cookie: coachCookie })).body.error.code).toBe("block_has_entries");
    expect((await api(`/duties/blocks/${awayJerseys}`, { method: "PATCH", cookie: coachCookie, body: { slots: 0 } })).body.error.code).toBe("slots_below_entries");

    // Mona sieht den Eintrag für sich und kann ihn selbst austragen
    const blocks = (await api(`/duties?teamId=${wd}`, { cookie: monaCookie })).body.games.find((g: any) => g.id === away).blocks;
    const mine = blocks.find((b: any) => b.label === "Sekretär").entries[0];
    expect(mine).toMatchObject({ name: "Mona K.", mine: true });
    expect((await api(`/duties/${mine.id}`, { method: "DELETE", cookie: monaCookie })).status).toBe(200);

    // Manuelles Spiel, nur das lässt sich löschen
    const created = await api(`/duties/teams/${wd}/games`, { cookie: coachCookie, body: { opponent: "Turnier Musterstadt", isHome: true, date: "2099-05-01", time: "10:00" } });
    expect(created.status).toBe(201);
    expect((await api(`/duties/games/${away}`, { method: "DELETE", cookie: coachCookie })).status).toBe(400);
    expect((await api(`/duties/games/${created.body.id}`, { method: "DELETE", cookie: coachCookie })).status).toBe(200);

    // Top-Helfer nur innerhalb der Mannschaft
    const top = await api(`/duties/teams/${wd}/top`, { cookie: monaCookie });
    expect(top.body.top).toEqual([
      { name: "Fritzi F.", count: 1, star: true },
      { name: "Oma Ilse", count: 1, star: true },
    ]);
  });

  it("Eintragen ohne Auswahl: man selbst, das Kind der Mannschaft wird automatisch verknüpft", async () => {
    // Tara ist Trainerin der wD und Mutter von Kim und Lea (zwei Kinder in der Mannschaft)
    await guardian(coach, kim);
    await guardian(coach, lea);
    const cake = await blockOf(home, "kuchen");
    expect((await api("/duties", { cookie: await loginAs(coach), body: { blockId: cake } })).status).toBe(201);
    expect(await one("SELECT person_id, child_id FROM duties WHERE event_duty_id = ?", cake)).toEqual({ person_id: coach, child_id: kim });
    // Mona sieht den Dienst als „Dienst für Kim“ in der Terminübersicht
    const events = await api("/events", { cookie: monaCookie });
    expect(events.body.events.find((e: any) => e.id === home).myDuties).toEqual([{ dutyTypeId: 1, referee: false, label: "Kuchen & Theke", child: "Kim", mine: false }]);
  });

  it("Vorlage der Mannschaft wechseln: kommende Spiele ohne Einträge bekommen neue Blöcke", async () => {
    const admin = await person("Ada", { admin: true });
    const adminCookie = await loginAs(admin);
    await api("/duties", { cookie: monaCookie, body: { blockId: await blockOf(home, "kuchen") } });
    const fresh = await game(wd, 14, 1);
    await blockOf(fresh, "kuchen");
    const tpl = await api("/admin/duty-templates", { cookie: adminCookie, body: { name: "Nur Theke", items: [{ dutyTypeId: 1, slots: 4, beforeMin: 30, afterMin: 0, taskWhen: "after" }] } });
    expect(tpl.status).toBe(201);
    expect((await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { homeTemplateId: tpl.body.id } })).status).toBe(200);
    const list = await api(`/duties?teamId=${wd}`, { cookie: coachCookie });
    const labels = (id: number) => list.body.games.find((g: any) => g.id === id).blocks.map((b: any) => `${b.label}:${b.total}`);
    // Spiel mit Eintrag bleibt, neues Spiel folgt der Vorlage (Jugendschiedsrichter bleibt)
    expect(labels(home)).toEqual(["Kuchen & Theke:2", "Zeitnehmer:1", "Jugendschiedsrichter:1", "Trikots waschen:1"]);
    expect(labels(fresh)).toEqual(["Kuchen & Theke:4", "Jugendschiedsrichter:1"]);
    // Standardvorlage lässt sich nicht löschen
    const home1 = (await api("/duty-templates", { cookie: coachCookie })).body.templates.find((t: any) => t.defaultFor === "home");
    expect((await api(`/admin/duty-templates/${home1.id}`, { method: "DELETE", cookie: adminCookie })).status).toBe(400);
    expect((await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { homeTemplateId: 9999 } })).status).toBe(400);

    // Vorlage ändern wirkt sofort auf kommende Spiele ohne Einträge
    const items = [{ dutyTypeId: 1, slots: 3, beforeMin: 0, afterMin: 0, taskWhen: "after" }];
    expect((await api(`/admin/duty-templates/${tpl.body.id}`, { method: "PUT", cookie: adminCookie, body: { name: "Nur Theke", items } })).status).toBe(200);
    const edited = await api(`/duties?teamId=${wd}`, { cookie: coachCookie });
    expect(edited.body.games.find((g: any) => g.id === fresh).blocks.map((b: any) => `${b.label}:${b.total}`)).toEqual(["Jugendschiedsrichter:1", "Kuchen & Theke:3"]);

    // Vorlage löschen: die Mannschaft nutzt wieder den Standard
    expect((await api(`/admin/duty-templates/${tpl.body.id}`, { method: "DELETE", cookie: adminCookie })).status).toBe(200);
    expect(await one("SELECT home_template_id FROM teams WHERE id = ?", wd)).toEqual({ home_template_id: null });
    const back = await api(`/duties?teamId=${wd}`, { cookie: coachCookie });
    expect(back.body.games.find((g: any) => g.id === fresh).blocks.map((b: any) => b.label)).toEqual(["Kuchen & Theke", "Zeitnehmer", "Jugendschiedsrichter", "Trikots waschen"]);
  });

  it("Sondertermin mit Zeitblöcken und Sonderdienst", async () => {
    const date = "2099-06-27";
    const created = await api("/events", {
      cookie: coachCookie,
      body: {
        title: "Saisonabschluss",
        startsAt: `${date}T15:00`,
        endsAt: `${date}T19:00`,
        teamIds: [wd],
        duties: [
          { newTypeName: "Grill", startsAt: `${date}T15:00`, endsAt: `${date}T17:00`, slots: 2 },
          { newTypeName: "Grill", startsAt: `${date}T17:00`, endsAt: `${date}T19:00`, slots: 2 },
          { dutyTypeId: 1, startsAt: `${date}T14:30`, endsAt: `${date}T19:00`, slots: 3 },
        ],
      },
    });
    expect(created.status).toBe(201);
    const list = await api(`/duties?teamId=${wd}`, { cookie: monaCookie });
    const special = list.body.games.find((g: any) => g.id === created.body.id);
    expect(special.kind).toBe("special");
    expect(special.blocks.map((b: any) => `${b.label} ${b.startsAt.slice(11)}-${b.endsAt.slice(11)}`)).toEqual([
      "Kuchen & Theke 14:30-19:00",
      "Grill 15:00-17:00",
      "Grill 17:00-19:00",
    ]);
    // Sonderdienst nur an diesem Termin, nicht in der Vereinsliste
    expect((await api("/duty-types", { cookie: coachCookie })).body.types.map((t: any) => t.name)).not.toContain("Grill");
    expect(await one("SELECT count(*) AS n FROM duty_types WHERE name = 'Grill'")).toEqual({ n: 1 });
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: special.blocks[1].id } })).status).toBe(201);
    // Vorlage auf den Sondertermin anwenden
    const tpl = (await api("/duty-templates", { cookie: coachCookie })).body.templates.find((t: any) => t.defaultFor === "away");
    const applied = await api(`/duties/events/${created.body.id}/apply-template`, { cookie: coachCookie, body: { templateId: tpl.id } });
    expect(applied.body).toEqual({ ok: true, created: 2 });
    expect((await api(`/duties/events/${created.body.id}/apply-template`, { cookie: monaCookie, body: { templateId: tpl.id } })).status).toBe(403);
  });

  it("Helferplan pro Mannschaft schaltbar, Trainer dürfen ihn umstellen", async () => {
    const cake = await blockOf(home, "kuchen");
    expect((await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { helperPlan: false } })).status).toBe(200);
    expect((await api("/session", { cookie: monaCookie })).body.me.helperTeams).toEqual([]);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: cake } })).status).toBe(403);
  });

  it("Kalender mit nur Helferdiensten zeigt nur eigene Dienste mit Blockzeit, falscher Link 404", async () => {
    await api("/duties", { cookie: monaCookie, body: { blockId: await blockOf(home, "kuchen"), note: "Waffeln, frisch" } });
    await api("/duties", { cookie: monaCookie, body: { blockId: await blockOf(home, "trikots") } });
    await api("/duties", { cookie: coachCookie, body: { blockId: await blockOf(away, "trikots") } });
    const { url } = (await api("/profile/calendar-token", { cookie: monaCookie, body: { training: false, games: false, duties: true } })).body;
    const path = new URL(url).pathname;
    const res = await exports.default.fetch(new Request(`http://localhost:5173${path}`));
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("SUMMARY:Helferdienst Kuchen & Theke · wD gegen SG Gegner · für Kim");
    expect(ics).toContain("SUMMARY:Aufgabe Trikots waschen · wD gegen SG Gegner · für Kim");
    expect(ics).toContain("DESCRIPTION:Notiz: Waffeln\\, frisch");
    expect(ics).toMatch(/DTSTART;TZID=Europe\/Berlin:\d{8}T134000/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect((await exports.default.fetch(new Request("http://localhost:5173/api/calendar/falscher-token-1234567890.ics"))).status).toBe(404);
    // Neuer Link macht den alten ungültig
    await api("/profile/calendar-token", { cookie: monaCookie, body: {} });
    expect((await exports.default.fetch(new Request(`http://localhost:5173${path}`))).status).toBe(404);
  });

  it("Profil: Kanäle je Benachrichtigung", async () => {
    const before = await api("/profile/duty-prefs", { cookie: monaCookie });
    expect(before.body.channels.duty_remind_1d).toEqual({ push: true, mail: false, sms: false });
    await api("/profile/duty-prefs", { method: "PUT", cookie: monaCookie, body: { channels: { duty_remind_1d: { push: false, mail: true } } } });
    const after = await api("/profile/duty-prefs", { cookie: monaCookie });
    expect(after.body.channels.duty_remind_1d).toEqual({ push: false, mail: true, sms: false });
    expect(await rows("SELECT topic, push, mail FROM notification_channels")).toEqual([{ topic: "duty_remind_1d", push: 0, mail: 1 }]);
  });
});

describe("Höchstens zwei Elternteile pro Kind", () => {
  it("über den Elternlink ist beim dritten Schluss, Admins dürfen mehr", async () => {
    const link = await api(`/teams/${wd}/invites`, { cookie: coachCookie, body: { kind: "parent" } });
    const token = String(link.body.url).split("#")[1];
    const second = await person("Max", { lastName: "Kaiser" });
    const third = await person("Ute", { lastName: "Kaiser" });
    expect((await api("/join/link-children", { cookie: await loginAs(second), body: { token, childIds: [kim] } })).status).toBe(200);
    const res = await api("/join/link-children", { cookie: await loginAs(third), body: { token, childIds: [kim] } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("child_full");
    // Wer schon verknüpft ist, darf es erneut (idempotent)
    expect((await api("/join/link-children", { cookie: monaCookie, body: { token, childIds: [kim] } })).status).toBe(200);
    const admin = await person("Ada", { admin: true });
    expect((await api("/admin/guardianships", { cookie: await loginAs(admin), body: { guardianId: third, childId: kim } })).status).toBe(201);
  });
});

describe("Live", () => {
  it("meldet Änderungen an alle, die den Helferplan offen haben", async () => {
    const res = await exports.default.fetch(
      new Request(`http://localhost:5173/api/duties/teams/${wd}/live`, { headers: { upgrade: "websocket", cookie: monaCookie, origin: "http://localhost:5173" } }),
    );
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const seen: string[] = [];
    const changed = new Promise<void>((resolve) =>
      ws.addEventListener("message", (e) => {
        seen.push(JSON.parse(e.data as string).type);
        if (seen.includes("changed")) resolve();
      }),
    );
    await api("/duties", { cookie: coachCookie, body: { blockId: await blockOf(home, "kuchen") } });
    await changed;
    expect(seen).toContain("changed");
    ws.close();
    // Ohne Bezug zur Mannschaft keine Verbindung
    const stranger = await loginAs(await person("Fremd"));
    const denied = await exports.default.fetch(
      new Request(`http://localhost:5173/api/duties/teams/${wd}/live`, { headers: { upgrade: "websocket", cookie: stranger, origin: "http://localhost:5173" } }),
    );
    expect(denied.status).toBe(403);
  });
});
