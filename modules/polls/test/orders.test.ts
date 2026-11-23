// Polls module, orders: payment details of the club, order numbers, reported and confirmed amounts, top-up orders,
// ignoring an order, product photos. Names invented.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { api, freshDb, guardian, loginAs, member, person, rows, season, team } from "../../../test/helpers";
import { saveClub } from "../../../worker/domain/club";
import { addDays, todayLocal } from "../../../worker/lib/time";
import { epcPayload, normalizeIban, paymentReference, paymentState, paypalName } from "../types";
import { pollRecipients } from "../worker/domain";

let wd: number;
let kim: number;
let coachCookie: string;
let monaCookie: string;
let paulCookie: string;
let otherCookie: string;
let adminCookie: string;

const later = () => `${addDays(todayLocal(), 7)}T20:00`;

beforeEach(async () => {
  await freshDb();
  await season();
  await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, polls: true } });
  wd = await team("wD", "wD");
  const coach = await person("Tara");
  kim = await person("Kim", { lastName: "Kraus" });
  const mona = await person("Mona", { lastName: "Kraus" });
  const paul = await person("Paul", { lastName: "Kraus" });
  const other = await person("Olga");
  await member(coach, wd, "coach");
  await member(kim, wd);
  await member(other, wd);
  await guardian(mona, kim);
  await guardian(paul, kim);
  coachCookie = await loginAs(coach);
  monaCookie = await loginAs(mona);
  paulCookie = await loginAs(paul);
  otherCookie = await loginAs(other);
  adminCookie = await loginAs(await person("Ada", { admin: true }));
});

const order = (extra: Record<string, unknown> = {}) => ({
  teamId: wd,
  kind: "order",
  title: "Wintermütze",
  perFamily: true,
  whoPlayers: true,
  endsAt: later(),
  options: [
    { label: "Mütze", priceCents: 2500 },
    { label: "Schal", priceCents: 1500 },
  ],
  ...extra,
});

describe("Bezahlregeln", () => {
  it("Zahlstand: offen, gemeldet, bezahlt, nachbestellt, zu viel", () => {
    expect(paymentState({ totalCents: 2500, paidCents: 0, reportedCents: 0 })).toMatchObject({ dueCents: 2500, awaiting: false, settled: false });
    expect(paymentState({ totalCents: 2500, paidCents: 0, reportedCents: 2500 })).toMatchObject({ dueCents: 0, awaiting: true, settled: false });
    expect(paymentState({ totalCents: 4000, paidCents: 2500, reportedCents: 2500 })).toMatchObject({ dueCents: 1500, settled: false });
    expect(paymentState({ totalCents: 1500, paidCents: 4000, reportedCents: 4000 })).toMatchObject({ dueCents: 0, overCents: 2500, settled: true });
  });

  it("PayPal-Name, IBAN mit Prüfziffer, Verwendungszweck und GiroCode", () => {
    expect(paypalName("https://www.paypal.com/paypalme/TVBeispiel")).toBe("TVBeispiel");
    expect(paypalName("paypal.me/abc/")).toBe("abc");
    expect(paypalName("")).toBeNull();
    expect(paypalName("https://evil.example/x")).toBeUndefined();
    expect(normalizeIban("de89 3704 0044 0532 0130 00")).toBe("DE89370400440532013000");
    expect(normalizeIban("DE89 3704 0044 0532 0130 01")).toBeUndefined();
    expect(paymentReference("x".repeat(200), 17, "Nr.")).toHaveLength(140);
    expect(paymentReference("Wintermütze", 17, "Nr.")).toBe("Wintermütze Nr. 17");
    expect(epcPayload("TV Beispiel", "DE89370400440532013000", 2550, "Wintermütze Nr. 17").split("\n")).toEqual([
      "BCD",
      "002",
      "1",
      "SCT",
      "",
      "TV Beispiel",
      "DE89370400440532013000",
      "EUR25.50",
      "",
      "",
      "Wintermütze Nr. 17",
    ]);
  });
});

