// Fahrgemeinschaften bei Auswärtsspielen. Alle Namen erfunden.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../../worker/index";
import { sendCarpoolChatReminders } from "../worker/domain";
import type { PushJob } from "../../../worker/domain/notify";
import { handleScheduled } from "../../../worker/cron";
import { addDays, localToInstant, todayLocal } from "../../../worker/lib/time";
import { exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "../../../test/helpers";

let pushes: PushJob[] = [];
let chat: { teamId: number; text: string }[] = [];

/** Env mit abgefangener Push-Queue und abgefangenen Chat-Systemmeldungen. */
function testEnv(): Env {
  const chatNs = {
    jurisdiction: () => {
      throw new Error("not implemented in workerd");
    },
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        if (url.endsWith("/system")) chat.push({ teamId: Number(name.slice(5)), text: (JSON.parse(String(init.body)) as { text: string }).text });
        return new Response("{}");
      },
    }),
  };
  return {
    ...env,
    CHAT: chatNs,
    PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) },
  } as unknown as Env;
}

async function call<T = any>(path: string, opts: { method?: string; body?: unknown; cookie: string }): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { cookie: opts.cookie, origin: "http://localhost:5173" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost:5173/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
    testEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const accountOf = async (personId: number) => (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;
const pushesTo = async (personId: number) => {
  const acc = await accountOf(personId);
  return pushes.filter((p) => p.accountIds.includes(acc));
};

let wd: number;
let other: number;
let coach: number, coachC: string;
let mia: number, miaC: string; // Spielerin mit eigenem Zugang, Mutter Paula
let paula: number, paulaC: string;
let lea: number; // Spielerin ohne Zugang, Vater Peter
let peter: number, peterC: string;
let nora: number; // Spielerin ohne Zugang, Vater Nils ohne Zugang
let nils: number;
let ida: number, idaC: string; // nicht nominiert
let otherCoachC: string;

async function game(days: number, opts: { isHome?: number | null; time?: string; published?: boolean } = {}) {
  const row = await one<{ id: number }>(
    `INSERT INTO events (kind, starts_at, is_home, home_team, guest_team, squad_published_at)
     VALUES ('game', ?, ?, 'HSG Gegnerstadt', 'SV Musterstadt', ?) RETURNING id`,
    `${addDays(todayLocal(), days)}T${opts.time ?? "14:00"}`,
    opts.isHome === undefined ? 0 : opts.isHome,
    opts.published === false ? null : "2026-01-01T00:00:00Z",
  );
  await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row.id, wd);
  for (const p of [mia, lea, nora]) await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", row.id, p);
  return row.id;
}

beforeEach(async () => {
  await freshDb();
  await season();
  pushes = [];
  chat = [];
  wd = await team("wD", "wD");
  other = await team("wC", "wC");
  coach = await person("Tina", { lastName: "Trainer" });
  mia = await person("Mia", { lastName: "Muster", birthYear: 2014 });
  paula = await person("Paula", { lastName: "Muster" });
  lea = await person("Lea", { lastName: "Beispiel", birthYear: 2014 });
  peter = await person("Peter", { lastName: "Beispiel" });
  nora = await person("Nora", { lastName: "Probe", birthYear: 2014 });
  nils = await person("Nils", { lastName: "Probe" });
  ida = await person("Ida", { lastName: "Anders", birthYear: 2014 });
  const otherCoach = await person("Olga");
  await member(coach, wd, "coach");
  await member(otherCoach, other, "coach");
  for (const p of [mia, lea, nora, ida]) await member(p, wd);
  await guardian(paula, mia);
  await guardian(peter, lea);
  await guardian(nils, nora);
  coachC = await loginAs(coach);
  miaC = await loginAs(mia);
  paulaC = await loginAs(paula);
  peterC = await loginAs(peter);
  idaC = await loginAs(ida);
  otherCoachC = await loginAs(otherCoach);
  await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
});

describe("Sichtbarkeit", () => {
  it("nur bei Auswärtsspielen und nur für Beteiligte", async () => {
    const away = await game(5);
    const home = await game(6, { isHome: 1 });
    expect((await call(`/events/${away}`, { cookie: paulaC })).body.modules.carpools).toMatchObject({ open: true, offers: [], waiting: [], canOffer: true });
    expect((await call(`/events/${away}`, { cookie: miaC })).body.modules.carpools.mine).toEqual([{ player: { id: mia, name: "Mia M.", self: true, coach: false, guardians: [{ id: paula, name: "Paula M." }] }, request: null }]);
    expect((await call(`/events/${home}`, { cookie: paulaC })).body.modules.carpools).toBeUndefined();
    // Nicht nominiert: sieht das Spiel, aber keine Fahrgemeinschaften (keine Namen)
    const idaView = await call(`/events/${away}`, { cookie: idaC });
    expect(idaView.status).toBe(200);
    expect(idaView.body.modules.carpools).toBeUndefined();
    // Trainer einer fremden Mannschaft sieht das Spiel gar nicht
    expect((await call(`/events/${away}`, { cookie: otherCoachC })).status).toBe(404);
    expect((await call(`/events/${away}/carpool/offers/${coach}`, { method: "PUT", body: { seats: 2 }, cookie: idaC })).status).toBe(403);
  });

  it("vor Veröffentlichung des Kaders nur für Trainer", async () => {
    const g = await game(5, { published: false });
    expect((await call(`/events/${g}`, { cookie: paulaC })).body.modules.carpools).toBeUndefined();
    const coachView = (await call(`/events/${g}`, { cookie: coachC })).body.modules.carpools;
    expect(coachView.coach.riders.map((r: { name: string }) => r.name).sort()).toEqual(["Lea B.", "Mia M.", "Nora P.", "Tina T."]);
    expect(coachView.coach.riders.find((r: { name: string }) => r.name === "Tina T.").coach).toBe(true);
    expect(coachView.coach.drivers.map((d: { name: string }) => d.name)).toEqual(
      expect.arrayContaining(["Mia M.", "Paula M.", "Lea B.", "Peter B.", "Nora P.", "Nils P.", "Tina T."]),
    );
  });
});

describe("Anbieten, suchen, buchen", () => {
  it("Mitfahrer bucht, Fahrer bekommt „Lea B. + 1 fährt mit dir mit“", async () => {
    const g = await game(5);
    expect((await call(`/events/${g}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 3 }, cookie: paulaC })).status).toBe(201);
    // Peter sucht für Lea mit einer Begleitperson; freie Plätze sieht er direkt, daher kein Match-Push
    expect((await call(`/events/${g}/carpool/requests/${lea}`, { method: "PUT", body: { companions: 1 }, cookie: peterC })).status).toBe(201);
    expect(await pushesTo(peter)).toEqual([]);
    const view = (await call(`/events/${g}`, { cookie: peterC })).body.modules.carpools;
    expect(view.offers[0]).toMatchObject({ name: "Paula M.", seats: 3, free: 3, mine: false, canEdit: false });
    expect(view.mine[0].request).toMatchObject({ name: "Lea B.", seats: 2, offerId: null, canEdit: true });
    expect(view.canOffer).toBe(false); // sucht schon für das Kind

    const offerId = view.offers[0].id;
    expect((await call(`/events/${g}/carpool/requests/${lea}/booking`, { method: "PUT", body: { offerId }, cookie: peterC })).status).toBe(200);
    const toPaula = await pushesTo(paula);
    expect(toPaula).toHaveLength(1);
    expect(toPaula[0]!.payload).toMatchObject({ title: "Neuer Mitfahrer", url: `/termine/${g}` });
    expect(toPaula[0]!.payload.body).toMatch(/^Lea B\. \+ 1 fährt mit dir mit: HSG Gegnerstadt – K wD am .+, 14:00 Uhr\.$/);

    const after = (await call(`/events/${g}`, { cookie: paulaC })).body.modules.carpools;
    expect(after.offers[0]).toMatchObject({ free: 1, mine: true, canEdit: true });
    expect(after.offers[0].riders.map((r: { name: string; seats: number }) => [r.name, r.seats])).toEqual([["Lea B.", 2]]);
    expect(after.waiting).toEqual([]);
  });

  it("Terminübersicht: Kurzinfo (belegt/angeboten, wer noch sucht) nur für Beteiligte", async () => {
    const g = await game(5);
    const summary = async (cookie: string) => (await call("/events?to=2099-12-31", { cookie })).body.events.find((e: { id: number }) => e.id === g);
    expect((await summary(paulaC)).modules.carpools).toBeUndefined();
    await call(`/events/${g}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 2 }, cookie: paulaC });
    await call(`/events/${g}/carpool/requests/${lea}`, { method: "PUT", body: { companions: 1 }, cookie: peterC });
    await call(`/events/${g}/carpool/requests/${nora}`, { method: "PUT", body: { companions: 0 }, cookie: coachC });
    expect((await summary(paulaC)).modules.carpools).toEqual({ taken: 0, seats: 2, waiting: 2 });
    const offerId = (await call(`/events/${g}`, { cookie: peterC })).body.modules.carpools.offers[0].id;
    await call(`/events/${g}/carpool/requests/${lea}/booking`, { method: "PUT", body: { offerId }, cookie: peterC });
    expect((await summary(peterC)).modules.carpools).toEqual({ taken: 2, seats: 2, waiting: 1 });
    // Nicht nominiert: keine Kurzinfo
    expect((await summary(idaC)).modules.carpools).toBeUndefined();
  });

  it("wer fährt, bekommt für sich und das eigene Kind keine Suche angeboten", async () => {
    const g = await game(5);
    expect((await call(`/events/${g}`, { cookie: paulaC })).body.modules.carpools.mine.map((m: { player: { id: number } }) => m.player.id)).toEqual([mia]);
    await call(`/events/${g}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 2 }, cookie: paulaC });
    expect((await call(`/events/${g}`, { cookie: paulaC })).body.modules.carpools.mine).toEqual([]);
    // Auch Mia selbst sieht keine Suche, ihre Mutter fährt
    expect((await call(`/events/${g}`, { cookie: miaC })).body.modules.carpools.mine).toEqual([]);
    // Andere Familien weiter
    expect((await call(`/events/${g}`, { cookie: peterC })).body.modules.carpools.mine.map((m: { player: { id: number } }) => m.player.id)).toEqual([lea]);
  });

  it("sucht jemand aus der Familie, gibt es keine zweite Suche; die Eltern stehen mit Namen als Begleitung", async () => {
    // Paula ist Trainerin und Mutter von Mia: beide könnten mitfahren
    await member(paula, wd, "coach");
    const g = await game(5);
    const before = (await call(`/events/${g}`, { cookie: paulaC })).body.modules.carpools.mine;
    expect(before.map((m: { player: { id: number } }) => m.player.id).sort()).toEqual([mia, paula].sort());
    expect(before.find((m: { player: { id: number } }) => m.player.id === mia).player.guardians).toEqual([{ id: paula, name: "Paula M." }]);
    expect((await call(`/events/${g}/carpool/requests/${mia}`, { method: "PUT", body: { companions: 1 }, cookie: paulaC })).status).toBe(201);
    // Danach nur noch Mias Suche, keine eigene für Paula
    const after = (await call(`/events/${g}`, { cookie: paulaC })).body.modules.carpools;
    expect(after.mine.map((m: { player: { id: number } }) => m.player.id)).toEqual([mia]);
    expect(after.canOffer).toBe(false);
    const second = await call(`/events/${g}/carpool/requests/${paula}`, { method: "PUT", body: { companions: 0 }, cookie: paulaC });
    expect(second.body.error.code).toBe("carpool_family");
    // Andere Familien sehen keine fremden Elternnamen
    expect((await call(`/events/${g}`, { cookie: peterC })).body.modules.carpools.mine.map((m: { player: { guardians: { name: string }[] } }) => m.player.guardians)).toEqual([
      [{ id: peter, name: "Peter B." }],
    ]);
  });

  it("fährt ein Familienmitglied, ist die ganze Familie versorgt (auch Geschwister, auch wenn das Kind anbietet)", async () => {
    const mila = await person("Mila", { lastName: "Muster", birthYear: 2015 });
    await member(mila, wd);
    await guardian(paula, mila);
    const g = await game(5);
    await exec("INSERT OR IGNORE INTO nominations (event_id, person_id) VALUES (?, ?)", g, mila);
    // Mia (minderjährig) bietet zwei Plätze an, gefahren wird von der Familie
    expect((await call(`/events/${g}/carpool/offers/${mia}`, { method: "PUT", body: { seats: 2 }, cookie: miaC })).status).toBe(201);
    expect((await call(`/events/${g}`, { cookie: paulaC })).body.modules.carpools.mine).toEqual([]);
    // Die Schwester sucht nicht, der Server lehnt es ebenfalls ab
    const res = await call(`/events/${g}/carpool/requests/${mila}`, { method: "PUT", body: { companions: 0 }, cookie: paulaC });
    expect(res.body.error.code).toBe("carpool_family");
  });

  it("über die Kapazität geht nicht, gleichzeitig gewinnt nur eine Buchung", async () => {
    const g = await game(5);
    await call(`/events/${g}/carpool/offers/${coach}`, { method: "PUT", body: { seats: 2 }, cookie: coachC });
    const offerId = (await one<{ id: number }>("SELECT id FROM carpool_offers")).id;
    await call(`/events/${g}/carpool/requests/${mia}`, { method: "PUT", body: { companions: 1 }, cookie: paulaC });
    await call(`/events/${g}/carpool/requests/${lea}`, { method: "PUT", body: { companions: 1 }, cookie: peterC });
    const [a, b] = await Promise.all([
      call(`/events/${g}/carpool/requests/${mia}/booking`, { method: "PUT", body: { offerId }, cookie: paulaC }),
      call(`/events/${g}/carpool/requests/${lea}/booking`, { method: "PUT", body: { offerId }, cookie: peterC }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body, b.body].find((x) => x.error)?.error.code).toBe("carpool_full");
    expect((await one<{ n: number }>("SELECT sum(1 + companions) AS n FROM carpool_requests WHERE offer_id = ?", offerId)).n).toBe(2);
  });

  it("prüft Rechte und Eingaben", async () => {
    const g = await game(5);
    // Fremdes Kind
    expect((await call(`/events/${g}/carpool/requests/${lea}`, { method: "PUT", body: { companions: 0 }, cookie: paulaC })).status).toBe(403);
    // Zu viele Begleitpersonen
    expect((await call(`/events/${g}/carpool/requests/${mia}`, { method: "PUT", body: { companions: 3 }, cookie: paulaC })).status).toBe(400);
    // Angebot für andere nur als Trainer
    expect((await call(`/events/${g}/carpool/offers/${peter}`, { method: "PUT", body: { seats: 2 }, cookie: paulaC })).status).toBe(403);
    // Nicht nominiert kann nicht mitfahren, auch nicht über den Trainer
    expect((await call(`/events/${g}/carpool/requests/${ida}`, { method: "PUT", body: { companions: 0 }, cookie: coachC })).status).toBe(400);
    // Wer fährt, sucht nicht für das eigene Kind
    await call(`/events/${g}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 2 }, cookie: paulaC });
    const clash = await call(`/events/${g}/carpool/requests/${mia}`, { method: "PUT", body: { companions: 0 }, cookie: miaC });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("carpool_family");
    // Heimspiel: keine Fahrgemeinschaften
    const home = await game(6, { isHome: 1 });
    expect((await call(`/events/${home}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 2 }, cookie: paulaC })).status).toBe(404);
  });
});

describe("Match-Push", () => {
  it("an alle passenden Wartenden, pro Angebot nur einmal", async () => {
    const g = await game(5);
    await call(`/events/${g}/carpool/requests/${mia}`, { method: "PUT", body: { companions: 0 }, cookie: paulaC });
    await call(`/events/${g}/carpool/requests/${lea}`, { method: "PUT", body: { companions: 2 }, cookie: peterC });
    expect(pushes).toEqual([]);
    // Zwei Plätze: passt für Mia (1), nicht für Lea (3)
    await call(`/events/${g}/carpool/offers/${coach}`, { method: "PUT", body: { seats: 2 }, cookie: coachC });
    expect((await pushesTo(paula)).map((p) => p.payload.title)).toEqual(["Mitfahrgelegenheit frei"]);
    expect((await pushesTo(paula))[0]!.payload.body).toContain("Tina T. hat 2 freie Plätze");
    expect(await pushesTo(mia)).toHaveLength(1);
    expect(await pushesTo(peter)).toEqual([]);
    // Mehr Plätze: jetzt passt Lea, Mia bekommt keinen zweiten Hinweis
    pushes = [];
    await call(`/events/${g}/carpool/offers/${coach}`, { method: "PUT", body: { seats: 3 }, cookie: coachC });
    expect(await pushesTo(peter)).toHaveLength(1);
    expect(await pushesTo(paula)).toEqual([]);
  });

  it("respektiert abgeschaltete Benachrichtigungen", async () => {
    const g = await game(5);
    await call(`/events/${g}/carpool/requests/${mia}`, { method: "PUT", body: { companions: 0 }, cookie: paulaC });
    await exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) VALUES (?, ?, 'carpool', 0)", await accountOf(paula), mia);
    await call(`/events/${g}/carpool/offers/${peter}`, { method: "PUT", body: { seats: 2 }, cookie: peterC });
    expect(await pushesTo(paula)).toEqual([]);
    expect(await pushesTo(mia)).toHaveLength(1);
  });
});

describe("Fahrer ändert sich", () => {
  async function bookedSetup() {
    const g = await game(5);
    await call(`/events/${g}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 3 }, cookie: paulaC });
    const offerId = (await one<{ id: number }>("SELECT id FROM carpool_offers")).id;
    await call(`/events/${g}/carpool/requests/${lea}`, { method: "PUT", body: { companions: 1 }, cookie: peterC });
    await call(`/events/${g}/carpool/requests/${lea}/booking`, { method: "PUT", body: { offerId }, cookie: peterC });
    await call(`/events/${g}/carpool/requests/${nora}`, { method: "PUT", body: { companions: 0 }, cookie: coachC });
    await call(`/events/${g}/carpool/requests/${nora}/booking`, { method: "PUT", body: { offerId }, cookie: coachC });
    const leaReq = (await one<{ id: number }>("SELECT id FROM carpool_requests WHERE player_id = ?", lea)).id;
    pushes = [];
    return { g, offerId, leaReq };
  }

  it("Plätze unter die Belegung senken nur mit Abwahl", async () => {
    const { g, leaReq } = await bookedSetup();
    const tooFew = await call(`/events/${g}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 1 }, cookie: paulaC });
    expect(tooFew.status).toBe(409);
    expect(tooFew.body.error.code).toBe("carpool_overbooked");
    expect((await call(`/events/${g}/carpool/offers/${paula}`, { method: "PUT", body: { seats: 1, removeRequestIds: [leaReq] }, cookie: paulaC })).status).toBe(200);
    expect(await one("SELECT offer_id FROM carpool_requests WHERE id = ?", leaReq)).toEqual({ offer_id: null });
    const toPeter = await pushesTo(peter);
    expect(toPeter).toHaveLength(1);
    expect(toPeter[0]!.payload).toMatchObject({ title: "Mitfahrt entfällt" });
    expect(toPeter[0]!.payload.body).toContain("Paula M. kann Lea B. nicht mehr mitnehmen");
  });

  it("Angebot zurückziehen: Mitfahrer suchen wieder", async () => {
    const { g } = await bookedSetup();
    await call(`/events/${g}/carpool/offers/${coach}`, { method: "PUT", body: { seats: 4 }, cookie: coachC });
    pushes = [];
    expect((await call(`/events/${g}/carpool/offers/${paula}`, { method: "DELETE", cookie: paulaC })).status).toBe(200);
    expect(await rows("SELECT player_id, offer_id FROM carpool_requests ORDER BY player_id")).toEqual([
      { player_id: lea, offer_id: null },
      { player_id: nora, offer_id: null },
    ]);
    const titles = (await pushesTo(peter)).map((p) => p.payload.title);
    expect(titles).toContain("Mitfahrt entfällt");
    expect(titles).toContain("Mitfahrgelegenheit frei"); // Tina hat noch Platz
  });

  it("einzelnen Mitfahrer entfernen", async () => {
    const { g, offerId, leaReq } = await bookedSetup();
    expect((await call(`/events/${g}/carpool/offers/${paula}/riders/${leaReq}`, { method: "DELETE", cookie: paulaC })).status).toBe(200);
    expect((await rows("SELECT id FROM carpool_requests WHERE offer_id = ?", offerId)).length).toBe(1);
    expect((await pushesTo(peter)).map((p) => p.payload.title)).toEqual(["Mitfahrt entfällt"]); // kein Hinweis auf dasselbe Angebot
  });

  it("Absage und Kader-Streichung geben den Platz frei", async () => {
    const { g, offerId } = await bookedSetup();
    expect((await call(`/events/${g}/responses`, { body: { personId: lea, status: "no", reason: "krank" }, cookie: peterC })).status).toBe(200);
    expect((await rows("SELECT id FROM carpool_requests WHERE player_id = ?", lea)).length).toBe(0);
    expect((await pushesTo(paula)).map((p) => p.payload.body)).toEqual([expect.stringContaining("Lea B. + 1 fährt nicht mit dir mit")]);
    pushes = [];
    expect((await call(`/events/${g}/squad`, { method: "PUT", body: { personIds: [mia, lea] }, cookie: coachC })).status).toBe(200);
    expect((await rows("SELECT id FROM carpool_requests WHERE offer_id = ?", offerId)).length).toBe(0);
    expect((await pushesTo(paula)).some((p) => p.payload.body.includes("Nora P. fährt nicht mit dir mit"))).toBe(true);
  });
});

describe("Trainer fahren mit", () => {
  it("Trainer sucht für sich, bekommt den Match-Push und bucht", async () => {
    const g = await game(5);
    const carl = await person("Carl", { lastName: "Co" });
    await member(carl, wd, "coach");
    const carlC = await loginAs(carl);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, 'https://push.example/carl', 'k', 'a')", await accountOf(carl));
    const before = (await call(`/events/${g}`, { cookie: carlC })).body.modules.carpools;
    expect(before.mine).toEqual([{ player: { id: carl, name: "Carl C.", self: true, coach: true, guardians: [] }, request: null }]);
    expect(before.canOffer).toBe(true);

    expect((await call(`/events/${g}/carpool/requests/${carl}`, { method: "PUT", body: { companions: 1 }, cookie: carlC })).status).toBe(201);
    // Tina fährt: Carl bekommt den Hinweis und bucht
    await call(`/events/${g}/carpool/offers/${coach}`, { method: "PUT", body: { seats: 3 }, cookie: coachC });
    expect((await pushesTo(carl)).map((p) => p.payload.title)).toEqual(["Mitfahrgelegenheit frei"]);
    const offerId = (await one<{ id: number }>("SELECT id FROM carpool_offers")).id;
    pushes = [];
    expect((await call(`/events/${g}/carpool/requests/${carl}/booking`, { method: "PUT", body: { offerId }, cookie: carlC })).status).toBe(200);
    expect((await pushesTo(coach)).map((p) => p.payload.body)).toEqual([expect.stringMatching(/^Carl C\. \+ 1 fährt mit dir mit/)]);
    // Wer fährt, sucht nicht zugleich
    const tinaSearch = await call(`/events/${g}/carpool/requests/${coach}`, { method: "PUT", body: { companions: 0 }, cookie: coachC });
    expect(tinaSearch.body.error.code).toBe("carpool_family");
  });
});

describe("Trainer trägt ein", () => {
  it("für Eltern ohne Zugang und Kinder; Pushes an Betroffene, nicht an den Trainer", async () => {
    const g = await game(5);
    expect((await call(`/events/${g}/carpool/offers/${nils}`, { method: "PUT", body: { seats: 2 }, cookie: coachC })).status).toBe(201);
    expect((await call(`/events/${g}/carpool/offers/${ida}`, { method: "PUT", body: { seats: 2 }, cookie: coachC })).status).toBe(400); // nicht beteiligt
    const offerId = (await one<{ id: number }>("SELECT id FROM carpool_offers WHERE person_id = ?", nils)).id;
    await call(`/events/${g}/carpool/requests/${lea}`, { method: "PUT", body: { companions: 0 }, cookie: coachC });
    expect((await pushesTo(peter)).map((p) => p.payload.body)).toEqual([expect.stringContaining("(eingetragen von Tina)")]);
    pushes = [];
    expect((await call(`/events/${g}/carpool/requests/${lea}/booking`, { method: "PUT", body: { offerId }, cookie: coachC })).status).toBe(200);
    expect((await pushesTo(peter)).map((p) => p.payload.body)).toEqual([expect.stringMatching(/^Lea B\. fährt bei Nils P\. mit: .*\(eingetragen von Tina\)\.$/)]);
    expect(await pushesTo(coach)).toEqual([]);
    // Spieler darf nichts für andere eintragen
    expect((await call(`/events/${g}/carpool/requests/${lea}/booking`, { method: "DELETE", cookie: miaC })).status).toBe(403);
    expect((await call(`/events/${g}/carpool/offers/${nils}/riders/1`, { method: "DELETE", cookie: miaC })).status).toBe(403);
  });
});

describe("Chat am Vortag", () => {
  const at = (hour: string) => localToInstant(`${todayLocal()}T${hour}`);

  it("um 10 und 18 Uhr je einmal, nur wenn jemand sucht", async () => {
    const g = await game(1);
    const later = await game(2);
    await exec("INSERT INTO carpool_requests (event_id, player_id, companions) VALUES (?, ?, 1), (?, ?, 0), (?, ?, 0)", g, mia, g, lea, later, nora);
    expect(await sendCarpoolChatReminders(testEnv(), at("09:30"))).toBe(0);
    expect(await sendCarpoolChatReminders(testEnv(), at("10:17"))).toBe(1);
    expect(chat).toEqual([
      {
        teamId: wd,
        text: "Fahrgemeinschaft für morgen, HSG Gegnerstadt – K wD (14:00 Uhr): Es suchen noch Mia M. (2 Plätze) und Lea B. eine Mitfahrgelegenheit. Wer Plätze frei hat, bitte im Termin eintragen.",
      },
    ]);
    expect(await sendCarpoolChatReminders(testEnv(), at("11:17"))).toBe(0);
    expect(await sendCarpoolChatReminders(testEnv(), at("18:17"))).toBe(1);
    expect(await sendCarpoolChatReminders(testEnv(), at("19:17"))).toBe(0);
  });

  it("nicht ohne Suchende, nicht bei abgesagtem Spiel, nicht im Wartungsmodus", async () => {
    const g = await game(1);
    await call(`/events/${g}/carpool/offers/${coach}`, { method: "PUT", body: { seats: 3 }, cookie: coachC });
    const offerId = (await one<{ id: number }>("SELECT id FROM carpool_offers")).id;
    await exec("INSERT INTO carpool_requests (event_id, player_id, offer_id) VALUES (?, ?, ?)", g, mia, offerId);
    expect(await sendCarpoolChatReminders(testEnv(), at("10:17"))).toBe(0);
    // Abgesagt hat, wer sucht: zählt nicht
    await exec("INSERT INTO carpool_requests (event_id, player_id) VALUES (?, ?)", g, lea);
    await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'krank', '2026-01-01T00:00:00Z')", g, lea);
    expect(await sendCarpoolChatReminders(testEnv(), at("10:17"))).toBe(0);
    await exec("DELETE FROM responses");
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z'");
    expect(await sendCarpoolChatReminders(testEnv(), at("10:17"))).toBe(0);
    await exec("UPDATE events SET cancelled_at = NULL");
    await env.KV.put("maintenance", JSON.stringify({ since: "2026-01-01T00:00:00Z" }));
    await handleScheduled(testEnv(), at("10:17"));
    expect(chat).toEqual([]);
  });
});

describe("Benachrichtigungseinstellungen", () => {
  it("Erwähnungen und Fahrgemeinschaften lassen sich abschalten", async () => {
    for (const topic of ["mentions", "carpool"]) {
      expect((await call("/me/notifications", { method: "PUT", body: { personId: paula, topic, enabled: false }, cookie: paulaC })).status).toBe(200);
    }
    const res = await call("/me/notifications", { cookie: paulaC });
    expect(res.body.persons[0].topics).toMatchObject({ mentions: false, carpool: false });
  });
});
