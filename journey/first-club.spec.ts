// A club from zero: the first admin sets up a fresh installation, the wizard (with football, not handball),
// a coach and a second admin with their personal links. All names are invented.
// Runs against an empty local database (npm run journey) or a real installation (KABINE_JOURNEY_URL).
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const SETUP_PASSWORD = process.env.KABINE_JOURNEY_PASSWORD ?? "e2e-einrichtung-0123456789";

interface User {
  context: BrowserContext;
  page: Page;
}

/** A device with a virtual passkey authenticator (Chromium). */
async function newUser(browser: Browser): Promise<User> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { context, page };
}

let admin: User;
let coachLink = "";
let secondAdminLink = "";
let coach: User;
let playerLink = "";
let parentLink = "";
let player: User;
let parent: User;

test("Erster Admin: frische Installation öffnen, Passwort, Name, Passkey", async ({ browser }) => {
  admin = await newUser(browser);
  const { page } = admin;
  await page.goto("/");
  await expect(page).toHaveURL(/\/einrichtung$/);
  await page.getByLabel("Einrichtungspasswort").fill(SETUP_PASSWORD);
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByLabel("Vorname").fill("Vera");
  await page.getByLabel("Nachname").fill("Vorstand");
  await page.getByLabel("E-Mail-Adresse").fill("vera@example.org");
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(page.getByText("Geschafft!")).toBeVisible();
  await page.getByRole("button", { name: "Zur App" }).click();
  await expect(page.getByText(/Einrichtung · Schritt 1 von \d+/)).toBeVisible();
});