describe("Bezahlangaben des Vereins", () => {
  it("nur Admins legen sie fest, Trainer lesen sie, PayPal-Name und IBAN werden geprüft", async () => {
    expect((await api("/polls/payment", { method: "PUT", cookie: coachCookie, body: { paypal: "x" } })).status).toBe(403);
    expect((await api("/polls/payment", { cookie: monaCookie })).status).toBe(403);
    expect((await api("/polls/payment", { cookie: coachCookie })).body).toEqual({ paypal: null, holder: null, iban: null, currency: "EUR" });
    const put = (body: Record<string, unknown>) => api("/polls/payment", { method: "PUT", cookie: adminCookie, body });
    expect((await put({ paypal: "https://evil.example/x" })).body.error.code).toBe("bad_paypal");
    expect((await put({ holder: "TV Beispiel", iban: "DE89 3704 0044 0532 0130 01" })).body.error.code).toBe("bad_iban");
    expect((await put({ iban: "DE89 3704 0044 0532 0130 00" })).body.error.code).toBe("bad_iban");
    expect((await put({ currency: "XYZ" })).status).toBe(400);
    expect((await put({ paypal: "https://www.paypal.com/paypalme/TVBeispiel", holder: "TV Beispiel", iban: "de89 3704 0044 0532 0130 00" })).body).toEqual({
      paypal: "TVBeispiel",
      holder: "TV Beispiel",
      iban: "DE89370400440532013000",
      currency: "EUR",
    });
    // Every order shows them, other kinds do not
    const id = (await api("/polls", { cookie: coachCookie, body: order() })).body.id;
    expect((await api(`/polls/${id}`, { cookie: monaCookie })).body.poll.payment).toMatchObject({ paypal: "TVBeispiel", iban: "DE89370400440532013000" });
    const other = (await api("/polls", { cookie: coachCookie, body: { teamId: wd, kind: "choice", title: "Wohin?", whoPlayers: true, endsAt: later(), options: [{ label: "A" }, { label: "B" }] } })).body.id;
    expect((await api(`/polls/${other}`, { cookie: coachCookie })).body.poll.payment).toBeNull();
    // Remove
    expect((await put({ paypal: "", holder: "", iban: "" })).body).toEqual({ paypal: null, holder: null, iban: null, currency: "EUR" });
  });
});

describe("Bezahlung einer Bestellung", () => {
  it("Bestellnummer beim ersten Bestellen, bleibt beim Ändern; Verwendungszweck ohne Namen, PayPal-Mitteilung mit Namen", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: order() })).body.id;
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    const [hat] = d.options.map((o: any) => o.id);
    const otherUnit = (await api(`/polls/${id}`, { cookie: otherCookie })).body.myUnits[0].unitId;
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: otherCookie, body: { unitId: otherUnit, answers: [{ optionId: hat, value: 1 }] } });
    const first = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: d.myUnits[0].unitId, answers: [{ optionId: hat, value: 1 }] } });
    expect(first.body.myUnits[0]).toMatchObject({ orderNo: 2, reference: "Wintermütze Nr. 2", paypalNote: "Wintermütze Nr. 2 · Kim Kraus" });
    const again = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: d.myUnits[0].unitId, answers: [{ optionId: hat, value: 3 }] } });
    expect(again.body.myUnits[0].orderNo).toBe(2);
    const cv = (await api(`/polls/${id}`, { cookie: coachCookie })).body;
    expect(cv.orders.map((o: any) => [o.orderNo, o.label])).toEqual([
      [1, "Olga Muster"],
      [2, "Familie Kraus: Kim"],
    ]);
  });

  it("melden, bestätigen, nachbestellen, kürzen", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: order() })).body.id;
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    const unit = d.myUnits[0].unitId;
    const [hat, scarf] = d.options.map((o: any) => o.id);
    const place = (answers: { optionId: number; value: number }[]) =>
      api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: unit, answers: answers.map((a) => ({ ...a, size: "" })) } });
    const mine = async () => (await api(`/polls/${id}`, { cookie: monaCookie })).body.myUnits[0];
    const listed = async () => (await api(`/polls/${id}`, { cookie: coachCookie })).body.orders[0];
    const confirm = (paid: boolean) => api(`/polls/${id}/ballot/${unit}/paid`, { method: "PUT", cookie: coachCookie, body: { paid } });
    const report = (reported: boolean, cookie = monaCookie) => api(`/polls/${id}/ballot/${unit}/reported`, { method: "PUT", cookie, body: { reported } });

    await place([{ optionId: hat, value: 1 }]);
    expect((await mine()).payment).toEqual({ totalCents: 2500, paidCents: 0, reportedCents: 0 });
    // The family reports "paid", nothing is confirmed yet; others cannot report for them
    expect((await report(true)).status).toBe(200);
    expect((await report(true, otherCookie)).status).toBe(403);
    expect((await mine()).payment).toEqual({ totalCents: 2500, paidCents: 0, reportedCents: 2500 });
    expect(await listed()).toMatchObject({ paid: false, paidCents: 0, reportedCents: 2500 });
    // The creator confirms; another coach of the team cannot, nor can the family
    const coach2 = await person("Uwe");
    await member(coach2, wd, "coach");
    expect((await api(`/polls/${id}/ballot/${unit}/paid`, { method: "PUT", cookie: await loginAs(coach2), body: { paid: true } })).status).toBe(403);
    expect((await api(`/polls/${id}/ballot/${unit}/paid`, { method: "PUT", cookie: monaCookie, body: { paid: true } })).status).toBe(403);
    expect((await confirm(true)).body.orders[0]).toMatchObject({ paid: true, paidCents: 2500 });

    // Top-up order: the rest is open, PayPal note says "top-up", the number stays
    await place([
      { optionId: hat, value: 1 },
      { optionId: scarf, value: 1 },
    ]);
    const after = await mine();
    expect(after).toMatchObject({ orderNo: 1, payment: { totalCents: 4000, paidCents: 2500, reportedCents: 2500 } });
    expect(paymentState(after.payment)).toMatchObject({ dueCents: 1500, settled: false });
    expect(after.paypalNote).toContain("Nachzahlung");
    expect(await listed()).toMatchObject({ paid: false, totalCents: 4000, paidCents: 2500 });
    await report(true);
    await confirm(true);
    expect(await listed()).toMatchObject({ paid: true, paidCents: 4000, reportedCents: 4000 });

    // Shortened after paying: paid too much, stays "paid"; withdrawing is no longer possible, reporting also after the end
    await place([{ optionId: scarf, value: 1 }]);
    expect(await listed()).toMatchObject({ paid: true, totalCents: 1500, paidCents: 4000 });
    expect((await api(`/polls/${id}/ballot/${unit}`, { method: "DELETE", cookie: monaCookie })).body.error.code).toBe("already_paid");
    await api(`/polls/${id}/close`, { method: "POST", cookie: coachCookie });
    expect((await report(false)).status).toBe(200);

    // Undo the confirmation
    await confirm(false);
    expect(await listed()).toMatchObject({ paid: false, paidCents: 0 });
  });
});

