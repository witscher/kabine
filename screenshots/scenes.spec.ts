// Screenshots of the invented demo club "SV Musterstadt" for the README, in the language of the
// run (KABINE_SHOTS_LOCALE). The scenes are set up through the app's API, like real use: games,
// responses, squad, helper duties, carpool, chat. Output: docs/screenshots/<locale>/*.png
import { type APIRequestContext, type Browser, type BrowserContext, type Page, expect, request, test } from "@playwright/test";

const BASE = "http://localhost:4174";
const locale = process.env.KABINE_SHOTS_LOCALE === "en" ? "en" : "de";
const OUT = `docs/screenshots/${locale}`;
const token = (personId: number) => `shots-${personId}-0123456789abcdef0123456789abcdef`;

// People of seed/demo.sql (all invented); the admin comes from scripts/screenshots-reset.mjs
const ADMIN = 100;
const CLARA = 101; // coach wD
const LEA = 202;
const MIA = 201; // child of Petra
const PETRA = 501;
const WD_PLAYERS = [201, 202, 203, 204, 205, 206, 207, 208];

const TEXT = {
  de: {
    reasonSick: "Erkältet",
    reasonTrip: "Klassenfahrt",
    home: "HSG Nachbarort",
    away: "TSV Weitweg",
    cake: "Apfelkuchen",
    chat: [
      [CLARA, "Am Samstag treffen wir uns um 13:15 Uhr an der Halle. Bitte an die Trikots denken!"],
      [PETRA, "Mia ist dabei. Ich kann zwei Kinder mitnehmen."],
      [LEA, "Ich bringe die Bälle mit 🙂"],
    ],
  },
  en: {
    reasonSick: "Got a cold",
    reasonTrip: "School trip",
    home: "HSG Nachbarort",
    away: "TSV Weitweg",
    cake: "Apple pie",
    chat: [
      [CLARA, "On Saturday we meet at the hall at 1:15 pm. Please remember your shirts!"],
      [PETRA, "Mia is in. I can take two more kids."],
      [LEA, "I'll bring the balls 🙂"],
    ],
  },
}[locale];

async function apiAs(personId: number): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { cookie: `__Host-kabine_session=${token(personId)}`, origin: BASE, "x-kabine-locale": locale },
  });
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function pageAs(browser: Browser, personId: number | null): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  // Hints that every new device shows once stay out of the pictures
  await context.addInitScript(() => {
    for (const key of ["kabine-hint-install", "kabine-hint-push", "kabine-hint-first-steps"]) localStorage.setItem(key, "1");
  });
  const page = await context.newPage();
  if (personId != null) {
    // Set from the page itself: from outside, a Secure cookie cannot be set for http://localhost
    await page.goto("/api/health");
    await page.evaluate((value) => {
      document.cookie = `__Host-kabine_session=${value}; Path=/; Secure; SameSite=Lax`;
    }, token(personId));
  }
  return { context, page };
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

let homeGame = 0;
let awayGame = 0;
let training = 0;

