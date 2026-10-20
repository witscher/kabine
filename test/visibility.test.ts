// Vorauswahl der sichtbaren Termine: Die schnelle Abfrage liefert genau dasselbe wie die
// Prüfung jedes Termins im Zeitraum (alte Abfrage als Vergleich). Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { type Actor, buildActor } from "../worker/auth/actor";
import type { SessionRow } from "../worker/auth/session";
import { CANDIDATES_CTE, EVENT_SELECT, listVisibleEvents, VISIBLE_SQL, visibilityParams } from "../worker/domain/events";
import { eventIn, exec, freshDb, guardian, member, one, person, rows, season, team } from "./helpers";

const session: SessionRow = { id: "test", account_id: 0, created_at: "", expires_at: "", extended_at: "" };

async function actorFor(personId: number): Promise<Actor> {
  const p = await one<{ first_name: string; last_name: string | null; is_admin: number }>("SELECT first_name, last_name, is_admin FROM persons WHERE id = ?", personId);
  return buildActor(env.DB, session, { account_id: 0, person_id: personId, first_name: p.first_name, last_name: p.last_name, is_admin: p.is_admin });
}

/** Die frühere Abfrage: jeder Termin im Zeitraum wird mit VISIBLE_SQL geprüft. */
async function reference(actor: Actor, opts: { from: string; to: string; teamId?: number; kind?: string }): Promise<number[]> {
  const params: (string | number)[] = [...visibilityParams(actor), opts.from, opts.to];
  let filter = "";
  if (opts.teamId != null) {
    params.push(opts.teamId);
    filter += ` AND EXISTS (SELECT 1 FROM event_teams ft WHERE ft.event_id = e.id AND ft.team_id = ?${params.length})`;
  }
  if (opts.kind) {
    params.push(opts.kind);
    filter += ` AND e.kind = ?${params.length}`;
  }
  const visibility = actor.isAdmin && opts.teamId != null ? "1 = 1" : VISIBLE_SQL;
  const list = await rows<{ id: number }>(`${EVENT_SELECT} WHERE e.starts_at >= ?3 AND e.starts_at < ?4 AND ${visibility}${filter} ORDER BY e.starts_at, e.id`, ...params);
  return list.map((r) => r.id);
}

let people: number[] = [];
let teams: number[] = [];
const ev: Record<string, number> = {};
const who: Record<string, number> = {};

beforeAll(async () => {
  await freshDb();
  await season();
  const a = await team("wD", "wD");
  const b = await team("wC1", "wC");
  const c = await team("wE", "wE");
  await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", b);
  const group = (await one<{ id: number }>("INSERT INTO teams (name, kind, age_class_code, level) VALUES ('Vorstand', 'group', 'F', 1) RETURNING id")).id;
  teams = [a, b, c, group];

  const pia = await person("Pia");
  const bea = await person("Bea");
  const kim = await person("Kim");
  const theo = await person("Theo");
  const hanna = await person("Hanna");
  const henni = await person("Henni");
  const nora = await person("Nora");
  const hilde = await person("Hilde");
  const willi = await person("Willi");
  const kira = await person("Kira");
  const kurt = await person("Kurt");
  const olga = await person("Olga");
  const carl = await person("Carl");
  const paula = await person("Paula");
  const peter = await person("Peter");
  const ada = await person("Ada", { admin: true });
  const vera = await person("Vera");
  people = [pia, bea, kim, theo, hanna, henni, nora, hilde, willi, kira, kurt, olga, carl, paula, peter, ada, vera];
  Object.assign(who, { pia, hanna, henni, nora, hilde, willi, kira, kurt, olga, carl, paula, peter });

  await member(pia, a);
  await member(bea, b);
  await member(kim, c, "coach");
  await member(kim, a);
  await member(theo, a, "coach");
  await member(hanna, a, "helper");
  await member(henni, a, "helper");
  await exec("UPDATE team_memberships SET helper_trainings = 1 WHERE person_id = ?", henni);
  await member(nora, c);
  await member(hilde, c);
  await member(willi, c);
  await member(vera, group);
  await guardian(paula, pia);
  await guardian(paula, bea);
  await guardian(peter, bea);
  await guardian(peter, kim);
  await guardian(ada, pia);

  const trainingA = await eventIn(a, 1);
  const gameA = await eventIn(a, 3, { kind: "game" });
  await eventIn(a, -5);
  await eventIn(a, 200, { kind: "game" });
  const trainingB = await eventIn(b, 2);
  const gameB = await eventIn(b, 4, { kind: "game" });
  await eventIn(c, 2);
  const gameC = await eventIn(c, 5, { kind: "game" });
  await eventIn(group, 6, { kind: "special", title: "Sitzung" });
  const specialB = await eventIn(b, 8, { kind: "special", title: "Ausflug" });
  const specialC = await eventIn(c, 9, { kind: "special", title: "Grillfest" });
  const clubWide = await eventIn(a, 12, { kind: "special", title: "Vereinsfest" });
  await exec("DELETE FROM event_teams WHERE event_id = ?", clubWide);
  await exec("UPDATE events SET club_wide = 1 WHERE id = ?", clubWide);
  await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", trainingA);

  await exec("INSERT INTO nominations (event_id, person_id, is_helper) VALUES (?, ?, 1)", gameA, nora);
  await exec("INSERT INTO help_requests (event_id, person_id, team_id) VALUES (?, ?, ?)", gameA, hilde, a);
  await exec("INSERT INTO help_requests (event_id, person_id, team_id, status) VALUES (?, ?, ?, 'declined')", gameA, willi, a);
  const refBlock = (await one<{ id: number }>("INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) VALUES (?, 5, '2099-01-01T10:00', '2099-01-01T11:00', 1) RETURNING id", gameC)).id;
  await exec("INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id) VALUES (?, ?, 5, ?)", gameC, refBlock, kira);
  const cakeBlock = (await one<{ id: number }>("INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) VALUES (?, 1, '2099-01-01T10:00', '2099-01-01T11:00', 2) RETURNING id", gameB)).id;
  await exec("INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id, child_id) VALUES (?, ?, 1, ?, ?)", gameB, cakeBlock, kurt, bea);
  await exec("INSERT INTO event_organizers (event_id, person_id) VALUES (?, ?)", specialB, olga);
  await exec("UPDATE events SET created_by = ? WHERE id = ?", carl, specialC);
  Object.assign(ev, { trainingA, gameA, trainingB, gameB, gameC, specialB, specialC, clubWide });
});