describe("Bestellung ignorieren", () => {
  const summary = async (id: number, cookie: string) => (await api("/polls", { cookie })).body.polls.find((p: any) => p.id === id);
  const ignore = (id: number, cookie: string, ignored = true) => api(`/polls/${id}/ignore`, { method: "PUT", cookie, body: { ignored } });
  const accountOf = async (cookie: string) => (await api("/session", { cookie })).body.me.accountId;

  it("nur für die eigene Person: Startseite, App-Symbol und Erinnerung, beim Ersteller weiter offen", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: order() })).body.id;
    expect(await summary(id, monaCookie)).toMatchObject({ openUnits: 1, ignored: false });
    expect((await api("/badge", { cookie: monaCookie })).body.modules).toBe(1);

    expect((await ignore(id, monaCookie)).status).toBe(200);
    expect((await ignore(id, monaCookie)).status).toBe(200);
    expect(await summary(id, monaCookie)).toMatchObject({ openUnits: 1, ignored: true });
    expect((await api("/badge", { cookie: monaCookie })).body.modules).toBe(0);
    expect((await api("/polls/open", { cookie: monaCookie })).body.polls).toEqual([]);
    // The other parent still sees the order
    expect(await summary(id, paulCookie)).toMatchObject({ openUnits: 1, ignored: false });
    expect((await api("/badge", { cookie: paulCookie })).body.modules).toBe(1);
    // Reminder only to the other parent
    const recipients = await pollRecipients(env.DB, id, true);
    expect(recipients).toContain(await accountOf(paulCookie));
    expect(recipients).not.toContain(await accountOf(monaCookie));
    // For the coach: not ordered yet
    expect((await api(`/polls/${id}`, { cookie: coachCookie })).body.pending).toContain("Familie Kraus: Kim");

    // Show again
    await ignore(id, monaCookie, false);
    expect(await summary(id, monaCookie)).toMatchObject({ ignored: false });
  });

  it("wer doch bestellt, hat nicht mehr ignoriert; nur Bestellungen, nur wer bestellen darf", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: order() })).body.id;
    await ignore(id, monaCookie);
    const d = (await api(`/polls/${id}`, { cookie: monaCookie })).body;
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: d.myUnits[0].unitId, answers: [] } });
    expect(await summary(id, monaCookie)).toMatchObject({ openUnits: 0, ignored: false });
    // Kim's parents order, Kim cannot ignore it (she does not see it)
    expect((await ignore(id, await loginAs(kim))).status).toBe(404);
    const choice = (await api("/polls", { cookie: coachCookie, body: { teamId: wd, kind: "choice", title: "Wohin?", whoPlayers: true, endsAt: later(), options: [{ label: "A" }, { label: "B" }] } })).body.id;
    expect((await ignore(choice, monaCookie)).body.error.code).toBe("not_order");
  });
});