test("Assistent: Verein, Fußball, Module, Mannschaft", async () => {
  const { page } = admin;
  const next = () => page.getByRole("button", { name: "Speichern und weiter" }).click();
  // Language and region
  await next();
  // Club
  await expect(page.getByRole("heading", { name: "Dein Verein" })).toBeVisible();
  await page.getByLabel("Name des Vereins").fill("TSV Probedorf 1920");
  await page.getByLabel("Kurzname").fill("TSV Probedorf");
  await next();
  // Sport and season
  await expect(page.getByRole("heading", { name: "Sportart und Saison" })).toBeVisible();
  await page.getByRole("combobox", { name: "Sportart" }).selectOption("football");
  await next();
  // Modules: no handball modules for a football club, every switch stays when switched off
  await expect(page.getByRole("heading", { name: "Funktionen" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /handball4all/ })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: /Jugendschiedsrichter/ })).toHaveCount(0);
  const carpools = page.getByRole("switch", { name: /Fahrgemeinschaften/ });
  await carpools.click();
  await expect(carpools).toHaveAttribute("aria-checked", "false");
  await carpools.click();
  await next();
  // E-mail: not now
  await expect(page.getByRole("heading", { name: "E-Mail", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Überspringen" }).click();
  // First teams: the age groups come from the football profile
  await expect(page.getByRole("heading", { name: "Erste Mannschaften" })).toBeVisible();
  // First the choice: lists, by hand or an export of Kabine
  await page.getByRole("button", { name: "Von Hand eingeben" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E1");
  await page.getByLabel("Altersklasse").selectOption({ label: "E-Jugend (U11) (U11)" });
  await page.getByRole("button", { name: "Mannschaft anlegen" }).click();
  await expect(page.locator(".team-badge", { hasText: "E1" })).toBeVisible();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
});

test("Assistent: erste Personen mit Links, Datenschutz, fertig", async () => {
  const { page } = admin;
  await expect(page.getByRole("heading", { name: "Erste Personen" })).toBeVisible();
  // A coach for E1
  await page.getByLabel("Vorname").fill("Theo");
  await page.getByLabel("Nachname").fill("Torwart");
  await page.getByRole("group", { name: "Trainer von" }).getByRole("button", { name: "E1" }).click();
  await page.getByRole("button", { name: "Person anlegen" }).click();
  const people = page.getByRole("list", { name: "Erste Personen" });
  const theo = people.getByRole("listitem").filter({ hasText: "Theo Torwart" });
  await expect(theo).toContainText("Trainer von E1");
  await theo.getByRole("button", { name: "Persönlichen Link erzeugen" }).click();
  coachLink = await theo.locator(".url-box").innerText();
  // A second admin
  await page.getByLabel("Vorname").fill("Anna");
  await page.getByLabel("Nachname").fill("Andermann");
  await page.getByRole("switch", { name: /Admin/ }).click();
  await page.getByLabel("E-Mail-Adresse").fill("anna@example.org");
  await page.getByRole("button", { name: "Person anlegen" }).click();
  const anna = people.getByRole("listitem").filter({ hasText: "Anna Andermann" });
  await expect(anna).toContainText("Admin");
  await anna.getByRole("button", { name: "Persönlichen Link erzeugen" }).click();
  secondAdminLink = await anna.locator(".url-box").innerText();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  // Privacy, done
  await expect(page.getByRole("heading", { name: "Datenschutz" })).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("heading", { name: "Die App ist eingerichtet" })).toBeVisible();
  // "Set up" only shows once the server has it: opening the app right away must not lead back into the wizard
  // (found on a real installation, where the confirmation arrived after the next page load)
  expect(((await (await page.request.get("/api/club")).json()) as { setupDone: boolean }).setupDone).toBe(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hallo Vera" })).toBeVisible();
});

test("Zweite Admin: Link öffnen, Passkey, Verwaltung sichtbar", async ({ browser }) => {
  const anna = await newUser(browser);
  await anna.page.goto(secondAdminLink);
  await anna.page.getByRole("button", { name: /Passkey einrichten/ }).click();
  await expect(anna.page.getByText("Geschafft!")).toBeVisible();
  await anna.page.getByRole("button", { name: "Zur App" }).click();
  await expect(anna.page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Verwaltung" })).toBeVisible();
  await anna.context.close();
});

test("Trainer: Link öffnen, Mannschaft sehen", async ({ browser }) => {
  coach = await newUser(browser);
  const { page } = coach;
  await page.goto(coachLink);
  await page.getByRole("button", { name: /Passkey einrichten/ }).click();
  await expect(page.getByText("Geschafft!")).toBeVisible();
  await page.getByRole("button", { name: "Zur App" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Theo" })).toBeVisible();
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team E1" })).toBeVisible();
});

test("Trainer: Trainingsplan mit neuem Ort, Trainings entstehen", async () => {
  const { page } = coach;
  await page.getByRole("link", { name: "Trainingspläne" }).click();
  await page.getByRole("button", { name: "Trainingsplan anlegen" }).click();
  // A new club has no training location yet: "create new" is not preselected, so choosing it opens the form
  await expect(page.getByLabel("Ort", { exact: true })).toHaveValue("");
  await page.getByLabel("Ort", { exact: true }).selectOption({ label: "+ Neuen Ort anlegen" });
  const sheet = page.getByRole("dialog", { name: "Neuer Trainingsort" });
  await sheet.getByLabel("Name").fill("Sportplatz Probedorf");
  await sheet.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByLabel("Ort", { exact: true })).toHaveValue(/\d+/);
  await page.getByRole("group", { name: "Wochentag" }).getByRole("button", { name: "Di" }).click();
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await page.getByRole("button", { name: "Plan speichern" }).click();
  await expect(page.getByText(/Plan gespeichert\. \d+ Termine erzeugt\./)).toBeVisible();
  // The plan runs until the end of the football season, not a fixed date
  await expect(page.getByText(/bis 30\.06\.20\d\d/)).toBeVisible();
});

test("Trainer: Spieler aus einer Liste, Einladungslinks", async () => {
  const { page } = coach;
  await page.goto("/team");
  await page.getByRole("button", { name: "Kader", exact: true }).click();
  const roster = page.getByRole("region", { name: "Spielerinnen und Spieler" });
  await roster.getByRole("button", { name: "Hinzufügen" }).click();
  const sheet = page.getByRole("dialog", { name: "Spieler hinzufügen" });
  await sheet.getByRole("button", { name: "Aus einer Liste" }).click();
  await sheet.getByLabel("Spielerliste").fill("Vorname\tNachname\tJahrgang\nMila\tMeyer\t2016\nJonas\tJäger\t2016");
  await sheet.getByRole("button", { name: "Vorschau" }).click();
  await sheet.getByRole("button", { name: "2 Spieler anlegen" }).click();
  await expect(page.getByText("2 Spieler angelegt")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(roster).toContainText("Mila Meyer");
  await page.getByRole("button", { name: "Einladungen" }).click();
  await page.getByRole("region", { name: "Spielerlink" }).getByRole("button", { name: /Link erzeugen/ }).click();
  playerLink = await page.getByRole("region", { name: "Spielerlink" }).locator(".url-box").innerText();
  await page.getByRole("region", { name: "Elternlink" }).getByRole("button", { name: /Link erzeugen/ }).click();
  parentLink = await page.getByRole("region", { name: "Elternlink" }).locator(".url-box").innerText();
  expect(playerLink).toContain("/einladung#");
  expect(parentLink).toContain("/einladung#");
});

test("Spieler: Zugang über den Spielerlink, nächstes Training", async ({ browser }) => {
  player = await newUser(browser);
  const { page } = player;
  await page.goto(playerLink);
  await page.getByRole("radio", { name: /Jonas J\./ }).click();
  await page.getByRole("button", { name: /Ich bin Jonas/ }).click();
  await expect(page.getByText("Geschafft!")).toBeVisible();
  await page.getByRole("button", { name: "Zur App" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Jonas" })).toBeVisible();
  await expect(page.getByText("Training").first()).toBeVisible();
});

test("Eltern: Zugang über den Elternlink, Absage für das Kind, Trainer sieht den Grund", async ({ browser }) => {
  parent = await newUser(browser);
  const { page } = parent;
  await page.goto(parentLink);
  await page.getByLabel("Dein Vorname").fill("Petra");
  await page.getByLabel("Dein Nachname").fill("Meyer");
  await page.getByRole("checkbox", { name: /Mila M\./ }).click();
  await page.getByRole("button", { name: /Passkey einrichten/ }).click();
  await expect(page.getByText("Geschafft!")).toBeVisible();
  await page.getByRole("button", { name: "Zur App" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Petra" })).toBeVisible();
  await page.getByRole("button", { name: "Absagen" }).first().click();
  await page.getByRole("button", { name: "Krank" }).click();
  await page.getByRole("button", { name: /Absage senden|Kurzfristig absagen/ }).click();
  await expect(page.getByText(/„Krank“/).first()).toBeVisible();

  await coach.page.goto("/");
  await coach.page.getByRole("link", { name: "Details und Erinnern" }).first().click();
  await expect(coach.page.getByText("„Krank“")).toBeVisible();
  await expect(coach.page.getByText("Mila M.").first()).toBeVisible();
});

test("Trainer: Helferplan an, Heimspiel anlegen, Fußball-Dienste, Mutter übernimmt Kuchen", async () => {
  const { page } = coach;
  await page.goto("/team");
  await page.getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("switch", { name: /Helferplan für diese Mannschaft/ }).click();
  await expect(page.getByText("Helferplan eingeschaltet.")).toBeVisible();
  await page.getByRole("link", { name: "Termin anlegen" }).click();
  await page.getByRole("group", { name: "Art des Termins" }).getByRole("button", { name: "Spiel" }).click();
  await page.getByLabel("Gegner oder Turnier").fill("SV Nachbarort");
  // Football is played on a pitch, not in a hall
  await expect(page.getByLabel("Platz (optional)")).toBeVisible();
  const date = new Date(Date.now() + 9 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  await page.getByLabel("Datum").fill(date);
  await page.getByLabel("Spielbeginn").fill("11:00");
  await page.getByRole("button", { name: "Spiel anlegen" }).click();
  await expect(page).toHaveURL(/\/termine\/\d+/);

  // Football home template: two cake & kiosk slots and washing shirts
  await parent.page.goto("/helfer");
  const card = parent.page.getByRole("article", { name: /SV Nachbarort/ });
  await expect(card).toContainText("3 frei");
  await card.locator(".duty-slot", { hasText: "Kuchen & Theke" }).getByRole("button", { name: "Eintragen" }).first().click();
  const signup = parent.page.getByRole("dialog", { name: "Kuchen & Theke" });
  await signup.getByLabel(/Was bringst du mit/).fill("Apfelkuchen");
  await signup.getByRole("button", { name: "Eintragen" }).click();
  await expect(card).toContainText("„Apfelkuchen“");
  await expect(card).toContainText("2 frei");
});

test("Auswärtsspiel: Mutter fährt, Spieler bucht einen Platz", async () => {
  const session = (await (await coach.page.request.get("/api/session")).json()) as { me: { manageableTeams: { id: number }[] } };
  const teamId = session.me.manageableTeams[0]!.id;
  const date = new Date(Date.now() + 16 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const res = await coach.page.request.post(`/api/duties/teams/${teamId}/games`, { data: { opponent: "FC Weitweg", isHome: false, date, time: "13:00" } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  const team = (await (await coach.page.request.get(`/api/teams/${teamId}`)).json()) as { players: { person: { id: number } }[] };
  const ids = team.players.map((p) => p.person.id);
  expect((await coach.page.request.put(`/api/events/${id}/squad`, { data: { personIds: ids } })).ok()).toBe(true);

  await parent.page.goto(`/termine/${id}`);
  const parentCard = parent.page.getByRole("region", { name: "Fahrgemeinschaften" });
  await parentCard.getByRole("button", { name: "Ich fahre" }).click();
  await parent.page.getByRole("button", { name: "Plätze anbieten" }).click();
  await expect(parentCard.getByText(/0 von \d+ Pl/)).toBeVisible();

  await player.page.goto(`/termine/${id}`);
  const card = player.page.getByRole("region", { name: "Fahrgemeinschaften" });
  await card.getByRole("button", { name: "Ich brauche eine Mitfahrgelegenheit" }).click();
  await player.page.getByRole("dialog").getByRole("button", { name: "Mitfahren" }).click();
  await expect(card.getByText(/fährst bei Petra M\. mit/)).toBeVisible();
});

test("Chat: Trainer schreibt, Spieler und Mutter lesen", async () => {
  const session = (await (await coach.page.request.get("/api/session")).json()) as { me: { manageableTeams: { id: number }[] } };
  const room = `/chat/${session.me.manageableTeams[0]!.id}`;
  await coach.page.goto(room);
  await coach.page.getByPlaceholder("Nachricht an E1").fill("Samstag 10 Uhr Treffpunkt am Platz");
  await coach.page.getByRole("button", { name: "Senden" }).click();
  for (const reader of [player, parent]) {
    await reader.page.goto(room);
    await expect(reader.page.getByText("Samstag 10 Uhr Treffpunkt am Platz")).toBeVisible();
  }
});

/** Opens each page and collects what went wrong: script errors, failed requests, error boxes. */
async function visitAll(page: Page, paths: string[]): Promise<string[]> {
  const problems: string[] = [];
  let current = "";
  const onError = (err: Error) => problems.push(`${current}: ${err.message}`);
  const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
    if (msg.type() === "error") problems.push(`${current}: console: ${msg.text()}`);
  };
  const onResponse = (res: import("@playwright/test").Response) => {
    if (res.url().includes("/api/") && res.status() >= 400) problems.push(`${current}: ${res.status()} ${new URL(res.url()).pathname}`);
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  page.on("response", onResponse);
  for (const path of paths) {
    current = path;
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    for (const text of await page.getByRole("alert").allInnerTexts()) if (text.trim()) problems.push(`${path}: alert: ${text.trim()}`);
  }
  page.off("pageerror", onError);
  page.off("console", onConsole);
  page.off("response", onResponse);
  return problems;
}

test("Jede Seite lädt ohne Fehler: Admin, Trainer, Spieler und Eltern", async () => {
  const session = (await (await coach.page.request.get("/api/session")).json()) as { me: { manageableTeams: { id: number }[] } };
  const teamId = session.me.manageableTeams[0]!.id;
  const common = ["/", "/chat", "/profil", "/profil/benachrichtigungen", "/profil/geraete", "/hilfe", "/datenschutz", "/helfer"];
  await admin.page.goto("/verwaltung");
  await expect(admin.page.getByText("Vereinsplätze und weitere Orte")).toBeVisible();
  const adminProblems = await visitAll(admin.page, [
    ...common,
    "/team",
    `/team/${teamId}`,
    "/verwaltung",
    "/verwaltung/personen",
    "/verwaltung/mannschaften",
    "/verwaltung/gruppen",
    "/verwaltung/ferien",
    "/verwaltung/altersklassen",
    "/verwaltung/orte",
    "/verwaltung/verein",
    "/verwaltung/mail",
    "/verwaltung/saisonwechsel",
    "/verwaltung/sondertermine",
    "/verwaltung/rundnachricht",
    "/verwaltung/termin-neu",
    "/verwaltung/helferdienste",
  ]);
  const coachProblems = await visitAll(coach.page, [...common, "/team", `/team/${teamId}`, `/team/${teamId}/plaene`, `/team/${teamId}/termin-neu`]);
  const playerProblems = await visitAll(player.page, common);
  const parentProblems = await visitAll(parent.page, common);
  expect([
    ...adminProblems.map((p) => `Admin ${p}`),
    ...coachProblems.map((p) => `Trainer ${p}`),
    ...playerProblems.map((p) => `Spieler ${p}`),
    ...parentProblems.map((p) => `Eltern ${p}`),
  ]).toEqual([]);
});
