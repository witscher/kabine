// Terminübersicht seitenweise („Mehr Termine“). Namen erfunden.
import { beforeEach, describe, expect, it } from "vitest";
import { isRelevantEvent } from "../shared/relevance";
import type { EventPage, EventSummary } from "../shared/types";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let wc: number;
let lina: number;
let linaCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wc = await team("wC1", "wC");
  lina = await person("Lina");
  await member(lina, wd);
  linaCookie = await loginAs(lina);
});

const page = async (cookie: string, query: string) => {
  const res = await api<EventPage>(`/events?${query}`, { cookie });
  expect(res.status).toBe(200);
  return res.body;
};
const ids = (list: EventSummary[]) => list.map((e) => e.id);

describe("Terminübersicht seitenweise", () => {
  it("20 Termine pro Seite, „Mehr Termine“ beginnt mit derselben Liste", async () => {
    const all: number[] = [];
    for (let d = 1; d <= 30; d++) all.push(await eventIn(wd, d));
    const first = await page(linaCookie, "limit=20");
    expect(ids(first.events)).toEqual(all.slice(0, 20));
    expect(first.hasMore).toBe(true);
    const more = await page(linaCookie, "limit=40");
    expect(ids(more.events)).toEqual(all);
    expect(more.hasMore).toBe(false);
  });

  it("geht über 70 Tage hinaus bis zum Saisonende", async () => {
    const late = await eventIn(wd, 200, { kind: "game" });
    expect(ids((await page(linaCookie, "limit=20")).events)).toContain(late);
    // Ohne limit bleibt es beim Zeitraum von 70 Tagen
    const old = await api<{ events: EventSummary[] }>("/events", { cookie: linaCookie });
    expect(ids(old.body.events)).not.toContain(late);
    expect(old.body).not.toHaveProperty("hasMore");
  });

  it("filtert wie früher der Browser: Relevanz und Mannschaft", async () => {
    const tara = await person("Tara");
    await member(tara, wd, "coach");
    await member(tara, wc);
    const mia = await person("Mia");
    await member(mia, wc);
    await guardian(tara, mia);
    for (let d = 1; d <= 12; d++) {
      await eventIn(wd, d);
      await eventIn(wc, d, { kind: d % 3 ? "training" : "game" });
    }
    const special = await eventIn(wc, 5, { kind: "special", title: "Ausflug" });
    await exec("DELETE FROM event_teams WHERE event_id = ?", special);
    await exec("UPDATE events SET club_wide = 1 WHERE id = ?", special);
    const cookie = await loginAs(tara);
    const from = todayLocal();
    const old = await api<{ events: EventSummary[] }>(`/events?from=${from}&to=${addDays(from, 400)}`, { cookie });
    const expected = old.body.events.filter((e) => isRelevantEvent(e) && !e.isPast);
    expect(ids((await page(cookie, "limit=200")).events)).toEqual(ids(expected));
    const onlyWc = await page(cookie, `limit=200&team=${wc}`);
    expect(ids(onlyWc.events)).toEqual(ids(expected.filter((e) => e.teams.some((t) => t.id === wc))));
    expect(onlyWc.events.length).toBeGreaterThan(0);
  });

  it("die Seite endet am Ende eines Tages", async () => {
    const all: number[] = [];
    for (let d = 1; d <= 19; d++) all.push(await eventIn(wd, d));
    // Termin 20 und 21 am selben Tag
    all.push(await eventIn(wd, 20, { time: "10:00" }), await eventIn(wd, 20, { time: "16:00" }));
    await eventIn(wd, 21);
    const first = await page(linaCookie, "limit=20");
    expect(ids(first.events)).toEqual(all);
    expect(first.hasMore).toBe(true);
  });

  it("liefert den nächsten eigenen Termin für die große Karte auch hinter der Seite, höchstens 70 Tage", async () => {
    // Trainer der wD (viele Termine, kein eigener), Mutter eines Kindes in der wC1
    const tara = await person("Tara");
    await member(tara, wd, "coach");
    const mia = await person("Mia");
    await member(mia, wc);
    await guardian(tara, mia);
    for (let d = 1; d <= 25; d++) await eventIn(wd, d);
    // Ein Training: Dort ist das Kind Teilnehmerin (bei Spielen erst mit Nominierung)
    const miaTraining = await eventIn(wc, 30);
    const cookie = await loginAs(tara);
    const first = await page(cookie, "limit=20");
    // Die Seite bleibt bei 20 Terminen, der eigene Termin kommt für die große Karte dazu
    expect(first.events).toHaveLength(20);
    expect(ids(first.events)).not.toContain(miaTraining);
    expect(ids(first.next)).toEqual([miaTraining]);
    expect(first.hasMore).toBe(true);
    // Liegt er in der Seite, kommt er nicht doppelt
    expect((await page(cookie, "limit=40")).next).toEqual([]);
    // Jenseits von 70 Tagen nicht mehr
    await exec("UPDATE events SET starts_at = ? WHERE id = ?", `${addDays(todayLocal(), 80)}T10:00`, miaTraining);
    const later = await page(cookie, "limit=20");
    expect(later.events).toHaveLength(20);
    expect(later.next).toEqual([]);
  });

  it("offene Aushilfe-Anfragen stehen auch jenseits der Seite im Ergebnis", async () => {
    for (let d = 1; d <= 25; d++) await eventIn(wd, d);
    const game = await eventIn(wc, 40, { kind: "game" });
    await exec("INSERT INTO help_requests (event_id, person_id, team_id) VALUES (?, ?, ?)", game, lina, wc);
    const first = await page(linaCookie, "limit=20");
    expect(ids(first.events)).not.toContain(game);
    expect(ids(first.openHelp)).toEqual([game]);
    expect(first.openHelp[0]!.mine.some((m) => m.helpRequest?.status === "open")).toBe(true);
  });

  it("heute schon angepfiffene Spiele kommen als live, nicht in die Liste", async () => {
    const started = await eventIn(wd, 0, { kind: "game", time: "00:01" });
    const training = await eventIn(wd, 0, { time: "00:02" });
    const next = await eventIn(wd, 1);
    const first = await page(linaCookie, "limit=20");
    expect(ids(first.live)).toEqual([started]);
    expect(ids(first.events)).toEqual([next]);
    expect(ids(first.events)).not.toContain(training);
    expect(first.trainingsUntil).toBe(addDays(todayLocal(), 70));
  });

  it("vergangene Termine neueste zuerst, seitenweise", async () => {
    const all: number[] = [];
    for (let d = 1; d <= 25; d++) all.push(await eventIn(wd, -d));
    await eventIn(wd, 2);
    const first = await page(linaCookie, "limit=20&past=1");
    expect(ids(first.events)).toEqual(all.slice(0, 20));
    expect(first.hasMore).toBe(true);
    expect(first.trainingsUntil).toBeNull();
    const more = await page(linaCookie, "limit=40&past=1");
    expect(ids(more.events)).toEqual(all);
    expect(more.hasMore).toBe(false);
  });
});