test.beforeAll(async () => {
  const clara = await apiAs(CLARA);
  // Next training of the wD (generated from the training plan)
  const { events } = await json<{ events: { id: number; kind: string; teams: { id: number }[] }[] }>(await clara.get("/api/events?limit=20"));
  training = events.find((e) => e.kind === "training" && e.teams.some((t) => t.id === 1))!.id;

  homeGame = (await json<{ id: number }>(await clara.post("/api/duties/teams/1/games", { data: { opponent: TEXT.home, isHome: true, date: day(5), time: "14:00" } }))).id;
  awayGame = (await json<{ id: number }>(await clara.post("/api/duties/teams/1/games", { data: { opponent: TEXT.away, isHome: false, date: day(12), time: "15:30" } }))).id;
  for (const game of [homeGame, awayGame]) await json(await clara.put(`/api/events/${game}/squad`, { data: { personIds: WD_PLAYERS.slice(0, 7) } }));

  // Responses to the training: most accept, two decline with a reason, one is still open
  for (const pid of [202, 203, 204, 205]) {
    const me = await apiAs(pid);
    await json(await me.post(`/api/events/${training}/responses`, { data: { personId: pid, status: "yes" } }));
  }
  await json(await (await apiAs(206)).post(`/api/events/${training}/responses`, { data: { personId: 206, status: "no", reason: TEXT.reasonSick } }));
  await json(await (await apiAs(207)).post(`/api/events/${training}/responses`, { data: { personId: 207, status: "no", reason: TEXT.reasonTrip } }));
  const petra = await apiAs(PETRA);
  await json(await petra.post(`/api/events/${training}/responses`, { data: { personId: MIA, status: "yes" } }));

  // Helper duties of the home game: two parents sign up
  const plan = await json<{ games: { id: number; blocks: { id: number; noteAllowed: boolean }[] }[] }>(await petra.get("/api/duties?teamId=1"));
  const blocks = plan.games.find((g) => g.id === homeGame)!.blocks;
  const cake = blocks.find((b) => b.noteAllowed)!;
  await json(await petra.post("/api/duties", { data: { blockId: cake.id, childId: MIA, note: TEXT.cake } }));

  // Carpool to the away game: Petra drives, Lea books a seat, Emma is still looking
  await json(await petra.put(`/api/events/${awayGame}/carpool/offers/${PETRA}`, { data: { seats: 3 } }));
  const lea = await apiAs(LEA);
  await json(await lea.put(`/api/events/${awayGame}/carpool/requests/${LEA}`, { data: { companions: 0 } }));
  const detail = await json<{ modules: { carpools: { offers: { id: number }[] } } }>(await lea.get(`/api/events/${awayGame}`));
  await json(await lea.put(`/api/events/${awayGame}/carpool/requests/${LEA}/booking`, { data: { offerId: detail.modules.carpools.offers[0]!.id } }));
  const emma = await apiAs(203);
  await json(await emma.put(`/api/events/${awayGame}/carpool/requests/203`, { data: { companions: 0 } }));
});

test("Screenshots", async ({ browser }) => {
  // Chat: messages typed in the app, the parent reads them
  for (const [pid, text] of TEXT.chat as [number, string][]) {
    const { context, page } = await pageAs(browser, pid);
    await page.goto("/chat/1");
    const box = page.locator("textarea");
    await box.fill(text);
    await page.getByRole("button", { name: locale === "en" ? "Send" : "Senden" }).click();
    await expect(page.locator(".msg:not(.pending)", { hasText: text.slice(0, 20) })).toBeVisible();
    await context.close();
  }

  const lea = await pageAs(browser, LEA);
  await lea.page.goto("/");
  await expect(lea.page.locator(".hero h1")).toBeVisible();
  await shot(lea.page, "01-events");
  await lea.page.goto("/chat/1");
  await expect(lea.page.locator(".msg").nth(2)).toBeVisible();
  await shot(lea.page, "05-chat");
  await lea.page.goto(`/termine/${awayGame}`);
  const carpool = lea.page.locator("section", { has: lea.page.locator(".section-title, h2", { hasText: locale === "en" ? /carpool/i : /Fahrgemeinschaft/i }) }).last();
  await carpool.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(lea.page, "06-carpool");
  await lea.context.close();

  const petra = await pageAs(browser, PETRA);
  await petra.page.goto(`/termine/${training}`);
  await shot(petra.page, "02-respond-for-child");
  await petra.page.goto("/helfer");
  await expect(petra.page.locator(".duty-slot").first()).toBeVisible();
  await shot(petra.page, "07-helper-duties");
  await petra.context.close();

  const clara = await pageAs(browser, CLARA);
  await clara.page.goto(`/termine/${training}`);
  await shot(clara.page, "03-coach-responses");
  await clara.page.goto(`/spiele/${homeGame}/kader`);
  await shot(clara.page, "04-squad");
  await clara.page.goto("/team/1");
  await shot(clara.page, "08-team");
  await clara.context.close();

  const admin = await pageAs(browser, ADMIN);
  await admin.page.goto("/verwaltung");
  await shot(admin.page, "09-administration");
  await admin.page.evaluate(() => sessionStorage.setItem("kabine.setup.step", "2"));
  await admin.page.goto("/verwaltung/einrichtung");
  await expect(admin.page.locator("select").first()).toBeVisible();
  await shot(admin.page, "10-setup-wizard");
  await admin.context.close();

  const guest = await pageAs(browser, null);
  await guest.page.goto("/");
  await shot(guest.page, "00-sign-in");
  await guest.context.close();
});