describe("Produktfotos", () => {
  const webp = (seed: number) => new Uint8Array([...new TextEncoder().encode("RIFF"), 20, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 "), seed, 1, 2, 3, 4, 5]);

  async function raw(path: string, init: { method: string; body?: Uint8Array; cookie?: string }) {
    const headers: Record<string, string> = { origin: "http://localhost:5173" };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body) headers["content-type"] = "image/webp";
    return exports.default.fetch(new Request(`http://localhost:5173${path}`, { method: init.method, headers, body: init.body }));
  }

  it("Ersteller lädt hoch, wer die Umfrage sieht, sieht das Foto; neue Version, neue Adresse", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: order() })).body.id;
    const hat = (await api(`/polls/${id}`, { cookie: coachCookie })).body.options[0].id;
    const up = await raw(`/api/polls/${id}/options/${hat}/image`, { method: "PUT", body: webp(1), cookie: coachCookie });
    expect(up.status).toBe(200);
    const url = ((await up.json()) as any).options[0].imageUrl as string;
    expect(url).toBe(`/api/polls/${id}/options/${hat}/image?v=1`);
    expect((await api(`/polls/${id}`, { cookie: monaCookie })).body.options[0].imageUrl).toBe(url);
    const img = await raw(url, { method: "GET", cookie: monaCookie });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(webp(1));
    // Without the poll or without signing in: nothing
    const stranger = await person("Sina");
    expect((await raw(url, { method: "GET", cookie: await loginAs(stranger) })).status).toBe(404);
    expect((await raw(url, { method: "GET" })).status).toBe(401);
    // A new photo: new version
    const again = await raw(`/api/polls/${id}/options/${hat}/image`, { method: "PUT", body: webp(2), cookie: coachCookie });
    expect(((await again.json()) as any).options[0].imageUrl).toBe(`/api/polls/${id}/options/${hat}/image?v=2`);
    // Remove
    const del = await raw(`/api/polls/${id}/options/${hat}/image`, { method: "DELETE", cookie: coachCookie });
    expect(((await del.json()) as any).options[0].imageUrl).toBeNull();
    expect(await rows("SELECT option_id FROM poll_option_images")).toEqual([]);
  });

  it("nur Ersteller und Admins, nur Bestellungen, nur Bilder, fällt mit der Umfrage weg", async () => {
    const id = (await api("/polls", { cookie: coachCookie, body: order() })).body.id;
    const hat = (await api(`/polls/${id}`, { cookie: coachCookie })).body.options[0].id;
    expect((await raw(`/api/polls/${id}/options/${hat}/image`, { method: "PUT", body: webp(1), cookie: monaCookie })).status).toBe(403);
    expect((await raw(`/api/polls/${id}/options/${hat}/image`, { method: "PUT", body: new TextEncoder().encode("kein Bild"), cookie: coachCookie })).status).toBe(400);
    expect((await raw(`/api/polls/${id}/options/${hat}/image`, { method: "PUT", body: new Uint8Array(300_001), cookie: coachCookie })).status).toBe(413);
    const choice = (await api("/polls", { cookie: coachCookie, body: { teamId: wd, kind: "choice", title: "Wohin?", whoPlayers: true, endsAt: later(), options: [{ label: "A" }, { label: "B" }] } })).body.id;
    const a = (await api(`/polls/${choice}`, { cookie: coachCookie })).body.options[0].id;
    expect((await raw(`/api/polls/${choice}/options/${a}/image`, { method: "PUT", body: webp(1), cookie: coachCookie })).status).toBe(400);
    expect((await raw(`/api/polls/${id}/options/${a}/image`, { method: "PUT", body: webp(1), cookie: coachCookie })).status).toBe(404);
    expect((await raw(`/api/polls/${id}/options/${hat}/image`, { method: "PUT", body: webp(1), cookie: adminCookie })).status).toBe(200);
    expect((await api(`/polls/${id}`, { method: "DELETE", cookie: coachCookie })).status).toBe(200);
    expect(await rows("SELECT option_id FROM poll_option_images")).toEqual([]);
  });
});