describe("Vorauswahl der sichtbaren Termine", () => {
  const ranges = [
    { from: "0000-01-01T00:00", to: "9999-12-31T00:00" },
    { from: "2000-01-01T00:00", to: "2099-01-01T00:00" },
  ];

  it("liefert für jede Person, jeden Zeitraum und jeden Mannschaftsfilter dasselbe wie die Prüfung jedes Termins", async () => {
    let compared = 0;
    for (const personId of people) {
      const actor = await actorFor(personId);
      for (const range of ranges) {
        for (const teamId of [undefined, ...teams]) {
          for (const kind of [undefined, "game"]) {
            const opts = { ...range, teamId, kind };
            const fast = (await listVisibleEvents(env.DB, actor, opts)).map((e) => e.id);
            expect(fast, `Person ${personId}, ${JSON.stringify(opts)}`).toEqual(await reference(actor, opts));
            compared++;
          }
        }
      }
    }
    expect(compared).toBe(people.length * 2 * 5 * 2);
  });

  it("kein sichtbarer Termin fehlt in der Vorauswahl", async () => {
    for (const personId of people) {
      const actor = await actorFor(personId);
      const missing = await rows<{ id: number }>(
        `WITH ${CANDIDATES_CTE}
         SELECT e.id FROM events e WHERE e.starts_at >= ?3 AND e.starts_at < ?4 AND ${VISIBLE_SQL} AND e.id NOT IN (SELECT id FROM ids)`,
        ...visibilityParams(actor),
        "0000-01-01T00:00",
        "9999-12-31T00:00",
      );
      expect(missing, `Person ${personId}`).toEqual([]);
    }
  });

  it("die Fixture deckt die Fälle ab", async () => {
    const sees = async (person: string, event: string) =>
      (await listVisibleEvents(env.DB, await actorFor(who[person]!), ranges[0]!)).some((e) => e.id === ev[event]);
    // Aushilfe: Spiele immer, Trainings nur mit Haken
    expect(await sees("hanna", "gameA")).toBe(true);
    expect(await sees("hanna", "trainingA")).toBe(false);
    expect(await sees("henni", "trainingA")).toBe(true);
    // Nominiert oder offen angefragt aus einer anderen Mannschaft, abgelehnte Anfrage nicht
    expect(await sees("nora", "gameA")).toBe(true);
    expect(await sees("hilde", "gameA")).toBe(true);
    expect(await sees("willi", "gameA")).toBe(false);
    // Jugendschiedsrichter-Dienst macht ein fremdes Spiel sichtbar, ein anderer Dienst nicht
    expect(await sees("kira", "gameC")).toBe(true);
    expect(await sees("kurt", "gameB")).toBe(false);
    // Organisatorin und Ersteller
    expect(await sees("olga", "specialB")).toBe(true);
    expect(await sees("carl", "specialC")).toBe(true);
    // Eltern: nur Mannschaften mit Eltern-Einbindung
    expect(await sees("paula", "trainingA")).toBe(true);
    expect(await sees("paula", "trainingB")).toBe(false);
    // Vereinsweit sehen alle
    for (const p of Object.keys(who)) expect(await sees(p, "clubWide")).toBe(true);
  });
});
