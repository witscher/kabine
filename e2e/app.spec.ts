// Ende-zu-Ende-Durchlauf mit echten Passkeys (virtueller Authenticator von
// Chromium). Alle Namen stammen aus e2e/fixtures.sql und sind erfunden.
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { activeMotd, MOTD } from "../shared/motd";

test.describe.configure({ mode: "serial" });

interface User {
  context: BrowserContext;
  page: Page;
}

async function newUser(browser: import("@playwright/test").Browser): Promise<User> {
  const context = await browser.newContext();
  // The one-time push prompt only in its own test
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-push")) localStorage.setItem("kabine-push-asked", "1");
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { context, page };
}

/**
 * Ein zweiter App-Server für den Offline-Test. Ihn zu beenden ist für den
 * Service Worker ein echtes Funkloch (context.setOffline() wirkt auf ihn nicht).
 */
async function startPreview(port: number, copyState = true): Promise<ChildProcess> {
  // Eigene Kopie des Testdatenbestands: Zwei lokale Laufzeiten auf denselben
  // Dateien sperren sich gegenseitig (SQLITE_BUSY). Anmeldung und Chat sind mitkopiert.
  const state = ".wrangler/e2e-state-offline";
  if (copyState) {
    rmSync(state, { recursive: true, force: true });
    cpSync(".wrangler/e2e-state", state, { recursive: true });
  }
  const proc = spawn("npx", ["vite", "preview", "--port", String(port)], {
    env: { ...process.env, KABINE_E2E: "1", KABINE_E2E_STATE: state },
    detached: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/health`)).ok) return proc;
    } catch {
      // startet noch
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Zweiter App-Server startet nicht");
}

async function stopPreview(proc: ChildProcess, port: number) {
  try {
    if (proc.pid) process.kill(-proc.pid, "SIGTERM");
  } catch {
    // schon beendet
  }
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://localhost:${port}/api/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

let admin: User;
let coach: User;
let player: User;
let playerLink = "";

test.afterAll(async () => {
  for (const u of [admin, coach, player]) await u?.context.close();
});

test("Admin richtet den Zugang über den Einrichtungslink ein", async ({ browser }) => {
  admin = await newUser(browser);
  const { page } = admin;
  // Fresh installation: opening the app leads to the setup, which asks for the password chosen when deploying
  await page.goto("/");
  await expect(page).toHaveURL(/\/einrichtung$/);
  await page.getByLabel("Einrichtungspasswort").fill("falsches-passwort-123456");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByText(/Dieses Einrichtungspasswort stimmt nicht/)).toBeVisible();
  await page.getByLabel("Einrichtungspasswort").fill("e2e-einrichtung-0123456789");
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByLabel("Vorname").fill("Ada");
  await page.getByLabel("Nachname").fill("Admin");
  await page.getByLabel("E-Mail-Adresse").fill("admin@example.org");
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(page.getByText("Geschafft!")).toBeVisible();
  await page.getByRole("button", { name: "Zur App" }).click();
  // Bis die Einrichtung abgeschlossen ist, öffnet sich für Admins der Assistent
  await expect(page.getByText("Einrichtung · Schritt 1 von 9")).toBeVisible();
  await page.getByRole("button", { name: "Später weitermachen" }).click();
  await expect(page.getByText("Einrichtung nicht abgeschlossen")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hallo Ada" })).toBeVisible();

  // Der Einrichtungslink gilt nur einmal
  const again = await page.request.post("/api/bootstrap/info", { data: { token: "e2e-einrichtung-0123456789" } });
  expect(again.status()).toBe(410);
});

test("Admin legt einen Sondertermin für eine Mannschaft an", async () => {
  const { page } = admin;
  await page.goto("/verwaltung/termin-neu");
  await page.getByLabel("Titel").fill("Fotoshooting");
  const chip = page.getByRole("group", { name: "Mannschaften" }).getByRole("button", { name: "wT" });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Termin anlegen" }).click();
  await expect(page.getByText("Fotoshooting").first()).toBeVisible();
  await expect(page).toHaveURL(/\/termine\/\d+/);
});

test("Trainer bekommt einen persönlichen Link vom Admin", async ({ browser }) => {
  const { page } = admin;
  await page.goto("/verwaltung/personen");
  await page.getByRole("button", { name: /Theo Trainer/ }).click();
  await page.getByRole("button", { name: "Persönlichen Link erzeugen" }).click();
  const link = await page.locator(".url-box").innerText();

  coach = await newUser(browser);
  await coach.page.goto(link);
  await coach.page.getByLabel("Deine E-Mail-Adresse").fill("theo@example.org");
  await coach.page.getByRole("button", { name: "Passkey einrichten (empfohlen)" }).click();
  await expect(coach.page.getByText("Geschafft!")).toBeVisible();
  await coach.page.getByRole("button", { name: "Zur App" }).click();
  await expect(coach.page.getByRole("heading", { name: "Hallo Theo" })).toBeVisible();
  await expect(coach.page.getByRole("link", { name: "Team" })).toBeVisible();
});

test("Spielerin richtet ihren Zugang über den Spielerlink ein", async ({ browser }) => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("button", { name: "Einladungen" }).click();
  await page.getByRole("button", { name: "Link erzeugen" }).first().click();
  playerLink = await page.locator(".url-box").first().innerText();
  expect(playerLink).toContain("/einladung#");

  player = await newUser(browser);
  await player.page.goto(playerLink);
  await expect(player.page.getByText("Wer bist du?")).toBeVisible();
  await player.page.getByRole("radio", { name: /Ida P\./ }).click();
  // Die E-Mail-Adresse ist optional: Ida richtet nur einen Passkey ein
  await expect(player.page.getByLabel("Deine E-Mail-Adresse (optional)")).toBeVisible();
  await player.page.getByRole("button", { name: /Ich bin Ida/ }).click();
  await expect(player.page.getByText("Geschafft!")).toBeVisible();
  await player.page.getByRole("button", { name: "Zur App" }).click();
  await expect(player.page.getByRole("heading", { name: "Hallo Ida" })).toBeVisible();

  // Ida ist danach im Spielerlink als vergeben markiert
  const other = await newUser(browser);
  await other.page.goto(playerLink);
  await expect(other.page.getByRole("radio", { name: /Ida P\./ })).toBeDisabled();
  await other.context.close();
});

test("Absage mit Begründung erscheint nur beim Trainer", async () => {
  const { page } = player;
  await page.goto("/");
  await page.getByRole("button", { name: "Absagen" }).first().click();
  await page.getByRole("button", { name: "Schule" }).click();
  await page.getByRole("button", { name: /Absage senden|Kurzfristig absagen/ }).click();
  await expect(page.getByText("Dein Grund: „Schule“").first()).toBeVisible();

  await coach.page.goto("/");
  await coach.page.getByRole("link", { name: "Details und Erinnern" }).click();
  await expect(coach.page.getByText("„Schule“")).toBeVisible();
  await expect(coach.page.getByText("Ida P.").first()).toBeVisible();

  // Die API liefert anderen Spielern keine Namen und Begründungen
  const events = await page.request.get("/api/events");
  const firstId = (await events.json()).events[0].id as number;
  const detail = await (await page.request.get(`/api/events/${firstId}`)).json();
  expect(detail.participants).toBeNull();
});

test("Trainer sagt für eine Spielerin ab und wieder zu", async () => {
  const { page } = coach;
  await page.goto("/");
  await page.getByRole("link", { name: "Details und Erinnern" }).click();
  await page.getByRole("button", { name: /Jana P\./ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Jana Probe" });
  await sheet.getByRole("button", { name: "Diesen Termin absagen" }).click();
  await sheet.getByRole("button", { name: "Krank" }).click();
  await sheet.getByRole("button", { name: "Absage eintragen" }).click();
  await expect(page.getByText("Absage für Jana eingetragen.")).toBeVisible();
  await expect(page.getByText("„Krank“")).toBeVisible();

  await page.getByRole("button", { name: /Jana P\./ }).first().click();
  await page.getByRole("dialog", { name: "Jana Probe" }).getByRole("button", { name: "Wieder zusagen" }).click();
  await expect(page.getByText("Jana ist wieder zugesagt.")).toBeVisible();
  await expect(page.getByText("„Krank“")).toHaveCount(0);
});

test("Training absagen fragt nach, ob es für alle ausfällt", async () => {
  const { page } = coach;
  await page.goto("/");
  await page.getByRole("link", { name: "Details und Erinnern" }).click();
  await page.getByRole("button", { name: "Absagen", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Training absagen" });
  await sheet.getByRole("button", { name: "Trainer verhindert" }).click();
  await sheet.getByRole("button", { name: "Absagen und informieren" }).click();
  const confirm = page.getByRole("dialog", { name: "Trainingstermin komplett für alle absagen?" });
  await expect(confirm.getByText("Wenn nur du verhindert bist, nimm stattdessen „Ich bin nicht da“.", { exact: false })).toBeVisible();
  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Abgesagt. Alle wurden informiert.")).toHaveCount(0);
  await expect(sheet).toBeVisible();
});

test("Chat zwischen Trainer und Spielerin in Echtzeit", async () => {
  await coach.page.goto("/chat");
  await player.page.goto("/chat");
  await coach.page.getByPlaceholder("Nachricht an wT").fill("Bitte Trinkflasche mitbringen");
  await coach.page.getByRole("button", { name: "Senden" }).click();
  await expect(player.page.getByText("Bitte Trinkflasche mitbringen")).toBeVisible();
  await player.page.getByPlaceholder("Nachricht an wT").fill("Mach ich!");
  await player.page.getByRole("button", { name: "Senden" }).click();
  await expect(coach.page.getByText("Mach ich!")).toBeVisible();

  // @-Erwähnung: Vorschlag antippen, beim Trainer hervorgehoben
  await player.page.getByPlaceholder("Nachricht an wT").pressSequentially("Danke @The");
  await player.page.getByRole("option", { name: "Theo T." }).click();
  await player.page.getByPlaceholder("Nachricht an wT").pressSequentially("bis morgen");
  await player.page.getByRole("button", { name: "Senden" }).click();
  const mention = coach.page.locator(".msg.mentioned").filter({ hasText: "bis morgen" });
  await expect(mention).toBeVisible();
  await expect(mention.locator(".mention")).toHaveText("@Theo T.");

  // @alle gibt es nur für Trainer und Admins
  await player.page.getByPlaceholder("Nachricht an wT").pressSequentially("@al");
  await expect(player.page.getByRole("option", { name: /alle/ })).toHaveCount(0);
  await player.page.getByPlaceholder("Nachricht an wT").fill("");
  await coach.page.getByPlaceholder("Nachricht an wT").pressSequentially("@al");
  await coach.page.getByRole("option", { name: /alle im Chat benachrichtigen/ }).click();
  await coach.page.getByPlaceholder("Nachricht an wT").pressSequentially("Treffpunkt 9 Uhr");
  await coach.page.getByRole("button", { name: "Senden" }).click();
  const toAll = player.page.locator(".msg.mentioned").filter({ hasText: "Treffpunkt 9 Uhr" });
  await expect(toAll).toBeVisible();
  await expect(toAll.locator(".mention")).toHaveText("@alle");

  // Reaktion: rechts neben fremden Nachrichten, nicht bei eigenen
  await expect(player.page.locator(".msg.mine").filter({ hasText: "Mach ich!" }).locator(".react-btn")).toHaveCount(0);
  await player.page.getByRole("button", { name: "Auf Nachricht von Theo T. reagieren" }).first().click();
  await player.page.getByRole("group", { name: "Reaktion wählen" }).getByRole("button", { name: "Daumen hoch" }).click();
  const reacted = coach.page.locator(".msg").filter({ hasText: "Bitte Trinkflasche mitbringen" }).locator(".reactions");
  await expect(reacted).toContainText("👍");
  await reacted.click();
  await expect(coach.page.getByRole("dialog", { name: "Reaktionen" })).toContainText("Ida P.");
  await coach.page.getByRole("dialog", { name: "Reaktionen" }).getByRole("button", { name: "Schließen" }).click();
});

test("Offline: zuletzt geladener Stand bleibt sichtbar, online wird aktualisiert", async () => {
  const port = 4175;
  const base = `http://localhost:${port}`;
  let server = await startPreview(port);
  // Gleiche Anmeldung (Cookies gelten unabhängig vom Port), eigener Service Worker
  const page = await player.context.newPage();
  try {
    await page.goto(`${base}/`);
    await page.evaluate("navigator.serviceWorker.ready");
    // Ab jetzt läuft alles über den Service Worker: einmal online laden
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hallo Ida" })).toBeVisible();
    await page.goto(`${base}/chat/1`);
    await expect(page.getByText("Bitte Trinkflasche mitbringen")).toBeVisible();
    await page.goto(`${base}/`);
    await expect(page.getByRole("heading", { name: "Hallo Ida" })).toBeVisible();
    // Warten, bis der Service Worker alle App-Dateien vorab gespeichert hat
    await expect
      .poll(
        () =>
          page.evaluate(
            "(async () => { const info = await (await fetch('/version.json')).json(); const c = await caches.open('kabine-shell-v1'); const hits = await Promise.all(info.assets.map((a) => c.match('/' + a, { ignoreVary: true }))); return hits.every(Boolean); })()",
          ),
        { timeout: 20_000 },
      )
      .toBe(true);

    await stopPreview(server, port);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hallo Ida" })).toBeVisible();
    await expect(page.getByText("Du bist gerade offline.")).toBeVisible();
    await expect(page.getByText("Training · 23:30").first()).toBeVisible();
    // Bei nur einer Mannschaft öffnet "Chat" direkt den Mannschaftschat
    await page.getByRole("link", { name: "Chat" }).click();
    await expect(page.getByText("Bitte Trinkflasche mitbringen")).toBeVisible();
    // Eine nie geöffnete Seite kommt aus dem Vorab-Speicher
    await page.getByRole("link", { name: "Zurück zur Chatliste" }).click();
    await page.getByRole("link", { name: "Profil" }).click();
    await expect(page.getByRole("heading", { name: "Ida Probe" })).toBeVisible();

    // Netz wieder da: Hinweis verschwindet, Daten werden neu geladen
    server = await startPreview(port, false);
    await expect(page.getByText("Du bist gerade offline.")).toBeHidden({ timeout: 30_000 });
  } finally {
    await page.close();
    await stopPreview(server, port);
  }
});

test("Profilbild hochladen, zuschneiden und im Chat sehen", async () => {
  const { page } = coach;
  await page.goto("/profil");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[type="file"]:not([capture])').setInputFiles({ name: "theo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("heading", { name: "Bild zuschneiden" })).toBeVisible();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByText("Profilbild gespeichert.")).toBeVisible();
  await expect(page.getByText("Sichtbar für alle, die in der App angemeldet sind.")).toBeVisible();

  // Die Spielerin sieht das Bild beim Trainer im Chat
  await player.page.goto("/chat");
  await expect(player.page.locator(".avatar img").first()).toBeVisible();

  // Minderjährige ohne verknüpfte Eltern können kein Bild hochladen
  await player.page.goto("/profil");
  await expect(player.page.getByText(/Mit deinem Zugang ist aber noch kein Elternteil verknüpft/)).toBeVisible();
  await expect(player.page.getByRole("button", { name: "Foto machen" })).toHaveCount(0);
});

test("Neue Version: Hinweis und Neuladen statt hängender App", async ({ browser }) => {
  // Eigener Kontext ohne Service Worker, damit die Routen unten greifen
  const context = await browser.newContext({ serviceWorkers: "block", storageState: await coach.context.storageState() });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hallo Theo" })).toBeVisible();

  // Deployment nachstellen: neue Versionskennung, Dateien der alten Version fehlen
  await page.route("**/version.json", (r) => r.fulfill({ json: { version: "neu" } }));
  await page.route(/\/assets\/profile-.*\.js$/, (r) => r.fulfill({ status: 404, body: "" }));

  // Der Wechsel auf eine nachgeladene Seite lädt die App neu, statt zu hängen
  const reloaded = page.waitForEvent("load");
  await page.getByRole("link", { name: "Profil" }).click();
  await reloaded;
  await page.unroute(/\/assets\/profile-.*\.js$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Theo Trainer" })).toBeVisible();

  // In der laufenden App erscheint der Hinweis, sobald die neue Version erkannt wird
  await page.evaluate("document.dispatchEvent(new Event(\"visibilitychange\"))");
  await expect(page.getByText("Es gibt eine neue Version der App.")).toBeVisible();
  await context.close();
});

test("Abmelden und mit dem Passkey wieder anmelden", async () => {
  const { page } = player;
  await page.goto("/profil");
  await page.getByRole("button", { name: "Abmelden" }).click();
  const prepared = page.waitForResponse((r) => r.url().endsWith("/api/auth/login/options"));
  await page.getByRole("dialog").getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // iOS startet den Passkey-Dialog nur direkt aus dem Tippen heraus. Die
  // Optionen müssen deshalb vorher bereitliegen, nach dem Tippen keine Anfrage.
  await prepared;
  const optionRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/auth/login/options")) optionRequests.push(r.url());
  });
  await page.getByRole("button", { name: "Mit Passkey anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Ida" })).toBeVisible();
  expect(optionRequests).toEqual([]);
});

test("Abgesagter Termin: „Findet nicht statt“ in Übersicht und Detail, Datum durchgestrichen", async () => {
  const day = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const res = await coach.page.request.post("/api/events", { data: { title: "Teamabend", startsAt: `${day}T19:00`, teamIds: [1] } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  const { page } = coach;
  await page.goto(`/termine/${id}`);
  await page.getByRole("button", { name: "Absagen", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Termin absagen" });
  await sheet.getByLabel("Grund").fill("Raum belegt");
  await sheet.getByRole("button", { name: "Absagen und informieren" }).click();
  await page.getByRole("dialog", { name: /für alle absagen/ }).getByRole("button", { name: "Für alle absagen" }).click();
  await expect(page.getByText("Findet nicht statt (abgesagt durch Theo).")).toBeVisible();
  await expect(page.locator("header.hero h1")).toHaveCSS("text-decoration-line", "line-through");
  await page.goto("/");
  await expect(page.locator(".event-row", { hasText: "Teamabend" })).toContainText("Findet nicht statt");
  await page.goto(`/termine/${id}`);
  await page.getByRole("button", { name: "Absage zurücknehmen" }).click();
  await expect(page.getByText("Findet nicht statt", { exact: false })).toHaveCount(0);
});

test("Admin ordnet eine Person einer Mannschaft zu und entfernt sie wieder", async () => {
  const { page } = admin;
  const created = await page.request.post("/api/admin/persons", { data: { firstName: "Lea", lastName: "Neu", birthYear: 2015 } });
  expect(created.ok()).toBe(true);
  await page.goto("/verwaltung/personen");
  // Ohne Mannschaft steht der Jahrgang in der Liste
  await expect(page.getByRole("button", { name: /Lea Neu/ })).toContainText("Jg. 2015");
  await page.getByRole("button", { name: /Lea Neu/ }).click();
  const sheet = page.getByRole("dialog", { name: "Lea Neu" });
  await expect(sheet.getByText("Noch keiner Mannschaft zugeordnet.")).toBeVisible();
  await sheet.getByLabel("Mannschaft").selectOption({ label: "wT" });
  await sheet.getByRole("button", { name: "Als Spieler zuordnen" }).click();
  await expect(page.getByText("Lea ist jetzt Spieler in wT.")).toBeVisible();
  await expect(sheet.locator(".list-row", { hasText: "wT" })).toContainText("Spieler");

  await sheet.locator(".list-row", { hasText: "wT" }).getByRole("button", { name: "Entfernen" }).click();
  await page.getByRole("dialog", { name: "Aus wT entfernen?" }).getByRole("button", { name: "Entfernen" }).click();
  await expect(sheet.getByText("Noch keiner Mannschaft zugeordnet.")).toBeVisible();

  // Angaben korrigieren: Schreibfehler im Nachnamen, Jahrgang ergänzen
  await sheet.getByLabel("Nachname").fill("Neumann");
  await sheet.getByLabel("Jahrgang").fill("2016");
  await sheet.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(page.getByText("Angaben gespeichert.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Lea Neumann" })).toBeVisible();
  // Saved: the button for the details disappears until something changes again
  await expect(sheet.getByRole("button", { name: "Angaben speichern" })).toHaveCount(0);

  // Dauerhaft löschen erst nach Eintippen des Namens
  const neu = page.getByRole("dialog", { name: "Lea Neumann" });
  await neu.getByRole("button", { name: "Person dauerhaft löschen" }).click();
  await expect(neu.getByRole("button", { name: "Endgültig löschen" })).toBeDisabled();
  await neu.getByLabel(/Zur Bestätigung/).fill("Lea Neumann");
  await neu.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(page.getByText("Lea Neumann wurde gelöscht.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Lea Neumann/ })).toHaveCount(0);

  // Protokoll: alles nachvollziehbar, auch über die gelöschte Person
  await page.goto("/verwaltung");
  await page.getByRole("link", { name: /Protokoll/ }).click();
  await expect(page.getByRole("heading", { name: "Protokoll" })).toBeVisible();
  await expect(page.getByText(/hat Lea Neumann gelöscht/)).toBeVisible();
  await expect(page.getByText(/hat Lea Neu aus wT entfernt \(Spieler\)/)).toBeVisible();
  await expect(page.getByText(/hat Lea Neu als Spieler zu wT hinzugefügt/)).toBeVisible();
});

test("Admin schickt eine Rundnachricht, sie erscheint als Ankündigung im Chat", async () => {
  const { page } = admin;
  await page.goto("/verwaltung");
  // Ada ist nirgends Trainerin: keine Mannschaftsliste oben, nur der Unterbereich
  await expect(page.getByRole("link", { name: /^Mannschaften/ })).toContainText("1 Mannschaft ·");
  await expect(page.getByRole("region", { name: "Meine Mannschaften" })).toHaveCount(0);
  await page.getByRole("link", { name: /Rundnachricht/ }).click();
  await page.getByLabel("Nachricht").fill("Saisonabschluss am Samstag um 15 Uhr");
  await page.getByRole("button", { name: "An einen Chat senden" }).click();
  await page.getByRole("dialog", { name: "Rundnachricht senden?" }).getByRole("button", { name: "Senden" }).click();
  await expect(page.getByText("Gesendet an einen Chat.")).toBeVisible();

  await player.page.goto("/chat");
  const card = player.page.locator(".announcement").filter({ hasText: "Saisonabschluss am Samstag um 15 Uhr" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Ankündigung · Ada A.");
  await card.getByRole("button", { name: /Auf Ankündigung von Ada A\. reagieren/ }).click();
  await card.getByRole("group", { name: "Reaktion wählen" }).getByRole("button", { name: "Herz" }).click();
  await expect(card.locator(".reactions")).toContainText("❤️");
  await player.page.screenshot({ path: process.env.E2E_SHOT ?? "test-results/announcement.png" });
});

test("Eigener Name: Spielerin sieht den Hinweis statt „Namen ändern“", async () => {
  const { page } = player;
  await page.goto("/profil");
  await expect(page.getByText("Name falsch? Sag deinem Trainer oder einem Admin Bescheid.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Namen ändern" })).toHaveCount(0);
});

test("Trainingsorte: Admin legt eine Vereinshalle an", async () => {
  const { page } = admin;
  await page.goto("/verwaltung/orte");
  await page.getByRole("button", { name: "Ort hinzufügen" }).click();
  const sheet = page.getByRole("dialog", { name: "Ort hinzufügen" });
  await sheet.getByLabel("Name").fill("Sporthalle Nord");
  await sheet.getByLabel("Adresse").fill("Nordweg 2, 12345 Musterstadt");
  await sheet.getByRole("button", { name: "Ort hinzufügen" }).click();
  await expect(page.getByText("Ort hinzugefügt.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Vereinshallen" })).toContainText("Sporthalle Nord");
});

test("Ferien: Ferien der Region lassen sich für die laufende Saison laden", async () => {
  const { page } = admin;
  await page.goto("/verwaltung/ferien");
  await expect(page.getByRole("button", { name: "Ferien der Region laden" })).toBeVisible();
  await expect(page.getByText("beim Festlegen der Region geladen", { exact: false })).toBeVisible();
});

test("Admin schaltet unter Updates und Wartung den Wartungsmodus ein und wieder aus", async () => {
  const { page } = admin;
  await page.goto("/verwaltung");
  await page.getByRole("link", { name: /Updates und Wartung/ }).click();
  await expect(page.getByRole("region", { name: "Version" })).toContainText(/Kabine \d+\.\d+\.\d+/);
  await expect(page.getByText("Noch kein Update aufgezeichnet.", { exact: false })).toBeVisible();
  await page.getByRole("switch", { name: /Wartungsmodus/ }).click();
  await expect(page.getByText("Wartungsmodus an.", { exact: false })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Wartungsmodus/ })).toHaveAttribute("aria-checked", "true");

  await player.page.goto("/");
  await expect(player.page.getByText("Die App wird gerade gewartet")).toBeVisible();

  await page.getByRole("switch", { name: /Wartungsmodus/ }).click();
  await expect(page.getByRole("switch", { name: /Wartungsmodus/ })).toHaveAttribute("aria-checked", "false");
  await player.page.goto("/");
  await expect(player.page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();
});

test("Trainer meldet sich für ein Training ab: der Termin bleibt, die Spielerin sieht es ohne Notiz", async () => {
  const { events } = (await (await coach.page.request.get("/api/events?kind=training&teamId=1")).json()) as { events: { id: number; cancelled: unknown }[] };
  const next = events.find((e) => !e.cancelled)!;
  const { page } = coach;
  await page.goto(`/termine/${next.id}`);
  const inCharge = page.getByRole("region", { name: "Verantwortlich" });
  await inCharge.getByRole("button", { name: "Ich bin nicht da" }).click();
  const sheet = page.getByRole("dialog", { name: "Ich bin nicht da" });
  await sheet.getByLabel("Notiz für die anderen Verantwortlichen (optional)").fill("Sam leitet das Training");
  await sheet.getByRole("button", { name: "Ich bin nicht da" }).click();
  await expect(page.getByText("Eingetragen: Du bist nicht da.")).toBeVisible();
  await expect(inCharge).toContainText("Nicht da");
  await expect(inCharge).toContainText("Sam leitet das Training");
  await expect(page.getByText("Kein Trainer ist da.", { exact: false })).toBeVisible();
  // Absagen verweist auf „Ich bin nicht da“
  await page.getByRole("button", { name: "Absagen" }).click();
  await expect(page.getByRole("dialog", { name: "Training absagen" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  await player.page.goto(`/termine/${next.id}`);
  const forPlayer = player.page.getByRole("region", { name: "Verantwortlich" });
  await expect(forPlayer).toContainText("Nicht da");
  await expect(forPlayer).not.toContainText("Sam");

  await page.goto("/");
  await expect(page.getByText("Du bist nicht da").first()).toBeVisible();
  await page.goto(`/termine/${next.id}`);
  await inCharge.getByRole("button", { name: "Ich bin doch da" }).click();
  await expect(page.getByText("Eingetragen: Du bist doch da.")).toBeVisible();
  await player.page.reload();
  await expect(player.page.getByRole("heading", { name: "Verantwortlich" })).toHaveCount(0);
});

test("Helferplan: einschalten, Spiel unter Team anlegen, Dienst übernehmen, live beim Admin", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("switch", { name: /Helferplan für diese Mannschaft/ }).click();
  await expect(page.getByText("Helferplan eingeschaltet.")).toBeVisible();

  // Spiel ohne handball4all legt der Trainer unter Team → Termin anlegen an
  await page.getByRole("link", { name: "Termin anlegen" }).click();
  await page.getByRole("group", { name: "Art des Termins" }).getByRole("button", { name: "Spiel" }).click();
  await page.getByLabel("Gegner oder Turnier").fill("Turnier Musterstadt");
  await page.getByLabel("Datum").fill("2099-05-01");
  await page.getByLabel("Spielbeginn").fill("10:00");
  await page.getByRole("button", { name: "Spiel anlegen" }).click();
  await expect(page).toHaveURL(/\/termine\/\d+/);
  const gameId = page.url().split("/").pop();
  // The helper plan link on the event leads to the team and to exactly this game
  await page.locator("a.ext-link", { hasText: "Helferplan" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/helfer\\?mannschaft=1&spiel=${gameId}$`));
  const card = page.getByRole("article", { name: /Turnier Musterstadt/ });
  await expect(card).toContainText("4 frei");
  await expect(card).toHaveClass(/duty-game-target/);
  await expect(card).toBeInViewport();

  // Admin hat den Helferplan offen und sieht den Eintrag ohne Neuladen
  await admin.page.goto("/helfer");
  const adminCard = admin.page.getByRole("article", { name: /Turnier Musterstadt/ });
  await expect(adminCard).toContainText("4 frei");

  await card.locator(".duty-slot", { hasText: "Kuchen & Theke" }).getByRole("button", { name: "Eintragen" }).click();
  const signup = page.getByRole("dialog", { name: "Kuchen & Theke" });
  await signup.getByLabel(/Was bringst du mit/).fill("Marmorkuchen");
  await signup.getByRole("button", { name: "Eintragen" }).click();
  await expect(card).toContainText("Theo T.");
  await expect(card).toContainText("„Marmorkuchen“");
  await expect(page.getByRole("region", { name: "Meine Dienste" })).toContainText("Kuchen & Theke");
  await expect(adminCard).toContainText("Theo T.", { timeout: 10_000 });
  await expect(adminCard).toContainText("3 frei");

  // Termin-Detail nennt den eigenen Dienst
  const games = await (await page.request.get("/api/duties?teamId=1")).json();
  const turnier = games.games.find((g: { guestTeam: string | null }) => g.guestTeam === "Turnier Musterstadt");
  await page.goto(`/termine/${turnier.id}`);
  await expect(page.getByRole("link", { name: /Dein Dienst: Kuchen & Theke/ })).toBeVisible();
  await page.goBack();

  // Verwalten: einen Kuchenplatz mehr
  await card.getByRole("button", { name: "Verwalten" }).click();
  const manage = page.getByRole("dialog", { name: "Dienste verwalten" });
  await manage.getByRole("button", { name: "Kuchen & Theke: ein Platz mehr" }).click();
  // Jemanden aus dem ganzen Verein eintragen (Ada gehört nicht zur Mannschaft)
  await manage.getByLabel("Name suchen").fill("Ada");
  await manage.getByRole("list", { name: "Personen" }).getByRole("button", { name: /Ada A\./ }).click();
  await expect(manage.getByRole("region", { name: "Einträge" })).toContainText("Ada A.");
  await manage.getByRole("button", { name: "Schließen" }).click();
  await expect(card.locator(".duty-slot", { hasText: "Kuchen & Theke" })).toContainText("Ada A.");
  await expect(card).toContainText("3 frei");

  // Zeitblöcke mit Uhrzeit (Anpfiff 10:00, Spieldauer der Altersklasse 90 Minuten)
  await expect(card.locator(".duty-slot", { hasText: "Kuchen & Theke" })).toContainText("09:40–11:50");
  await expect(card.locator(".duty-slot", { hasText: "Trikots waschen" })).toContainText("Aufgabe · danach");

  // Zeitnehmer braucht Vorkenntnisse: erst nach „Das kann ich“ im Profil
  const timer = card.locator(".duty-slot", { hasText: "Zeitnehmer" });
  await expect(timer.getByRole("button", { name: "Eintragen" })).toHaveCount(0);
  await timer.getByRole("link", { name: "Profil" }).click();
  const skill = page.getByRole("region", { name: "Das kann ich" }).getByRole("switch", { name: "Zeitnehmer und Sekretär" });
  await skill.click();
  await expect(skill).toHaveAttribute("aria-checked", "true");
  await page.getByRole("link", { name: "Helfer" }).click();
  await expect(timer.getByRole("button", { name: "Eintragen" })).toBeVisible();
});

test("Helferdienste: Admin pflegt Dienstarten, Trainer legt Sondertermin mit Zeitblöcken an", async () => {
  // Admin: neue Dienstart unter Verwaltung → Helferdienste
  const a = admin.page;
  await a.goto("/verwaltung");
  await a.getByRole("link", { name: /Helferdienste/ }).click();
  await a.getByRole("button", { name: "Dienstart hinzufügen" }).click();
  const typeSheet = a.getByRole("dialog", { name: "Neue Dienstart" });
  await typeSheet.getByLabel("Name").fill("Aufbau");
  await typeSheet.getByRole("button", { name: "Alle", exact: true }).click();
  await typeSheet.getByRole("button", { name: "Speichern" }).click();
  await expect(a.getByRole("region", { name: "Dienstarten" })).toContainText("Wer hilft: Alle");
  // Vorlage Heimspiel öffnen: Zeilen mit Minuten vor Beginn und nach Ende
  await a.getByRole("button", { name: /Heimspiel/ }).click();
  const tpl = a.getByRole("dialog", { name: "Heimspiel" });
  const cakeRow = tpl.getByRole("region", { name: "Kuchen & Theke" });
  await expect(cakeRow.getByLabel("Minuten vor Beginn")).toHaveValue("20");
  await expect(cakeRow.getByLabel("Minuten nach Ende")).toHaveValue("20");
  await tpl.getByRole("button", { name: "Schließen" }).click();

  // Trainer: Sondertermin mit Aufbau und zwei Grill-Schichten
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("link", { name: "Termin anlegen" }).click();
  await page.getByLabel("Titel").fill("Saisonabschluss");
  await page.getByLabel("Datum").fill("2099-06-27");
  await page.getByLabel("Beginn").fill("15:00");
  await page.getByLabel("Ende (optional)").fill("19:00");
  await page.getByRole("switch", { name: /Helfer benötigt/ }).click();
  await page.getByRole("button", { name: "Zeitblock" }).click();
  let block = page.getByRole("dialog", { name: "Zeitblock hinzufügen" });
  await block.getByLabel("Dienst").selectOption({ label: "Neuer Sonderdienst …" });
  await block.getByLabel("Name des Sonderdienstes").fill("Grill");
  await expect(block.locator(".duty-preview")).toHaveText("Grill · 15:00–17:00 · 2 Plätze");
  await block.getByRole("button", { name: "Hinzufügen" }).click();
  await page.getByRole("button", { name: "Anschluss" }).click();
  await page.getByRole("button", { name: "Zeitblock" }).click();
  block = page.getByRole("dialog", { name: "Zeitblock hinzufügen" });
  await block.getByLabel("Dienst").selectOption({ label: "Aufbau" });
  await block.getByLabel("Beginn").fill("14:00");
  await block.getByRole("button", { name: "1 h" }).click();
  await block.getByRole("button", { name: "Hinzufügen" }).click();
  const blocks = page.getByRole("list", { name: "Zeitblöcke" });
  await expect(blocks).toContainText("14:00–15:00 · Aufbau");
  await expect(blocks).toContainText("15:00–17:00 · Grill");
  await expect(blocks).toContainText("17:00–19:00 · Grill");
  await page.getByRole("button", { name: "Termin anlegen" }).click();
  await expect(page).toHaveURL(/\/termine\/\d+/);

  // Auf der Terminseite öffnet „Helferdienste verwalten“ dasselbe Fenster wie im Reiter Helfer
  await page.getByRole("button", { name: "Helferdienste verwalten" }).click();
  const manageHere = page.getByRole("dialog", { name: "Dienste verwalten" });
  await expect(manageHere.getByRole("region", { name: "Zeitblöcke" })).toContainText("15:00–17:00");
  await manageHere.getByRole("button", { name: "Schließen" }).click();
  // Im Reiter Helfer die Karte mit drei Blöcken
  await page.getByRole("link", { name: "Helfer", exact: true }).click();
  const card = page.getByRole("article", { name: /Saisonabschluss/ });
  await expect(card).toContainText("15:00–19:00");
  await expect(card.locator(".duty-slot")).toHaveCount(3);
  await card.locator(".duty-slot", { hasText: "15:00–17:00" }).getByRole("button", { name: "Eintragen" }).click();
  await page.getByRole("dialog", { name: "Grill" }).getByRole("button", { name: "Eintragen" }).click();
  await expect(card.locator(".duty-slot", { hasText: "15:00–17:00" })).toContainText("Theo T.");
  await expect(page.getByRole("region", { name: "Meine Dienste" })).toContainText("Grill · 15:00–17:00");
  // Verwalten: die Einträge nennen die Uhrzeit des Zeitblocks (zwei Grill-Schichten)
  await card.getByRole("button", { name: "Verwalten" }).click();
  const manage = page.getByRole("dialog", { name: "Dienste verwalten" });
  await expect(manage.getByRole("region", { name: "Einträge" })).toContainText("Grill · 15:00–17:00");
  await manage.getByRole("button", { name: "Schließen" }).click();

  // Admin macht die Spielerin zum ordentlichen Mitglied, der Trainer fügt sie als Organisatorin hinzu
  await a.goto("/verwaltung/personen");
  await a.getByRole("button", { name: /Ida/ }).first().click();
  const idaSheet = a.getByRole("dialog", { name: /Ida/ });
  const memberSwitch = idaSheet.getByRole("switch", { name: /Ordentliches Mitglied/ });
  if ((await memberSwitch.getAttribute("aria-checked")) !== "true") await memberSwitch.click();
  await expect(memberSwitch).toHaveAttribute("aria-checked", "true");

  const saison = (await (await page.request.get("/api/duties?teamId=1")).json()).games.find((g: { title: string | null }) => g.title === "Saisonabschluss");
  await page.goto(`/termine/${saison.id}`);
  const orgs = page.getByRole("group", { name: "Organisatoren" });
  await expect(orgs).toContainText("Theo T.");
  await orgs.getByRole("button", { name: "Organisator hinzufügen" }).click();
  const orgSheet = page.getByRole("dialog", { name: "Organisator hinzufügen" });
  await orgSheet.getByLabel("Name suchen").fill("Ida");
  await orgSheet.getByRole("button", { name: /Ida/ }).click();
  await expect(orgs).toContainText("Ida");

  // Die Spielerin sieht im Reiter Helfer „Verwalten“ beim Saisonabschluss
  await player.page.goto("/helfer");
  await expect(player.page.getByRole("article", { name: /Saisonabschluss/ }).getByRole("button", { name: "Verwalten" })).toBeVisible();
});

test("Dienstart, die der Trainer vergibt: Schalter mit Erklärung, in der Liste gekennzeichnet", async () => {
  const a = admin.page;
  await a.goto("/verwaltung/helferdienste");
  await a.getByRole("button", { name: "Dienstart hinzufügen" }).click();
  const sheet = a.getByRole("dialog", { name: "Neue Dienstart" });
  await sheet.getByLabel("Name").fill("Hallendienst");
  await sheet.getByRole("button", { name: "Erklärung: Vergibt der Trainer" }).click();
  const info = a.getByRole("dialog", { name: "Vergibt der Trainer" });
  await expect(info).toContainText("Niemand trägt sich selbst ein");
  await info.getByRole("button", { name: "Verstanden" }).click();
  await sheet.getByRole("switch", { name: /Vergibt der Trainer/ }).click();
  // „Helfer gesucht“ gibt es dann nicht, der Schalter verschwindet; „Nur Erwachsene“ bleibt
  await expect(sheet.getByRole("switch", { name: /Helfer gesucht/ })).toHaveCount(0);
  await sheet.getByRole("switch", { name: /Nur Erwachsene/ }).click();
  if (process.env.E2E_SHOTS) await a.screenshot({ path: `${process.env.E2E_SHOTS}/vergibt-der-trainer.png` });
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await expect(a.getByRole("region", { name: "Dienstarten" })).toContainText("vergibt der Trainer · nur Erwachsene");
});

test("Helfer aus: Vorlage mit Wischern abwechselnd aus Mannschaften", async () => {
  const a = admin.page;
  await a.goto("/verwaltung/helferdienste");
  await a.getByRole("button", { name: "Vorlage hinzufügen" }).click();
  const sheet = a.getByRole("dialog", { name: "Neue Vorlage" });
  await sheet.getByLabel("Name").fill("Erste Heimspiel");
  await sheet.getByRole("button", { name: "Dienst hinzufügen" }).click();
  const from = sheet.getByRole("group", { name: "Helfer aus", exact: true });
  await from.getByRole("button", { name: "Abwechselnd" }).click();
  await from.getByRole("group", { name: "Mannschaften für Helfer aus" }).getByRole("button", { name: "wT" }).click();
  await expect(from).toContainText("Reihenfolge: wT");
  if (process.env.E2E_SHOTS) await a.screenshot({ path: `${process.env.E2E_SHOTS}/helfer-aus-vorlage.png`, fullPage: true });
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await a.getByRole("button", { name: /Erste Heimspiel/ }).click();
  const again = a.getByRole("dialog", { name: "Erste Heimspiel" });
  await expect(again.getByRole("group", { name: "Helfer aus", exact: true }).getByRole("button", { name: "Abwechselnd" })).toHaveAttribute("aria-pressed", "true");
  await expect(again.getByRole("group", { name: "Mannschaften für Helfer aus" }).getByRole("button", { name: "1. wT" })).toHaveAttribute("aria-pressed", "true");
  await again.getByRole("button", { name: "Schließen" }).click();
});

test("Vereinstermin mit Helferdienst: anlegen, in der Gesamtansicht eintragen, auf der Terminseite verwalten", async () => {
  const a = admin.page;
  await a.goto("/verwaltung/termin-neu");
  await a.getByLabel("Titel").fill("Sommerturnier");
  await a.getByLabel("Datum").fill("2099-07-04");
  await a.getByLabel("Beginn").fill("10:00");
  await a.getByLabel("Ende (optional)").fill("16:00");
  await a.getByRole("switch", { name: /Für den ganzen Verein/ }).click();
  await a.getByRole("switch", { name: /Helfer benötigt/ }).click();
  await a.getByRole("button", { name: "Zeitblock" }).click();
  const block = a.getByRole("dialog", { name: "Zeitblock hinzufügen" });
  await block.getByLabel("Dienst").selectOption({ label: "Aufbau" });
  await block.getByLabel("Beginn").fill("09:00");
  // Neu: 2,5 h zwischen 2 h und 3 h
  await block.getByRole("button", { name: "2,5 h" }).click();
  await expect(block.locator(".duty-preview")).toContainText("09:00–11:30");
  await block.getByRole("button", { name: "1 h" }).click();
  await block.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(a.getByRole("list", { name: "Zeitblöcke" })).toContainText("09:00–10:00 · Aufbau");
  await a.getByRole("button", { name: "Termin anlegen" }).click();
  await expect(a).toHaveURL(/\/termine\/\d+/);
  const eventUrl = a.url();

  // Trainer: ohne Filter gehört der Vereinstermin schon dazu, der Chip „Ganzer Verein“ ist mit aktiv
  const c = coach.page;
  await c.goto("/");
  await c.reload();
  await c.getByRole("link", { name: "Helfer", exact: true }).click();
  const clubChip = c.getByRole("group", { name: "Nach Mannschaft filtern" }).getByRole("button", { name: "Ganzer Verein" });
  await expect(clubChip).toHaveAttribute("aria-pressed", "true");
  await expect(c.getByRole("article", { name: /Sommerturnier/ })).toBeVisible();
  // Antippen filtert auf die Vereinstermine allein
  await clubChip.click();
  const card = c.getByRole("article", { name: /Sommerturnier/ });
  await card.locator(".duty-slot", { hasText: "09:00–10:00" }).getByRole("button", { name: "Eintragen" }).click();
  await c.getByRole("dialog", { name: "Aufbau" }).getByRole("button", { name: "Eintragen" }).click();
  await expect(card.locator(".duty-slot", { hasText: "09:00–10:00" })).toContainText("Theo T.");
  if (process.env.E2E_SHOTS) await c.screenshot({ path: `${process.env.E2E_SHOTS}/verein-helfer.png`, fullPage: true });

  // Admin: auf der Terminseite mehrere Zeitblöcke nacheinander, dann den ersten samt Eintrag entfernen
  await a.goto(eventUrl);
  await a.getByRole("button", { name: "Helferdienste verwalten" }).click();
  const manage = a.getByRole("dialog", { name: "Dienste verwalten" });
  for (const start of ["16:00", "17:00"]) {
    await manage.getByRole("button", { name: "Zeitblock hinzufügen" }).click();
    const more = a.getByRole("dialog", { name: "Zeitblock hinzufügen" });
    await more.getByLabel("Dienst").selectOption({ label: "Aufbau" });
    await more.getByLabel("Beginn").fill(start);
    await more.getByRole("button", { name: "1 h" }).click();
    await more.getByRole("button", { name: "Hinzufügen" }).click();
  }
  const slots = manage.getByRole("region", { name: "Zeitblöcke" });
  await expect(slots).toContainText("16:00–17:00");
  await expect(slots).toContainText("17:00–18:00");
  await expect(manage.getByRole("region", { name: "Einträge" })).toContainText("Aufbau · 09:00–10:00");
  await slots.getByRole("button", { name: "Aufbau entfernen" }).first().click();
  const confirm = a.getByRole("dialog", { name: "Aufbau entfernen?" });
  await expect(confirm).toContainText("1 Eintrag wird mit entfernt");
  await confirm.getByRole("button", { name: "Entfernen" }).click();
  await expect(slots).not.toContainText("09:00–10:00");
  await expect(manage.getByRole("region", { name: "Einträge" })).not.toContainText("Theo T.");
  await manage.getByRole("button", { name: "Schließen" }).click();
});

test("Sondertermin ohne Helferdienste: „Helferdienste verwalten“ beginnt mit dem ersten Zeitblock", async () => {
  const { page } = coach;
  const date = new Date(Date.now() + 12 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const created = await (await page.request.post("/api/events", { data: { title: "Elternabend", startsAt: `${date}T19:00`, endsAt: `${date}T20:30`, teamIds: [1] } })).json();
  await page.goto(`/termine/${created.id}`);
  await page.getByRole("button", { name: "Helferdienste verwalten" }).click();
  const first = page.getByRole("dialog", { name: "Zeitblock hinzufügen" });
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: "Schließen" }).click();
  const manage = page.getByRole("dialog", { name: "Dienste verwalten" });
  await expect(manage).toContainText("Noch keine Dienste.");
  await manage.getByRole("button", { name: "Schließen" }).click();
  await page.request.delete(`/api/events/${created.id}`);
});

test("Hilfe und Feedback: Spielerin im eigenen Reiter, Admin unter Verwaltung", async () => {
  const { page } = player;
  await page.goto("/");
  await page.getByRole("link", { name: "Hilfe" }).click();
  await expect(page.getByRole("heading", { name: "Hilfe und Feedback" })).toBeVisible();
  // Häufige Fragen: Spielerin sieht „Für alle“ und den Spieler-Teil, nicht Eltern und Trainer
  const faq = page.getByRole("region", { name: "Häufige Fragen", exact: true });
  await expect(faq.getByRole("heading", { name: "Spielerinnen und Spieler" })).toBeVisible();
  await expect(faq.getByRole("heading", { name: "Trainerinnen und Trainer" })).toHaveCount(0);
  await expect(faq.getByRole("heading", { name: "Eltern" })).toHaveCount(0);
  await faq.getByText("Ich habe ein neues Handy und komme nicht mehr in die App.").click();
  await expect(faq.getByText(/persönlichen Link \(7 Tage/)).toBeVisible();
  await expect(page.getByText(/Kabine ist freie Software/)).toBeVisible();
  // Was ist neu: Hinweise für Spieler und Eltern aus den Versionshinweisen; Start des Vereins noch unbekannt, also alle
  await page.getByRole("link", { name: /Was ist neu/ }).click();
  await expect(page.getByRole("heading", { name: "Was ist neu" })).toBeVisible();
  await expect(page.getByText("Erste Version von Kabine.")).toBeVisible();
  await expect(page.getByText(/Für alle abgesagte Termine heißen jetzt/)).toBeVisible();
  await expect(page.getByText(/Verwaltung → Protokoll/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Start der App" })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Hilfe und Feedback" })).toBeVisible();
  // Versand abfangen: E2E verschickt keine Mails
  let sent = "";
  await page.route("**/api/feedback", async (route) => {
    sent = route.request().postDataBuffer()?.toString("latin1") ?? "";
    await route.fulfill({ json: { ok: true, replyTo: false } });
  });
  await page.getByLabel("Deine Nachricht").fill("Der Kalender lädt langsam.");
  // 1×1-PNG; die App verkleinert und schickt es als JPEG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[type="file"]').setInputFiles({ name: "screenshot.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "Angehängtes Bild" })).toBeVisible();
  await page.getByRole("button", { name: "Absenden" }).click();
  await expect(page.getByText("Danke, deine Nachricht ist angekommen.")).toBeVisible();
  expect(sent).toContain("Der Kalender l");
  expect(sent).toContain("Content-Type: image/jpeg");
  await page.unroute("**/api/feedback");

  // Admin: kein Hilfe-Reiter, aber Eintrag unter Verwaltung
  await admin.page.goto("/verwaltung");
  await expect(admin.page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Hilfe" })).toHaveCount(0);
  await admin.page.getByRole("link", { name: /Hilfe und Feedback/ }).click();
  await expect(admin.page.getByRole("heading", { name: "Hilfe und Feedback" })).toBeVisible();
});

test("Admin: versteckte Elternsicht per Adresse, Beenden stellt die Admin-Sicht wieder her", async () => {
  const { page } = admin;
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await page.goto("/?parentview=1");
  await expect(page.getByRole("note").filter({ hasText: "Ansicht als Elternteil" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(nav.getByRole("link", { name: "Verwaltung" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Hilfe" })).toBeVisible();
  await page.getByRole("button", { name: "Beenden" }).click();
  await expect(nav.getByRole("link", { name: "Verwaltung" })).toBeVisible();
  await expect(page.getByText("Ansicht als Elternteil")).toHaveCount(0);
});

test("Anmeldung per E-Mail: Hinweis auf die interne Vereins-App", async ({ browser }) => {
  const visitor = await newUser(browser);
  await visitor.page.goto("/");
  await visitor.page.getByRole("button", { name: "Code per E-Mail" }).click();
  await visitor.page.getByLabel("E-Mail-Adresse").fill("fremd@example.org");
  await visitor.page.getByRole("button", { name: "Code senden" }).click();
  await expect(visitor.page.getByText("Kabine ist eine interne Vereins-App.", { exact: false })).toBeVisible();
  await visitor.context.close();
});

test("Jugendschiedsrichter: Admin erzeugt den Freigabe-Link, Spielerin wird freigegeben und trägt sich ein", async () => {
  await admin.page.goto("/verwaltung");
  await admin.page.getByRole("link", { name: /Freigaben/ }).click();
  const card = admin.page.getByRole("region", { name: "Jugendschiedsrichter" });
  await card.getByRole("button", { name: "Neuen Link erzeugen" }).click();
  const url = await card.locator(".url-box").first().innerText();
  expect(url).toContain("/freigabe#");

  const { page } = player;
  await page.goto(url);
  await page.getByRole("radio", { name: /Ida Probe \(ich\)/ }).check();
  await page.getByRole("button", { name: "Freigeben" }).click();
  await expect(page.getByText("ist jetzt für Jugendschiedsrichter freigegeben")).toBeVisible();
  await page.getByRole("link", { name: "Zum Reiter Helfer" }).click();
  await expect(page.getByRole("button", { name: "Jugendschiedsrichter" })).toHaveAttribute("aria-pressed", "true");

  // Heimspiel der Jugend D aus dem Helferplan-Test
  const game = page.getByRole("article", { name: /Turnier Musterstadt/ });
  await game.locator(".duty-slot", { hasText: "Jugendschiedsrichter" }).getByRole("button", { name: "Eintragen" }).click();
  await page.getByRole("dialog", { name: "Jugendschiedsrichter" }).getByRole("button", { name: "Eintragen" }).click();
  await expect(game).toContainText("Ida P.");
  await expect(page.getByRole("region", { name: "Meine Dienste" })).toContainText("Jugendschiedsrichter");
  // Filter: das Spiel ist jetzt voll und verschwindet bei „Nur mit freien Plätzen“
  await page.getByRole("button", { name: "Nur mit freien Plätzen" }).click();
  await expect(page.getByRole("article", { name: /Turnier Musterstadt/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Alle Termine" }).click();
  await expect(game).toBeVisible();
});

test("Stammkader: dauerhafte Aushilfe aufnehmen", async () => {
  const { page } = admin;
  const created = await page.request.post("/api/admin/persons", { data: { firstName: "Mia", lastName: "Aushilf", birthYear: 2016 } });
  const { id: mia } = await created.json();
  // Aushilfe aus der 2. Mannschaft derselben Altersklasse
  const { id: second } = await (await page.request.post("/api/teams", { data: { name: "wT2", ageClassCode: "wD", level: 2 } })).json();
  expect((await page.request.post(`/api/teams/${second}/members`, { data: { personId: mia, role: "player" } })).ok()).toBe(true);
  expect((await page.request.post("/api/teams/1/helpers", { data: { personId: mia, trainings: false } })).ok()).toBe(true);

  await page.goto("/team/1");
  const helpers = page.getByRole("region", { name: "Aushilfen" });
  const row = helpers.locator("li", { hasText: "Mia Aushilf" });
  await row.getByRole("switch", { name: "Stammkader" }).click();
  // Marke „Stamm“ (nicht der Schaltertext „Stammkader“): erst dann ist gespeichert und neu geladen
  await expect(row.locator(".badge", { hasText: "Stamm" })).toBeVisible();

  // Im Blatt „Stammkader festlegen“ steht sie mit Hinweis und bleibt beim Speichern erhalten
  await page.getByRole("button", { name: "Stammkader festlegen" }).click();
  const sheet = page.getByRole("dialog", { name: "Stammkader" });
  await expect(sheet.getByRole("checkbox", { name: /Mia Aushilf/ })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("checkbox", { name: /Mia Aushilf/ })).toContainText("Aushilfe");
  await sheet.getByRole("button", { name: /^Speichern/ }).click();
  await expect(page.getByText(/Stammkader gespeichert/)).toBeVisible();
  await expect(row.locator(".badge", { hasText: "Stamm" })).toBeVisible();

  await page.request.delete(`/api/admin/persons/${mia}`);
  await page.request.delete(`/api/teams/${second}`);
});

test("Kader: Spielerin aus der 2. Mannschaft zusätzlich aufnehmen", async () => {
  const { page } = admin;
  const { id: second } = await (await page.request.post("/api/teams", { data: { name: "wT2", ageClassCode: "wD", level: 2 } })).json();
  const { id: nele } = await (await page.request.post("/api/admin/persons", { data: { firstName: "Nele", lastName: "Zwei", birthYear: 2015 } })).json();
  expect((await page.request.post(`/api/teams/${second}/members`, { data: { personId: nele, role: "player" } })).ok()).toBe(true);
  expect((await page.request.put(`/api/teams/${second}/core-squad`, { data: { personIds: [nele] } })).ok()).toBe(true);

  await page.goto("/team/1");
  const roster = page.getByRole("region", { name: "Spielerinnen und Spieler" });
  await roster.getByRole("button", { name: "Hinzufügen" }).click();
  const sheet = page.getByRole("dialog", { name: "Spieler hinzufügen" });
  await sheet.getByRole("button", { name: "Aus anderer Mannschaft" }).click();
  // Core squad of the other team is marked, filter by team
  const filter = sheet.getByRole("group", { name: "Nach Mannschaft filtern" });
  if (await filter.count()) await filter.getByRole("button", { name: "wT2" }).click();
  const row = sheet.locator(".list-row", { hasText: "Nele Zwei" });
  await expect(row).toContainText("wT2 (Stammkader)");
  await row.getByRole("button", { name: "Aufnehmen" }).click();
  await expect(page.getByText("Nele spielt jetzt auch in der wT.")).toBeVisible();
  await sheet.getByRole("button", { name: /Schließen|Zurück/ }).first().click().catch(() => page.keyboard.press("Escape"));
  await expect(roster).toContainText("Nele Zwei");

  await page.request.delete(`/api/admin/persons/${nele}`);
  await page.request.delete(`/api/teams/${second}`);
});

test("Ferien: Admin legt einen Zeitraum an, ändert und löscht ihn", async () => {
  const { page } = admin;
  await page.goto("/verwaltung/ferien");
  await page.getByRole("button", { name: "Zeitraum hinzufügen" }).click();
  let sheet = page.getByRole("dialog", { name: "Neuer Ferienzeitraum" });
  await sheet.getByLabel("Name").fill("Fastnachtsferien");
  await sheet.getByLabel("Von").fill("2027-02-08");
  await sheet.getByLabel("Bis").fill("2027-02-12");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  const list = page.getByRole("region", { name: "Ferienzeiträume" });
  await expect(list).toContainText("Fastnachtsferien");
  await expect(list).toContainText("5 Tage");

  await list.getByRole("button", { name: /Fastnachtsferien/ }).click();
  sheet = page.getByRole("dialog", { name: "Fastnachtsferien" });
  await sheet.getByLabel("Bis").fill("2027-02-13");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await expect(list).toContainText("6 Tage");

  await list.getByRole("button", { name: /Fastnachtsferien/ }).click();
  await page.getByRole("dialog", { name: "Fastnachtsferien" }).getByRole("button", { name: "Löschen" }).click();
  await page.getByRole("dialog", { name: "Fastnachtsferien löschen?" }).getByRole("button", { name: "Löschen" }).click();
  await expect(list).not.toContainText("Fastnachtsferien");
});

test("Aktualisieren: Ziehen von oben und Rückkehr in die App laden Termine neu", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, storageState: await player.context.storageState() });
  const page = await context.newPage();
  let loads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events") loads++;
  });
  await page.goto("/");
  await expect(page.locator(".event-row").first()).toBeVisible();
  const before = loads;

  // Touch-Zug von oben nach unten
  const cdp = await context.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 200, y }] });
  await touch("touchStart", 120);
  for (let y = 140; y <= 400; y += 20) await touch("touchMove", y);
  await expect(page.locator(".ptr.ready")).toBeVisible();
  await touch("touchEnd", 400);
  await expect.poll(() => loads).toBeGreaterThan(before);
  await expect(page.locator(".ptr")).toHaveCount(0);

  // Nach mehr als einer Minute im Hintergrund wieder sichtbar
  const afterPull = loads;
  await page.evaluate(() => {
    // Läuft im Browser; die e2e-Typen kennen kein DOM
    const doc = (globalThis as unknown as { document: EventTarget }).document;
    const realNow = Date.now.bind(Date);
    let state = "hidden";
    Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => state });
    doc.dispatchEvent(new Event("visibilitychange"));
    Date.now = () => realNow() + 120_000;
    state = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => loads).toBeGreaterThan(afterPull);
  await context.close();
});

test("Anleitungen: Hinweis zum Installieren im Browser, Anleitungen unter Hilfe", async () => {
  const { page } = player;
  await page.goto("/");
  const banner = page.getByRole("region", { name: "App installieren" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Hinweis ausblenden" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".event-row").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "App installieren" })).toHaveCount(0);

  await page.goto("/hilfe");
  const guides = page.getByRole("region", { name: "Anleitungen" });
  await guides.locator("summary", { hasText: "Benachrichtigungen einrichten" }).click();
  await expect(guides.getByText(/Auf diesem Gerät aktivieren/)).toBeVisible();
});

test("Anwesenheit: Trainer trägt im vergangenen Termin ein, die Spielerin sieht ihren Eintrag", async () => {
  const { page } = coach;
  await page.goto("/");
  await page.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: "Vergangen" }).click();
  await page.getByRole("link", { name: /Vergangenes Turnier/ }).click();
  await expect(page).toHaveURL(/\/termine\/9001$/);
  const tiles = page.getByRole("group", { name: "Anwesenheit", exact: true });
  await expect(tiles).toContainText("anwesend");
  await expect(page.getByText("Ohne Eintrag zählt die Rückmeldung.", { exact: false })).toBeVisible();
  const ida = page.getByRole("group", { name: "Anwesenheit von Ida P." });
  // Ohne Eintrag zählt die (automatische) Zusage
  await expect(ida.getByRole("button", { name: "Anwesend" })).toHaveAttribute("aria-pressed", "true");
  await ida.getByRole("button", { name: "Unentschuldigt" }).click();
  await expect(ida.getByRole("button", { name: "Unentschuldigt" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/?zeit=vergangen");
  await expect(page.locator(".event-row", { hasText: "Vergangenes Turnier" })).toContainText("1× unentschuldigt");
  await page.goto("/team/1");
  await page.getByRole("group", { name: "Bereich" }).getByRole("button", { name: "Kader" }).click();
  await expect(page.getByText("1× unentschuldigt")).toBeVisible();

  await player.page.goto("/?zeit=vergangen");
  await expect(player.page.locator(".event-row", { hasText: "Vergangenes Turnier" })).toContainText("Unentschuldigt gefehlt");
  await player.page.goto("/termine/9001");
  await expect(player.page.getByText("Unentschuldigt gefehlt")).toBeVisible();
  // Andere Spieler bekommen nichts davon mit
  const detail = await (await player.page.request.get("/api/events/9001")).json();
  expect(detail.participants).toBeNull();
});

test("Terminübersicht: jedes Team-Label schaltet seine Termine an und aus, Chips nach Art", async () => {
  const { id: second } = await (await admin.page.request.post("/api/teams", { data: { name: "wF2", ageClassCode: "wD", level: 2 } })).json();
  expect((await admin.page.request.post(`/api/teams/${second}/members`, { data: { personId: 2, role: "coach" } })).ok()).toBe(true);
  const date = new Date(Date.now() + 4 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const game = await coach.page.request.post("/api/duties/teams/1/games", { data: { opponent: "HSG Knopfhausen", isHome: true, date, time: "12:00" } });
  expect(game.ok()).toBe(true);
  const { id: gameId } = (await game.json()) as { id: number };

  const { page } = coach;
  await page.goto("/");
  const filter = page.getByRole("group", { name: "Nach Mannschaft filtern" });
  const wt = filter.getByRole("button", { name: "wT" });
  const wf2 = filter.getByRole("button", { name: "wF2" });
  // Own teams on by default, a new team too
  await expect(wt).toHaveAttribute("aria-pressed", "true");
  await expect(wf2).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".event-row").first()).toBeVisible();
  // wT off: only the (empty) wF2
  await wt.click();
  await expect(wt).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".hero-sub")).toHaveText("Termine der wF2");
  await expect(page.locator(".event-row")).toHaveCount(0);
  // Everything off: "Nothing selected", also under the greeting
  await wf2.click();
  await expect(page.locator(".hero-sub")).toHaveText("Nichts ausgewählt");
  await expect(page.locator(".empty", { hasText: "Nichts ausgewählt" })).toBeVisible();
  await expect(page.locator(".event-row")).toHaveCount(0);
  // Kept on this device
  await page.reload();
  await expect(wt).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".hero-sub")).toHaveText("Nichts ausgewählt");
  await wt.click();
  await expect(page.locator(".hero-sub")).toHaveText("Termine der wT");
  await expect(page.locator(".event-row").first()).toBeVisible();
  await wf2.click();

  // Chips for the kind, always visible; the server filters (paging stays right)
  const kinds = page.getByRole("group", { name: "Art der Termine" });
  await expect(kinds.getByRole("button", { name: "Alles" })).toHaveAttribute("aria-pressed", "true");
  const gameRow = page.locator(".event-row", { hasText: "HSG Knopfhausen" });
  await expect(gameRow).toBeVisible();
  const games = page.waitForResponse((r) => r.url().includes("/api/events?limit=") && r.url().includes("show=game"));
  await kinds.getByRole("button", { name: "Spiele" }).click();
  await games;
  await expect(gameRow).toBeVisible();
  // Game row: short title without the team, home tag, the team in the ball
  await expect(gameRow.locator(".home-tag")).toHaveText("Heim");
  await expect(gameRow.locator(".title")).toContainText("– HSG Knopfhausen");
  await expect(gameRow.locator(".title")).not.toContainText("wT");
  await expect(gameRow.getByRole("img", { name: /^wT/ })).toBeVisible();
  await expect(page.locator(".event-row", { hasText: "Training" })).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/home-games.png`, fullPage: true });
  await kinds.getByRole("button", { name: "Training" }).click();
  await expect(gameRow).toHaveCount(0);
  await expect(page.locator(".event-row", { hasText: "Training" }).first()).toBeVisible();
  await kinds.getByRole("button", { name: "Sonstiges" }).click();
  await expect(page.locator(".event-row", { hasText: "Training" })).toHaveCount(0);
  await kinds.getByRole("button", { name: "Alles" }).click();
  await expect(kinds.getByRole("button", { name: "Alles" })).toHaveAttribute("aria-pressed", "true");
  await expect(gameRow).toBeVisible();

  await coach.page.request.delete(`/api/duties/games/${gameId}`);
  await admin.page.request.delete(`/api/teams/${second}`);
});

test("Trainingsgruppe: Admin schaltet sie an, ihre Sondertermine stehen beim Chip „Training“", async () => {
  const { id: group } = await (await admin.page.request.post("/api/groups", { data: { name: "Torwartgruppe" } })).json();
  expect((await admin.page.request.post(`/api/teams/${group}/members`, { data: { personId: 2, role: "player" } })).ok()).toBe(true);
  const day = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  expect((await admin.page.request.post("/api/events", { data: { title: "Torwarttraining", startsAt: `${day}T17:00`, teamIds: [group] } })).ok()).toBe(true);

  const { page } = admin;
  await page.goto(`/team/${group}`);
  const sw = page.getByRole("switch", { name: /Trainingsgruppe/ });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw.getByText("Gespeichert")).toBeVisible();

  // The member finds the session under "Training", no longer under "Other"
  await coach.page.goto("/");
  const kinds = coach.page.getByRole("group", { name: "Art der Termine" });
  const row = coach.page.locator(".event-row", { hasText: "Torwarttraining" });
  await kinds.getByRole("button", { name: "Training" }).click();
  await expect(row).toBeVisible();
  await kinds.getByRole("button", { name: "Sonstiges" }).click();
  await expect(row).toHaveCount(0);
  await kinds.getByRole("button", { name: "Alles" }).click();
  await expect(row).toBeVisible();

  await admin.page.request.delete(`/api/teams/${group}`);
});

test("Terminübersicht: 20 Termine, „Mehr Termine“ lädt weitere, bleibt beim Zurückkehren", async () => {
  const { page } = coach;
  const me = (await (await page.request.get("/api/session")).json()).me;
  const wt = me.memberships.find((m: { name: string }) => m.name === "wT").id;
  const day = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + n * 86_400_000));
  const created: number[] = [];
  for (let n = 1; n <= 25; n++) {
    const res = await page.request.post("/api/events", { data: { title: `Zusatztermin ${n}`, startsAt: `${day(n)}T21:30`, teamIds: [wt] } });
    expect(res.ok()).toBe(true);
    created.push((await res.json()).id);
  }

  await page.goto("/");
  await expect(page.locator(".event-row").first()).toBeVisible();
  const before = await page.locator(".event-row").count();
  expect(before).toBeLessThanOrEqual(22);
  await expect(page.getByText("Zusatztermin 25")).toHaveCount(0);
  const more = page.getByRole("button", { name: "Mehr Termine" });
  await more.click();
  await expect.poll(() => page.locator(".event-row").count()).toBeGreaterThan(before);
  // Weitere Termine des Trainers liegen dazwischen: nachladen, bis der letzte Zusatztermin da ist
  for (let i = 0; i < 5 && !(await page.getByText("Zusatztermin 25").count()); i++) {
    await more.click();
    await page.waitForResponse((r) => r.url().includes("/api/events?limit="));
  }
  await expect(page.getByText("Zusatztermin 25")).toBeVisible();

  // In einen Termin und zurück: Die längere Liste bleibt
  await page.getByText("Zusatztermin 24").click();
  await page.goBack();
  await expect(page.getByText("Zusatztermin 25")).toBeVisible();

  for (const id of created) await page.request.delete(`/api/events/${id}`);
});

test("Neuigkeit auf der Terminübersicht: erscheint bis zum Ablauf, mit X weg, bleibt weg", async () => {
  const { page } = player;
  await page.goto("/");
  const motd = page.getByRole("region", { name: "Neuigkeit" });
  // Nach dem Ablaufdatum gibt es nichts zu sehen
  if (!activeMotd(MOTD, new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }), () => false)) {
    await expect(motd).toHaveCount(0);
    return;
  }
  await expect(motd).toContainText(MOTD!.title);
  await motd.getByRole("button", { name: "Neuigkeit ausblenden" }).click();
  await expect(motd).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Hallo/ })).toBeVisible();
  await expect(motd).toHaveCount(0);
});

test("Personen: Filter „Ohne Rolle“ zeigt Personen ohne Mannschaft, Kind und Rolle", async () => {
  const { page } = admin;
  const { id } = await (await page.request.post("/api/admin/persons", { data: { firstName: "Olga", lastName: "Ohnerolle" } })).json();
  await page.goto("/verwaltung/personen");
  const roles = page.getByRole("group", { name: "Rolle" });
  await roles.getByRole("button", { name: /Ohne Rolle/ }).click();
  await expect(page.locator(".list-row", { hasText: "Olga Ohnerolle" })).toBeVisible();
  await expect(page.locator(".list-row", { hasText: "Ida Probe" })).toHaveCount(0);
  await page.request.delete(`/api/admin/persons/${id}`);
});

test("Export: Datenschutzhinweis vor dem Download", async () => {
  const { page } = admin;
  await page.goto("/verwaltung");
  await page.getByRole("button", { name: /Export/ }).click();
  await expect(page.getByText(/nach spätestens 30 Tagen von deinem Rechner/)).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByText(/spätestens 30 Tagen/)).toHaveCount(0);

  await page.getByRole("button", { name: /Export/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Verstanden, herunterladen" }).click();
  expect((await download).suggestedFilename()).toMatch(/^kabine-export.*\.json$/);
});

test("Liveticker und Spielbericht: erst beim Antippen ein Abruf, Seite öffnet im neuen Fenster ohne Referrer", async () => {
  const { page } = coach;
  // Spiel, das vor 30 Minuten angepfiffen wurde, über den normalen Import anlegen
  const berlin = (minutesAgo: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
        .formatToParts(new Date(Date.now() - minutesAgo * 60_000))
        .map((x) => [x.type, x.value]),
    );
  // Started today: shortly after midnight 30 minutes ago would be yesterday, and only today's games are "in progress"
  const now = berlin(0);
  const sinceMidnight = Number(now.hour) * 60 + Number(now.minute);
  const p = berlin(Math.max(1, Math.min(30, sinceMidnight - 1)));
  const game = {
    gID: "777001", gNo: "1", gDate: `${p.day}.${p.month}.${p.year!.slice(2)}`, gTime: `${p.hour}:${p.minute}`,
    gHomeTeam: "SV Musterstadt", gGuestTeam: "TSV Testdorf", gGymnasiumID: "901", gGymnasiumName: "Testhalle",
    gHomeGoals: " ", gGuestGoals: " ",
  };
  // Zweites Spiel, seit 5 Stunden vorbei: Spielbericht statt Ticker
  const q = berlin(300);
  const done = { ...game, gID: "777002", gNo: "2", gDate: `${q.day}.${q.month}.${q.year!.slice(2)}`, gTime: `${q.hour}:${q.minute}`, gGuestTeam: "SG Beispielstadt" };
  const payload = [{ head: { name: "Testliga" }, content: { actualGames: [], futureGames: { gClassID: "555", games: [game, done] }, teamsList: [{ teamID: "999", teamName: "SV Musterstadt" }] } }];
  expect((await page.request.put("/api/teams/1/games/source", { data: { link: "https://www.handball4all.de/home/portal/baden-wuerttembergischer-hv#/league?ogId=216&lId=555&tId=999" } })).ok()).toBe(true);
  expect((await page.request.post("/api/teams/1/games/claim", { data: { manual: true } })).ok()).toBe(true);
  expect((await page.request.post("/api/teams/1/games/import", { data: { data: payload } })).ok()).toBe(true);

  const h4aRequests: string[] = [];
  const tickerReferers: (string | undefined)[] = [];
  const ctx = page.context();
  await ctx.route("https://spo.handball4all.de/service/if_g_json.php*", (route) => {
    const live = [{ head: { name: "Testliga" }, content: { actualGames: { games: [{ ...done, sGID: 4242 }, { ...game, live: true, sGID: 0, gToken: "abc123def4567890abc123def4567890" }] }, futureGames: [] } }];
    return route.fulfill({ json: live, headers: { "access-control-allow-origin": "*" } });
  });
  const reportReferers: (string | undefined)[] = [];
  await ctx.route("https://spo.handball4all.de/misc/sboPublicReports.php*", (route) => {
    reportReferers.push(route.request().headers()["referer"]);
    return route.fulfill({ contentType: "text/html", body: "<title>Bericht</title><p>Bericht</p>" });
  });
  await ctx.route("https://spo.handball4all.de/service/ticker/**", (route) => {
    tickerReferers.push(route.request().headers()["referer"]);
    return route.fulfill({ contentType: "text/html", body: "<title>Ticker</title><p>Ticker</p>" });
  });
  page.on("request", (r) => {
    if (r.url().includes("handball4all.de")) h4aRequests.push(r.url());
  });
  await page.goto("/");
  const card = page.getByRole("region", { name: "Spiel läuft gerade" });
  await expect(card).toContainText("SV Musterstadt – TSV Testdorf");
  await page.waitForTimeout(1500);
  // Ohne Antippen kein Abruf bei handball4all
  expect(h4aRequests).toEqual([]);

  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Liveticker bei handball4all" }).click();
  const w = await popup;
  await w.waitForURL("https://spo.handball4all.de/service/ticker/index.html?token=abc123def4567890abc123def4567890");
  expect(h4aRequests).toEqual(["https://spo.handball4all.de/service/if_g_json.php?cmd=ps&og=216&cl=555&ct=999"]);
  expect(tickerReferers).toEqual([undefined]);
  await w.close();
  // Das beendete Spiel steht nicht mehr als „läuft gerade“
  await expect(card).not.toContainText("SG Beispielstadt");

  // Spielbericht beim vergangenen Spiel
  h4aRequests.length = 0;
  await page.goto("/?zeit=vergangen");
  await page.getByRole("link", { name: /SG Beispielstadt/ }).first().click();
  await expect(page.getByRole("button", { name: "Liveticker bei handball4all" })).toHaveCount(0);
  const popup2 = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Spielbericht bei handball4all" }).click();
  const r = await popup2;
  await r.waitForURL("https://spo.handball4all.de/misc/sboPublicReports.php?sGID=4242");
  expect(h4aRequests).toEqual(["https://spo.handball4all.de/service/if_g_json.php?cmd=ps&og=216&cl=555&ct=999"]);
  expect(reportReferers).toEqual([undefined]);
  await r.close();
  await ctx.unroute("https://spo.handball4all.de/misc/sboPublicReports.php*");
  await ctx.unroute("https://spo.handball4all.de/service/if_g_json.php*");
  await ctx.unroute("https://spo.handball4all.de/service/ticker/**");
  // Aufräumen: Spielplan-Link wieder entfernen
  await page.request.put("/api/teams/1/games/source", { data: { link: null } });
});

test("handball.net: Spielplan gleicht sich beim Öffnen der App von selbst ab, höchstens einmal pro Woche", async () => {
  const { page } = coach;
  const ctx = page.context();
  // In 45 Tagen, damit das Spiel den anderen Tests nicht in die Quere kommt (Namen erfunden)
  const day = new Date(Date.now() + 45 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }).replaceAll("-", "");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:SV Musterstadt",
    "BEGIN:VEVENT", "UID:spiel-880001@mmcc-news", `DTSTART:${day}T150000`, "SUMMARY:SV Musterstadt - TSV Testdorf",
    "DESCRIPTION:Spieltag 1\\nSpielnummer 2627E2E0001", "STATUS:CONFIRMED", "LOCATION:TESTHALLE\\, HALLENWEG 1\\, 76000 MUSTERSTADT", "END:VEVENT",
    "END:VCALENDAR", "",
  ].join("\r\n");
  const fetched: string[] = [];
  await ctx.route("https://www.handball.net/kalender/team/*", (route) => {
    fetched.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/calendar", headers: { "Access-Control-Allow-Origin": "*" }, body: ics });
  });
  const source = await page.request.put("/api/teams/1/games/source", { data: { link: "https://www.handball.net/team/880099", connector: "handballnet" } });
  expect(source.ok()).toBe(true);
  // Noch nie abgeglichen: beim Öffnen holt das Gerät des Trainers den Kalender, ohne dass er etwas antippt
  await page.goto("/");
  await expect(page.getByText("Spielplan von wT abgeglichen.", { exact: false })).toBeVisible();
  expect(fetched).toEqual(["https://www.handball.net/kalender/team/880099.ics"]);
  expect((await (await page.request.get("/api/teams/1/games/source")).json()).importedAt).toBeTruthy();
  // Gerade abgeglichen: beim nächsten Öffnen kein Abruf, erst wieder nach 7 Tagen
  const hints = page.waitForResponse((r) => r.url().endsWith("/api/coach-hints"));
  await page.reload();
  expect((await (await hints).json()).autoSync).toEqual([]);
  await expect(page.getByRole("heading", { name: /Hallo/ })).toBeVisible();
  expect(fetched).toHaveLength(1);
  await ctx.unroute("https://www.handball.net/kalender/team/*");
  // Aufräumen: Spielplan-Link wieder entfernen (das Spiel bleibt, wird nur nicht mehr abgeglichen)
  await page.request.put("/api/teams/1/games/source", { data: { link: null } });
});

test("Spiele der eigenen Mannschaft auch ohne Nominierung sichtbar, mit Marke „Nominiert“", async () => {
  // In 10 Tagen, damit das Spiel in der Terminübersicht liegt
  const date = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const res = await coach.page.request.post("/api/duties/teams/1/games", { data: { opponent: "HSG Zuschauerdorf", isHome: true, date, time: "11:00" } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  expect((await coach.page.request.put(`/api/events/${id}/squad`, { data: { personIds: [] } })).ok()).toBe(true);

  const { page } = player;
  await page.goto("/");
  const row = page.getByRole("link", { name: /HSG Zuschauerdorf/ });
  await expect(row).toBeVisible();
  // The team sits in the ball, its mark says "Nominated"; home games carry the tag "Heim"
  await expect(row.getByRole("img", { name: /^wT/ })).toBeVisible();
  await expect(row.getByRole("img", { name: "wT, Nominiert" })).toHaveCount(0);
  await expect(row.locator(".home-tag")).toHaveText("Heim");

  const { me } = (await (await page.request.get("/api/session")).json()) as { me: { person: { id: number } } };
  expect((await coach.page.request.put(`/api/events/${id}/squad`, { data: { personIds: [me.person.id] } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("link", { name: /HSG Zuschauerdorf/ }).getByRole("img", { name: "wT, Nominiert" })).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/home-nominated.png`, fullPage: true });
});

test("Meine Termine: Spielerin abonniert den persönlichen Kalender im Profil", async () => {
  const { page } = player;
  await page.goto("/helfer");
  await expect(page.getByRole("button", { name: "Kalender" })).toHaveCount(0);

  await page.goto("/profil");
  const section = page.getByRole("region", { name: "Meine Termine" });
  await expect(section.getByRole("switch", { name: "Spiele" })).toBeVisible();
  await section.getByRole("button", { name: "Im Kalender abonnieren" }).click();
  const sheet = page.getByRole("dialog", { name: "Meine Termine im Kalender" });
  await sheet.getByRole("button", { name: "Link erzeugen" }).click();
  const url = await sheet.locator(".url-box").innerText();
  expect(url).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]+\.ics$/);
  const ics = await (await page.request.get(new URL(url).pathname)).text();
  expect(ics).toContain("SUMMARY:Training");
  expect(ics).toContain("SUMMARY:Spiel");
  expect(ics).toContain("gegen HSG Zuschauerdorf · nominiert");
  await sheet.getByRole("button", { name: "Schließen" }).click();
  await expect(section.getByRole("button", { name: "Kalender-Link" })).toBeVisible();
});

test("Termin anlegen: Trainer wählt Spiel, Admin findet Sondertermine unter Verwaltung und bearbeitet sie", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("link", { name: "Termin anlegen" }).click();
  await page.getByRole("group", { name: "Art des Termins" }).getByRole("button", { name: "Spiel" }).click();
  await page.getByLabel("Gegner oder Turnier").fill("SG Freundschaft");
  await page.getByRole("group", { name: "Heim oder auswärts" }).getByRole("button", { name: "Auswärts" }).click();
  await page.getByRole("button", { name: "Spiel anlegen" }).click();
  await expect(page).toHaveURL(/\/termine\/\d+/);
  await expect(page.getByRole("link", { name: "Kader nominieren" })).toBeVisible();
  // Coach buttons: club colour with a whistle (docs/dev/design.md, Coach buttons); the player sees none
  await expect(page.getByRole("link", { name: "Kader nominieren" })).toHaveClass(/btn-coach/);
  await expect(page.getByRole("button", { name: "Treffpunkt & Infos" })).toHaveClass(/btn-coach/);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/coach-buttons.png`, fullPage: true });
  await player.page.goto(page.url());
  await expect(player.page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(player.page.locator(".btn-coach")).toHaveCount(0);

  const a = admin.page;
  await a.goto("/verwaltung");
  await a.getByRole("link", { name: /Sondertermine und Spiele/ }).click();
  const list = a.getByRole("list", { name: "Sondertermine und Spiele" });
  await expect(list).toContainText("Fotoshooting");
  await list.getByRole("link", { name: /Fotoshooting/ }).click();
  await a.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const sheet = a.getByRole("dialog", { name: "Termin bearbeiten" });
  await sheet.getByLabel("Titel").fill("Mannschaftsfoto");
  await sheet.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(a.getByText("Mannschaftsfoto").first()).toBeVisible();
  // Uhrzeit ändern: dann wird informiert
  await a.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await sheet.getByLabel("Beginn").fill("15:30");
  await sheet.getByRole("button", { name: "Speichern und informieren" }).click();
  await expect(a.getByText(/15:30/).first()).toBeVisible();

  // Trainer: Liste unter Team → Termine
  await page.goto("/team/1");
  await page.getByText("Sondertermine und eigene Spiele").click();
  await expect(page.getByRole("list", { name: "Sondertermine und Spiele" })).toContainText("SG Freundschaft");
});

test("Elternlink: Hinweis für bestehende Zugänge oben", async ({ browser }) => {
  const res = await coach.page.request.post("/api/teams/1/invites", { data: { kind: "parent" } });
  expect(res.ok()).toBe(true);
  const { url } = (await res.json()) as { url: string };
  const guest = await newUser(browser);
  await guest.page.setViewportSize({ width: 390, height: 844 });
  await guest.page.goto(url);
  const box = guest.page.getByRole("region", { name: "Schon einen Elternzugang?" });
  await expect(box).toContainText("Sonst entsteht ein zweiter Zugang");
  await box.getByRole("button", { name: "Code per E-Mail" }).click();
  await expect(box.getByLabel("E-Mail-Adresse deines Zugangs")).toBeVisible();
  await guest.context.close();
});

test("Parent link: warning when the first name is a child's of the team", async ({ browser }) => {
  const res = await coach.page.request.post("/api/teams/1/invites", { data: { kind: "parent" } });
  const { url } = (await res.json()) as { url: string };
  const guest = await newUser(browser);
  const { page } = guest;
  await page.goto(url);
  await expect(page.getByText("Dein eigener Name, nicht der deines Kindes!")).toBeVisible();
  await page.getByLabel("Dein Vorname").fill("Kim");
  await page.getByLabel("Dein Nachname").fill("Probe");
  await expect(page.getByText(/Nicht der Name deines Kindes! Kim heißt auch ein Kind/)).toBeVisible();
  // Passkey and e-mail code wait until the name is confirmed
  await page.getByRole("checkbox", { name: /Kim P\./ }).click();
  await page.getByRole("button", { name: /Passkey einrichten/ }).click();
  await expect(page.getByText("Bitte trag deinen eigenen Vornamen ein, nicht den deines Kindes.")).toBeVisible();
  // Parents can share a first name with their child
  await page.getByRole("button", { name: "Stimmt, ich heiße auch Kim" }).click();
  await expect(page.getByText(/Nicht der Name deines Kindes!/)).toHaveCount(0);
  await page.getByLabel("Dein Vorname").fill("Karla");
  await expect(page.getByText(/Nicht der Name deines Kindes!/)).toHaveCount(0);
  await guest.context.close();
});

test("Elternlink: einmal einrichten, beim erneuten Öffnen direkt zur App", async ({ browser }) => {
  const res = await coach.page.request.post("/api/teams/1/invites", { data: { kind: "parent" } });
  const { url } = (await res.json()) as { url: string };
  const parent = await newUser(browser);
  const { page } = parent;
  await page.goto(url);
  await expect(page.getByText("Diesen Link brauchst du nur einmal.", { exact: false })).toBeVisible();
  await page.getByLabel("Dein Vorname").fill("Karla");
  await page.getByLabel("Dein Nachname").fill("Probe");
  await page.getByRole("checkbox", { name: /Kim P\./ }).click();
  await page.getByRole("button", { name: /Passkey einrichten/ }).click();
  await expect(page.getByText("Geschafft!")).toBeVisible();
  await expect(page.getByText("Diesen Link brauchst du nur einmal.", { exact: false })).toBeVisible();

  // Erneut geöffnet: Hinweis und direkt zur App statt nochmal einrichten
  await page.goto("/");
  await page.goto(url);
  const box = page.getByRole("region", { name: "Schon in der App" });
  await expect(box).toContainText("Du bist als Karla Probe angemeldet und schon in der App.");
  await expect(box).toContainText("Kim ist schon mit dir verknüpft.");
  await expect(page.getByRole("heading", { name: "Weiteres Kind verknüpfen, z. B. ein Geschwisterkind" })).toBeVisible();
  await box.getByRole("button", { name: "Direkt zur App" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Hallo Karla" })).toBeVisible();
  await parent.context.close();

  // Der Begleittext zum Elternlink sagt es auch
  await coach.page.goto("/team/1");
  await coach.page.getByRole("group", { name: "Bereich" }).getByRole("button", { name: "Einladungen" }).click();
  const card = coach.page.getByRole("region", { name: "Elternlink" });
  await card.getByText("Begleittext ansehen").click();
  await expect(card).toContainText("Den Link braucht es nur einmal zum Einrichten.");
});

test("Elternlink für ein Kind: Trainer erstellt ihn bei der Person, er verknüpft nur dieses Kind, für beide Eltern", async ({ browser }) => {
  const { page } = coach;
  await page.goto("/team/1/person/12");
  await page.getByRole("button", { name: "Elternlink für Jana" }).click();
  const sheet = page.getByRole("dialog", { name: "Elternlink für Jana" });
  await expect(sheet).toContainText("Er verknüpft nur Jana; jedes Elternteil richtet damit seinen eigenen Zugang ein.");
  await expect(sheet.getByRole("button", { name: "Mit Text teilen" })).toBeVisible();
  const url = (await sheet.locator(".url-box").textContent())!.trim();
  expect(url).toContain("/einladung#");

  const parent = await newUser(browser);
  const p = parent.page;
  await p.goto(url);
  await expect(p.getByText("Du richtest einen Elternzugang für Jana in der wT ein.")).toBeVisible();
  await expect(p.getByRole("heading", { name: "Dein Kind", exact: true })).toBeVisible();
  await expect(p.getByRole("checkbox", { name: /Jana P\./ })).toHaveAttribute("aria-checked", "true");
  await expect(p.getByRole("checkbox", { name: /Kim P\./ })).toHaveCount(0);
  await p.getByLabel("Dein Vorname").fill("Nora");
  await p.getByLabel("Dein Nachname").fill("Probe");
  await p.getByRole("button", { name: /Passkey einrichten/ }).click();
  await expect(p.getByText("Geschafft!")).toBeVisible();
  await parent.context.close();

  // The second parent can use the same link; the coach sees the first parent at the child
  const second = await newUser(browser);
  await second.page.goto(url);
  await expect(second.page.getByText("Du richtest einen Elternzugang für Jana in der wT ein.")).toBeVisible();
  await second.context.close();
  await page.goto("/team/1/person/12");
  await expect(page.getByRole("region", { name: "Eltern" })).toContainText("Nora Probe");
});

test("Spielerlink angemeldet: keine Namensauswahl, nur direkt zur App; ungültiger Link ebenso", async () => {
  const res = await coach.page.request.post("/api/teams/1/invites", { data: { kind: "player" } });
  const { url } = (await res.json()) as { url: string };
  const { page } = player;
  await page.goto("/");
  await page.goto(url);
  const box = page.getByRole("region", { name: "Schon in der App" });
  await expect(box).toContainText("schon in der App");
  await expect(box).toContainText("im Profil abmelden");
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Passkey einrichten/ })).toHaveCount(0);

  await page.goto("/");
  await page.goto("/einladung#gibt-es-nicht");
  await expect(page.getByRole("region", { name: "Schon in der App" })).toContainText("neuen Elternlink");
  await expect(page.getByRole("link", { name: "Zur Anmeldung" })).toHaveCount(0);
  await page.getByRole("button", { name: "Direkt zur App" }).click();
  await expect(page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();
});

test("Einladungen: Begleittext zum Spielerlink mit Hinweis auf einmalige Nutzung", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("group", { name: "Bereich" }).getByRole("button", { name: "Einladungen" }).click();
  const card = page.getByRole("region", { name: "Spielerlink" });
  await card.getByText("Begleittext ansehen").click();
  await expect(card).toContainText("nur einmal, für sich selbst");
  await expect(card).toContainText("/einladung#");
  await expect(card.getByRole("button", { name: "Mit Text teilen" })).toBeVisible();
  // Trainer haben keinen Reiter Hilfe, der Weg führt über die Team-Seite
  await page.getByRole("link", { name: /Hilfe und Feedback/ }).click();
  await expect(page.getByRole("heading", { name: "Hilfe und Feedback" })).toBeVisible();
});

test("Gruppen: Admin legt eine Gruppe an, der Unterschied zur Mannschaft ist erklärt, Mitglied sieht den Gruppenchat", async () => {
  const { page } = admin;
  await page.goto("/verwaltung");
  await page.getByRole("link", { name: /Gruppen/ }).click();
  await expect(page.getByText("Gruppe oder Mannschaft?")).toBeVisible();
  await page.getByRole("button", { name: "Gruppe anlegen" }).click();
  const sheet = page.getByRole("dialog", { name: "Neue Gruppe" });
  await sheet.getByLabel("Name").fill("Trainerteam");
  await sheet.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Gruppe · nur Chat und Sondertermine")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trainerteam" })).toBeVisible();
  // Keine Mannschafts-Funktionen
  await expect(page.getByRole("link", { name: "Trainingspläne" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sondertermin anlegen" })).toBeVisible();
  // Eltern sind erst dabei, wenn ein Admin sie einbezieht (z. B. eine Jugendgruppe), und lassen sich wieder ausschließen
  const parents = page.getByRole("switch", { name: /Eltern einbinden/ });
  await expect(parents).toHaveAttribute("aria-checked", "false");
  // Switches save at once and say so right at the switch
  await parents.click();
  await expect(parents).toHaveAttribute("aria-checked", "true");
  await expect(parents.getByText("Gespeichert")).toBeVisible();
  await parents.click();
  await page.getByRole("dialog", { name: "Ohne Eltern weiterführen?" }).getByRole("button", { name: "Ohne Eltern" }).click();
  await expect(parents).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "Mitglieder hinzufügen" }).click();
  const add = page.getByRole("dialog", { name: "Mitglieder Trainerteam" });
  await add.getByLabel("Person suchen").fill("Theo");
  await add.locator(".list-row", { hasText: "Theo Trainer" }).getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText("Theo ist jetzt Mitglied in Trainerteam.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Mitglieder" })).toContainText("Theo Trainer");

  // Mannschaftsliste zeigt keine Gruppen
  await page.goto("/verwaltung/mannschaften");
  await expect(page.locator(".list-row", { hasText: "Trainerteam" })).toHaveCount(0);

  await coach.page.goto("/chat");
  await expect(coach.page.getByText("Gruppenchat Trainerteam")).toBeVisible();
});

test("Personen: letzte Aktivität anzeigen, nach Aktivität filtern und sortieren", async () => {
  const { page } = admin;
  await page.request.post("/api/admin/persons", { data: { firstName: "Uwe", lastName: "Ohnezugang" } });
  await page.goto("/verwaltung/personen");
  await expect(page.getByRole("button", { name: /Ada Admin/ })).toContainText("heute aktiv");
  await expect(page.getByRole("button", { name: /Uwe Ohnezugang/ })).toContainText("kein Zugang");

  await page.getByLabel("Aktivität").selectOption({ label: "Kein Zugang" });
  await expect(page.getByRole("button", { name: /Uwe Ohnezugang/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ada Admin/ })).toHaveCount(0);

  await page.getByLabel("Aktivität").selectOption({ label: "Alle" });
  await page.getByLabel("Sortierung").selectOption({ label: "Zuletzt aktiv" });
  // Personen ohne Zugang stehen am Ende
  await expect(page.locator("ul.list > li").last()).toContainText("kein Zugang");

  await page.getByRole("button", { name: /Ada Admin/ }).click();
  await expect(page.getByRole("dialog", { name: "Ada Admin" })).toContainText("Zuletzt aktiv:");
});

test("Fahrgemeinschaft: Trainer fährt, Spielerin bucht, Trainer trägt eine Mitfahrerin ein", async () => {
  const date = new Date(Date.now() + 12 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const res = await coach.page.request.post("/api/duties/teams/1/games", { data: { opponent: "SG Fernweh", isHome: false, date, time: "15:00" } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  const { me } = (await (await player.page.request.get("/api/session")).json()) as { me: { person: { id: number } } };
  expect((await coach.page.request.put(`/api/events/${id}/squad`, { data: { personIds: [me.person.id, 12] } })).ok()).toBe(true);

  // Trainer bietet zwei Plätze an
  await coach.page.goto(`/termine/${id}`);
  const coachCard = coach.page.getByRole("region", { name: "Fahrgemeinschaften" });
  await coachCard.getByRole("button", { name: "Ich fahre" }).click();
  await coach.page.getByRole("button", { name: "Ein Platz mehr" }).click();
  await coach.page.getByRole("button", { name: "Plätze anbieten" }).click();
  await expect(coachCard.getByText("0 von 2 Plätze belegt")).toBeVisible();

  // Spielerin bucht direkt
  const { page } = player;
  await page.goto(`/termine/${id}`);
  const card = page.getByRole("region", { name: "Fahrgemeinschaften" });
  await expect(card.getByText("Theo T.")).toBeVisible();
  await card.getByRole("button", { name: "Ich brauche eine Mitfahrgelegenheit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mitfahren" }).click();
  await expect(card.getByText("fährst bei Theo T. mit (1 Platz)")).toBeVisible();

  // Trainer trägt Jana als Suchende ein, die Spielerin sieht sie unter „Suchen noch“
  await coach.page.reload();
  await expect(coachCard.getByText("1 von 2 Plätze belegt: Ida P.")).toBeVisible();
  await coachCard.getByRole("button", { name: "Mitfahrer eintragen" }).click();
  const dialog = coach.page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Jana P." }).click();
  await dialog.getByRole("button", { name: "Warten, bis jemand Plätze anbietet" }).click();
  await page.reload();
  await expect(card.getByText("Jana P.")).toBeVisible();
});

test("Verein: Admin ändert Name und Kürzel, Verwaltung und Datenschutz zeigen sie", async () => {
  const { page } = admin;
  await page.goto("/verwaltung");
  await page.getByRole("link", { name: /^Verein/ }).click();
  await page.getByLabel("Name des Vereins").fill("SV Beispielhausen 1920");
  await page.getByLabel("Kurzname").fill("SVB Handball");
  await page.getByLabel("Kürzel").fill("SVB");
  // Without a legal notice admins see a warning
  // Every card saves on its own: the name with its button, the links with theirs
  await page.getByRole("button", { name: "Namen speichern" }).click();
  await expect(page.getByText("Gespeichert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Namen speichern" })).toHaveCount(0);
  await page.getByLabel("Link zum Impressum").fill("");
  const saveLinks = page.getByRole("button", { name: "Links und Kontakt speichern" });
  if (await saveLinks.isVisible()) await saveLinks.click();
  await page.goto("/verwaltung");
  await expect(page.getByRole("alert").filter({ hasText: "Impressum oder Datenschutzerklärung deines Vereins fehlen" })).toBeVisible();
  await page.getByRole("link", { name: "Links eintragen" }).click();
  await page.getByLabel("Link zum Impressum").fill("https://example.org/impressum");
  await page.getByLabel("Link zur Datenschutzerklärung").fill("https://example.org/datenschutz");
  await page.getByRole("button", { name: "Links und Kontakt speichern" }).click();
  await expect(page.getByText("Gespeichert")).toBeVisible();
  await page.goto("/verwaltung");
  await expect(page.getByRole("heading", { name: "SV Beispielhausen 1920" })).toBeVisible();
  await expect(page.getByText("Impressum oder Datenschutzerklärung deines Vereins fehlen")).toHaveCount(0);
  // Both links under every screen
  const footer = page.locator("footer.app-legal");
  await expect(footer.getByRole("link", { name: "Impressum" })).toHaveAttribute("href", "https://example.org/impressum");
  await expect(footer.getByRole("link", { name: "Datenschutzerklärung" })).toHaveAttribute("href", "https://example.org/datenschutz");
  await page.goto("/datenschutz");
  await expect(page.locator("main").getByRole("link", { name: "Datenschutzerklärung" })).toHaveAttribute("href", "https://example.org/datenschutz");
});

test("Sprache: Spielerin stellt auf Englisch um und wieder zurück", async () => {
  const { page } = player;
  await page.goto("/profil");
  await page.getByRole("combobox", { name: "Sprache" }).selectOption("en");
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hi Ida" }).or(page.getByRole("heading", { name: /Ida/ }))).toBeVisible();
  await page.goto("/profil");
  await page.getByRole("combobox", { name: "Language" }).selectOption("de");
  // exact: "Profil" also matches "Profile", and the test would end before the reload
  await expect(page.getByRole("link", { name: "Profil", exact: true })).toBeVisible();
});

test("Sprache per Link (?lang=en): einmal laden, kein Hin und Her mit der Sprache des Kontos", async () => {
  const { page } = player;
  // The account says German (as the demo accounts do), the link says English
  expect((await page.request.put("/api/me/locale", { data: { locale: "de" } })).ok()).toBe(true);
  let loads = 0;
  const count = (frame: import("@playwright/test").Frame) => {
    if (frame === page.mainFrame()) loads++;
  };
  page.on("framenavigated", count);
  await page.goto("/?lang=en");
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  await page.waitForTimeout(3000);
  page.off("framenavigated", count);
  // The address no longer carries the parameter (pushState changes count too, so allow one replace)
  expect(page.url()).not.toContain("lang=");
  expect(loads).toBeLessThanOrEqual(2);
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  // The link is the newer choice: it went to the account
  expect((await (await page.request.get("/api/session")).json()).me.locale).toBe("en");
  await page.goto("/profil");
  await page.getByRole("combobox", { name: "Language" }).selectOption("de");
  await expect(page.getByRole("link", { name: "Profil", exact: true })).toBeVisible();
});

test("Spielplan aus einer Tabelle: Vorschau und Anlegen", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const section = page.getByRole("region", { name: "Spiele übernehmen" });
  await section.getByLabel("Spielplan als Tabelle").fill("Datum;Uhrzeit;Gegner;Heim;Halle\n05.05.2099;15:00;SG Tabellenstadt;A;Halle West");
  await section.getByRole("button", { name: "Vorschau" }).click();
  await expect(section.getByText("Auswärtsspiel bei SG Tabellenstadt")).toBeVisible();
  await section.getByRole("button", { name: "1 Spiel anlegen" }).click();
  await expect(page.getByText("1 Spiel angelegt.")).toBeVisible();
});

test("Einrichtungsassistent: Admin geht alle Schritte durch", async () => {
  const { page } = admin;
  await page.goto("/verwaltung/einrichtung");
  await expect(page.getByText("Einrichtung · Schritt 1 von 9")).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("heading", { name: "Dein Verein" })).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("heading", { name: "Sportart und Saison" })).toBeVisible();
  await expect(page.getByText("Aktuelle Saison:")).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("heading", { name: "Funktionen" })).toBeVisible();
  // A switched-off module stays in the list and can be switched on again
  const switches = await page.getByRole("switch").count();
  for (const name of [/Fahrgemeinschaften/, /handball4all/]) {
    const sw = page.getByRole("switch", { name });
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch")).toHaveCount(switches);
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
  }
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("heading", { name: "E-Mail", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Überspringen" }).click();
  await expect(page.getByRole("heading", { name: "Erste Mannschaften" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("wE2");
  await page.getByRole("button", { name: "Mannschaft anlegen" }).click();
  await expect(page.getByText("Mannschaft angelegt")).toBeVisible();
  await expect(page.locator(".team-badge", { hasText: "wE2" })).toBeVisible();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  // First people: a coach for the new team, with a personal link
  await expect(page.getByRole("heading", { name: "Erste Personen" })).toBeVisible();
  await page.getByLabel("Vorname").fill("Paula");
  await page.getByLabel("Nachname").fill("Pfiff");
  await page.getByRole("group", { name: "Trainer von" }).getByRole("button", { name: "wE2" }).click();
  await page.getByRole("button", { name: "Person anlegen" }).click();
  const paula = page.getByRole("list", { name: "Erste Personen" }).getByRole("listitem").filter({ hasText: "Paula Pfiff" });
  await expect(paula).toContainText("Trainer von wE2");
  await paula.getByRole("button", { name: "Persönlichen Link erzeugen" }).click();
  await expect(paula.locator(".url-box")).toContainText("/einladung#");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datenschutz" })).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("heading", { name: "Die App ist eingerichtet" })).toBeVisible();
  await page.goto("/verwaltung");
  await expect(page.getByText("Einrichtung nicht abgeschlossen")).toHaveCount(0);
  // Mit dem Abschluss startet der Verein: Was ist neu zählt ab heute und endet mit der Geburtsanzeige
  await page.goto("/hilfe/neu");
  await expect(page.getByRole("region", { name: "Start der App" })).toContainText("Die App ist geboren");
  await expect(page.getByText("Erste Version von Kabine.")).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/was-ist-neu.png`, fullPage: true });
  await page.goto("/verwaltung");
  // Opened again after the last step: from the start, and the last step offers to start over
  await page.getByRole("link", { name: /Einrichtungsassistent/ }).click();
  await expect(page.getByText("Einrichtung · Schritt 1 von 9")).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("kabine.setup.step", "7"));
  await page.reload();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("heading", { name: "Die App ist eingerichtet" })).toBeVisible();
  await page.getByRole("button", { name: "Noch einmal von vorn" }).click();
  await expect(page.getByText("Einrichtung · Schritt 1 von 9")).toBeVisible();
});

test("Spielerliste: Trainer übernimmt Spieler aus einer Tabelle, Einladungen zeigen, wer noch fehlt", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("button", { name: "Kader", exact: true }).click();
  const roster = page.getByRole("region", { name: "Spielerinnen und Spieler" });
  await roster.getByRole("button", { name: "Hinzufügen" }).click();
  const sheet = page.getByRole("dialog", { name: "Spieler hinzufügen" });
  await sheet.getByRole("button", { name: "Aus einer Liste" }).click();
  await sheet.getByLabel("Spielerliste").fill("Vorname\tNachname\tJahrgang\nListe\tEins\t2014\nListe\tZwei\t2015\nKaputt\tDrei\t3015");
  await sheet.getByRole("button", { name: "Vorschau" }).click();
  await expect(sheet.getByText("Zeile 4: „3015“ ist kein Jahrgang")).toBeVisible();
  await expect(sheet.getByText("wird angelegt")).toHaveCount(2);
  await sheet.getByRole("button", { name: "2 Spieler anlegen" }).click();
  await expect(page.getByText("2 Spieler angelegt")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(roster).toContainText("Liste Eins");
  await page.getByRole("button", { name: "Einladungen" }).click();
  const reach = page.getByRole("region", { name: "Erreichbarkeit" });
  await expect(reach).toContainText("Liste Eins");
  await expect(reach).toContainText("ohne Zugang");
});

test("Betreuer: Trainer legt eine Physiotherapeutin an und erzeugt ihren Zugangslink", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("button", { name: "Kader", exact: true }).click();
  const staff = page.getByRole("region", { name: "Betreuer" });
  await staff.getByRole("button", { name: "Hinzufügen" }).click();
  const sheet = page.getByRole("dialog", { name: "Betreuer hinzufügen" });
  await sheet.getByLabel("Vorname").fill("Paula");
  await sheet.getByLabel("Nachname").fill("Physio");
  await sheet.getByRole("button", { name: "Hinzufügen" }).click();
  await staff.getByRole("button", { name: /Paula Physio/ }).click();
  await page.getByRole("button", { name: /Einladungslink/ }).click();
  await expect(page.locator(".url-box")).toContainText("http");
});

test("Ferienplan: Trainingspause erscheint als Hinweis in der Terminübersicht", async () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const res = await coach.page.request.post("/api/teams/1/plans", { data: { name: "Hallensperrung", kind: "holiday", validFrom: day(3), validTo: day(5) } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  const { page } = player;
  await page.goto("/");
  const note = page.getByRole("note").filter({ hasText: "Hallensperrung" });
  await expect(note).toContainText("kein Training für wT");
  expect((await coach.page.request.delete(`/api/plans/${id}`)).ok()).toBe(true);
});

test("Optionales Mittrainieren: Spielerin macht freiwillig mit, Trainer stellt den Termin auf Pflicht", async () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const weekday = ((new Date(`${day(2)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const { id: other } = await (await admin.page.request.post("/api/teams", { data: { name: "wO", ageClassCode: "wD", level: 3 } })).json();
  const { me } = (await (await coach.page.request.get("/api/session")).json()) as { me: { person: { id: number } } };
  expect((await admin.page.request.post(`/api/teams/${other}/members`, { data: { personId: me.person.id, role: "coach" } })).ok()).toBe(true);
  const plan = await coach.page.request.post(`/api/teams/${other}/plans`, {
    data: {
      name: "Zusatztraining",
      kind: "regular",
      validFrom: day(1),
      validTo: day(3),
      rules: [{ weekday, startsAt: "10:00", endsAt: "11:30", locationId: 1, teamIds: [1], optionalTeamIds: [1] }],
    },
  });
  expect(plan.ok()).toBe(true);
  const { id: planId } = (await plan.json()) as { id: number };

  const { page } = player;
  await page.goto("/");
  const row = page.locator("a.event-row", { hasText: "10:00" }).first();
  await expect(row).toContainText("Optional");
  await row.click();
  await page.getByRole("button", { name: "Ich mache mit" }).click();
  await expect(page.getByText("Zugesagt").first()).toBeVisible();
  await page.getByRole("button", { name: "Doch nicht" }).click();
  await expect(page.getByRole("button", { name: "Ich mache mit" })).toBeVisible();
  const eventUrl = page.url();

  await coach.page.goto(eventUrl);
  await expect(coach.page.getByRole("region", { name: "Optional, nicht zugesagt" })).toContainText("Ida");
  const teams = coach.page.getByRole("region", { name: "Mannschaften bei diesem Training" });
  await teams.getByRole("group", { name: "Teilnahme für wT" }).getByRole("button", { name: "Pflicht" }).click();
  await expect(coach.page.getByRole("region", { name: "Abgesagt" })).toContainText("Ida");

  expect((await coach.page.request.delete(`/api/plans/${planId}`)).ok()).toBe(true);
  await admin.page.request.delete(`/api/teams/${other}/members/${me.person.id}?role=coach`);
  await admin.page.request.delete(`/api/teams/${other}`);
});

test("Einrichtung: Mannschaften, Trainer und Spielerinnen aus Listen übernehmen", async () => {
  const { page } = admin;
  await page.goto("/");
  await page.evaluate(() => sessionStorage.setItem("kabine.setup.step", "5"));
  await page.goto("/verwaltung/einrichtung");
  const wtBefore = ((await (await page.request.get("/api/teams")).json()) as { teams: { name: string; players: number }[] }).teams.find((x) => x.name === "wT")!.players;
  await page.getByRole("button", { name: "Stattdessen aus Listen übernehmen" }).click();
  const kader = "Kader Saison 2026/27;;;\nMannschaft;Name;Jg.;Telefon\nwC1;Muster, Lea;12;0123 45\nwC1;Lena Beispiel (2013);;\nwT;Probe, Ida;14;\n";
  const trainer = "Vorname;Nachname;Mannschaft\nTina;Test;wC1\n;Summe;wC1\n";
  await page.getByLabel("Dateien").setInputFiles([
    { name: "kader.csv", mimeType: "text/csv", buffer: Buffer.from(kader) },
    { name: "trainer.csv", mimeType: "text/csv", buffer: Buffer.from(trainer) },
    // Two sheets: one per team without a team column, one with coaches; dates of birth as Excel dates
    { name: "listen.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync("e2e/files/listen.xlsx") },
  ]);
  await expect(page.getByRole("region", { name: "listen.xlsx · wC2" }).getByLabel("Mannschaft für alle in dieser Liste")).toHaveValue("wC2");
  await expect(page.getByRole("region", { name: "listen.xlsx · wC2" }).getByLabel("Spalte Bemerkung")).toHaveValue("ignore");
  await expect(page.getByRole("region", { name: "listen.xlsx · wC2" }).getByLabel("Spalte Geburtsdatum")).toHaveValue("birthYear");
  await expect(page.getByRole("region", { name: "listen.xlsx · wC2" })).toContainText("2014 · 2013 (nur der Jahrgang wird übernommen)");
  const kaderCard = page.getByRole("region", { name: "kader.csv" });
  // Nach dem Hinzufügen springt die Seite zur ersten neuen Liste
  await expect(page.getByText("4 Listen hinzugefügt: Spalten prüfen")).toBeVisible();
  await expect(kaderCard).toBeInViewport();
  await expect(kaderCard.getByLabel("Spalte Telefon")).toHaveValue("ignore");
  await expect(kaderCard).not.toContainText("0123 45");
  await expect(page.getByRole("region", { name: "trainer.csv" }).getByLabel("Alle in dieser Liste sind")).toHaveValue("coach");
  await page.getByLabel("Oder eine Tabelle einfügen").fill("Name\tJahrgang\nLea Muster\t2012\nLena Beispel\t2013");
  await page.getByRole("button", { name: "Eingefügte Tabelle hinzufügen" }).click();
  await page.getByRole("button", { name: "10 Zeilen lesen" }).click();

  // Ähnlicher Name in der eingefügten Liste: eine Frage, danach ist sie eine Person
  const questions = page.getByRole("region", { name: "Fragen" });
  await expect(questions).toContainText("Dieselbe Person?");
  await questions.getByRole("button", { name: "Ja, als Lena Beispiel" }).click();
  await expect(questions).toHaveCount(0);
  const teams = page.getByRole("region", { name: "Mannschaften", exact: true });
  for (const select of await teams.getByLabel("Altersklasse").all()) await expect(select).toHaveValue("wC");
  await expect(teams).toContainText("gibt es schon");
  // Eine Zeile nur mit Nachnamen (Summenzeile) hält die Übernahme auf, bis sie weggelassen ist
  const noFirst = page.getByRole("region", { name: "Ohne Vorname" });
  await expect(noFirst).toContainText("Summe");
  await expect(page.getByRole("button", { name: "8 Personen übernehmen" })).toBeDisabled();
  await noFirst.getByRole("button", { name: "Weglassen" }).click();
  await page.getByRole("button", { name: "7 Personen übernehmen" }).click();

  // Weiter bei den ersten Personen: die Trainerin aus der Liste mit ihrem persönlichen Link
  await expect(page.getByText("Tina Test")).toBeVisible();
  const list = (await (await page.request.get("/api/teams")).json()) as { teams: { id: number; name: string; players: number; coaches: number }[] };
  const wc1 = list.teams.find((x) => x.name === "wC1")!;
  expect(wc1).toMatchObject({ players: 2, coaches: 1 });
  expect(list.teams.find((x) => x.name === "wC2")).toMatchObject({ players: 2, coaches: 1 });
  // Ida Probe was in wT already: found again, not added twice
  expect(list.teams.find((x) => x.name === "wT")!.players).toBe(wtBefore);
  await expect(page.getByText("Rita Rahmen")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("kabine.listImport"))).toBeNull();
});

test("Verwaltung → Import: Spieler in eine vorhandene Mannschaft übernehmen, die neue Mannschaft ist gleich im Chat", async () => {
  const { page } = admin;
  // The chat list is loaded before the import and must not stay as it was (no page reload in between)
  await page.goto("/chat");
  await expect(page.getByText("wE9")).toHaveCount(0);
  await page.getByRole("link", { name: "Verwaltung" }).click();
  await page.getByRole("link", { name: /^Import \/ Wiederherstellen/ }).click();
  await expect(page.getByRole("heading", { name: "Import / Wiederherstellen" })).toBeVisible();
  await page.getByRole("button", { name: "Listen übernehmen" }).click();
  // .xls and .ods cannot be read: the admin is asked to save the file as .xlsx
  await page.getByLabel("Dateien").setInputFiles({ name: "kader.ods", mimeType: "application/vnd.oasis.opendocument.spreadsheet", buffer: Buffer.from("x") });
  await expect(page.getByText("kader.ods: bitte zuerst als .xlsx oder .csv speichern")).toBeVisible();
  await page.getByLabel("Oder eine Tabelle einfügen").fill("Name\tJahrgang\tMannschaft\tFunktion\nOle Beispiel\t2014\twT\t\nAda Admin\t\twE9\tTrainerin");
  await page.getByRole("button", { name: "Eingefügte Tabelle hinzufügen" }).click();
  await page.getByRole("button", { name: "2 Zeilen lesen" }).click();
  await expect(page.getByRole("region", { name: "Mannschaften", exact: true })).toContainText("gibt es schon");
  await page.getByRole("button", { name: "2 Personen übernehmen" }).click();
  await expect(page).toHaveURL(/\/verwaltung\/personen$/);
  await expect(page.getByText("Ole Beispiel")).toBeVisible();
  await page.getByRole("link", { name: "Chat" }).click();
  await expect(page.getByText("wE9").first()).toBeVisible();
});

test("Verwaltung → Import: eigener Export zurück, alles ist schon da", async () => {
  const { page } = admin;
  const exported = await page.request.get("/api/admin/export");
  expect(exported.ok()).toBe(true);
  const before = ((await (await page.request.get("/api/teams")).json()) as { teams: unknown[] }).teams.length;
  await page.goto("/verwaltung/import");
  await page.getByRole("button", { name: "Export-Datei wählen" }).click();
  await page.getByLabel("Export-Datei (.json)").setInputFiles({ name: "kabine-export.json", mimeType: "application/json", buffer: await exported.body() });
  const what = page.getByRole("region", { name: "Was übernommen wird" });
  await expect(what.getByRole("checkbox")).toHaveCount(8);
  await page.getByRole("button", { name: "Alles wiederherstellen" }).click();
  const result = page.getByRole("region", { name: "Ergebnis" });
  await expect(result).toContainText("Wiederherstellung abgeschlossen");
  await expect(result).toContainText("0 neu");
  expect(((await (await page.request.get("/api/teams")).json()) as { teams: unknown[] }).teams.length).toBe(before);
});

test("Kinder in der App: Altersklasse ohne eigenen Zugang, Spielerin sieht nur noch, Trainer schränkt den Chat ein", async () => {
  const ages = admin.page;
  await ages.goto("/verwaltung/altersklassen");
  await ages.getByRole("checkbox", { name: "Eigener Zugang weibliche D-Jugend" }).uncheck();
  await expect(ages.getByRole("combobox", { name: "Chat weibliche D-Jugend" })).toBeDisabled();
  await ages.getByRole("button", { name: "Speichern" }).click();
  await expect(ages.getByText("Altersklassen gespeichert.")).toBeVisible();

  await coach.page.goto("/team/1");
  await coach.page.getByRole("group", { name: "Bereich" }).getByRole("button", { name: "Einladungen" }).click();
  await expect(coach.page.getByText("Kinder in wT haben keinen eigenen Zugang, deshalb gibt es keinen Spielerlink.", { exact: false })).toBeVisible();

  // Ida hat schon einen Zugang: sie sieht ihre Termine, antwortet aber nicht mehr selbst
  await player.page.goto("/");
  await expect(player.page.getByText("In dieser Mannschaft übernehmen das deine Eltern.").first()).toBeVisible();

  // Zurück auf eigenen Zugang, damit nachfolgende Tests unverändert laufen
  await ages.reload();
  await ages.getByRole("checkbox", { name: "Eigener Zugang weibliche D-Jugend" }).check();
  await ages.getByRole("button", { name: "Speichern" }).click();
  await expect(ages.getByText("Altersklassen gespeichert.")).toBeVisible();

  // Der Trainer lässt die Kinder seiner Mannschaft im Chat nur mitlesen, dann wieder wie die Altersklasse
  await coach.page.goto("/team/1");
  await coach.page.getByRole("group", { name: "Bereich" }).getByRole("button", { name: "Einstellungen" }).click();
  const section = coach.page.getByRole("region", { name: "Kinder in der App" });
  await section.getByRole("combobox", { name: "Chat wT" }).selectOption("read");
  await expect(section.getByText("Gespeichert")).toBeVisible();
  await player.page.goto("/chat");
  await expect(player.page.getByText("Schreiben übernehmen in dieser Mannschaft die Eltern.", { exact: false }).first()).toBeVisible();
  await section.getByRole("button", { name: "Wie für die Altersklasse" }).click();
  await expect(coach.page.getByText("Wieder wie für die Altersklasse eingestellt.")).toBeVisible();
});

test("Hinweise für Trainer: Treffpunkt fehlt, Eintragen öffnet das Spiel mit dem Treffpunkt", async () => {
  const { page } = coach;
  const date = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  await page.goto("/team/1");
  await page.getByRole("link", { name: "Termin anlegen" }).click();
  await page.getByRole("group", { name: "Art des Termins" }).getByRole("button", { name: "Spiel" }).click();
  await page.getByLabel("Gegner oder Turnier").fill("HSG Hinweisstadt");
  await page.getByLabel("Datum").fill(date);
  await page.getByLabel("Spielbeginn").fill("15:00");
  await page.getByRole("button", { name: "Spiel anlegen" }).click();
  await expect(page).toHaveURL(/\/termine\/\d+/);

  await page.goto("/");
  const hints = page.getByRole("region", { name: "Zu tun für deine Mannschaften" });
  await expect(hints).toContainText("Treffpunkt fehlt");
  await expect(hints).toContainText("HSG Hinweisstadt");
  // Spielerinnen bekommen keine Hinweise
  await player.page.goto("/");
  await expect(player.page.getByRole("heading", { name: /Hallo/ })).toBeVisible();
  await expect(player.page.getByRole("region", { name: "Zu tun für deine Mannschaften" })).toHaveCount(0);

  await hints.getByRole("link", { name: "Eintragen" }).click();
  const sheet = page.getByRole("dialog", { name: "Treffpunkt & Infos" });
  await sheet.getByLabel("Treffpunkt", { exact: true }).fill("Parkplatz Halle");
  await sheet.getByLabel("Treffen um").fill("14:00");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/Gespeichert/)).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Hallo/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Zu tun für deine Mannschaften" })).toHaveCount(0);
});

test("Verwaltung → Spielpläne: Erinnerung einstellen, Stand aller Mannschaften", async () => {
  const { page } = admin;
  const link = "https://www.handball4all.de/home/portal/baden-wuerttembergischer-hv#/league?ogId=216&lId=555&tId=999";
  expect((await page.request.put("/api/teams/1/games/source", { data: { link } })).ok()).toBe(true);
  await page.goto("/verwaltung");
  // handball4all and handball.net are both on: the page is about every source
  await page.getByRole("link", { name: /Spielpläne.*Spielplanabgleich und Erinnerung/ }).click();
  await expect(page).toHaveURL(/\/verwaltung\/spielplan$/);
  await expect(page.getByRole("heading", { name: "Spielpläne", level: 1 })).toBeVisible();
  const reminder = page.getByRole("group", { name: "Trainer erinnern nach" });
  await expect(reminder.getByRole("button", { name: "15 Tage" })).toHaveAttribute("aria-pressed", "true");
  await reminder.getByRole("button", { name: "Aus" }).click();
  await expect(page.getByText("Gespeichert")).toBeVisible();
  await expect(reminder.getByRole("button", { name: "Aus" })).toHaveAttribute("aria-pressed", "true");
  await reminder.getByRole("button", { name: "30 Tage" }).click();
  await expect(reminder.getByRole("button", { name: "30 Tage" })).toHaveAttribute("aria-pressed", "true");
  const teams = page.getByRole("region", { name: "Mannschaften" });
  await expect(teams.getByText(/handball4all · Noch nicht abgeglichen/)).toBeVisible();
  await expect(teams.getByText("Trainer werden erinnert")).toBeVisible();
  await expect(teams.getByRole("button", { name: "Jetzt abgleichen" })).toBeVisible();
  await expect(teams.getByRole("link", { name: "Link ändern" })).toBeVisible();
  await expect(teams.getByRole("link", { name: "Link hinterlegen" }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/admin-fixture-sync.png", fullPage: true });
  await reminder.getByRole("button", { name: "15 Tage" }).click();
  await expect(reminder.getByRole("button", { name: "15 Tage" })).toHaveAttribute("aria-pressed", "true");
  expect((await page.request.put("/api/teams/1/games/source", { data: { link: null } })).ok()).toBe(true);
});

test("Chat: Anzahl ungelesener Nachrichten und Trennlinie „Neue Nachrichten“", async () => {
  // Die Spielerin war schon im Chat und ist jetzt woanders
  await player.page.goto("/chat/1");
  await expect(player.page.getByPlaceholder("Nachricht an wT")).toBeVisible();
  await player.page.goto("/");
  await coach.page.goto("/chat/1");
  await coach.page.getByPlaceholder("Nachricht an wT").fill("Neu für die Trennlinie");
  await coach.page.getByRole("button", { name: "Senden" }).click();
  await expect(coach.page.getByText("Neu für die Trennlinie")).toHaveCount(1);
  // Über der eigenen Nachricht steht keine Trennlinie (über älteren fremden kann eine stehen)
  await expect(coach.page.locator(".unread-divider + *")).not.toContainText("Neu für die Trennlinie");

  // Mit nur einem Chat leitet die Liste direkt weiter; die Zahl kommt vom Server
  const rooms = await (await player.page.request.get("/api/chat/rooms")).json();
  expect(rooms.rooms.find((r: { teamId: number }) => r.teamId === 1)).toMatchObject({ unread: true, unreadCount: 1 });
  await player.page.goto("/chat/1");
  const divider = player.page.getByRole("separator", { name: "Neue Nachrichten" });
  await expect(divider).toBeVisible();
  await expect(player.page.locator(".unread-divider + *")).toContainText("Neu für die Trennlinie");
  if (process.env.E2E_SHOTS) await player.page.screenshot({ path: `${process.env.E2E_SHOTS}/chat-divider.png` });
  // Gelesen und erneut geöffnet: keine Trennlinie mehr
  await player.page.goto("/");
  await player.page.goto("/chat/1");
  await expect(player.page.getByText("Neu für die Trennlinie")).toBeVisible();
  await expect(divider).toHaveCount(0);
});

test("Neuigkeiten für Trainer: Hinweis mit Beispielknopf, Spielerin sieht nichts", async ({ browser }) => {
  // Nach einem Update hätte der Server die Trainer-Hinweise der neuen Version geliefert (worker/domain/news.ts);
  // hier wird nur die Darstellung geprüft. Ohne Service Worker, damit page.route die Sitzung sieht.
  const context = await browser.newContext({ storageState: await coach.context.storageState(), serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/api/session", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.me.news = {
      version: "0.7.0",
      entries: [{ version: "0.7.0", date: "2026-11-07", items: [], coachItems: [{ text: "Was nur du als Trainer tun kannst, ist jetzt markiert.", example: "coach-buttons" }] }],
      newModules: [],
    };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  const card = page.getByRole("region", { name: "Neuigkeiten" });
  await expect(card.getByText("Für Trainer")).toBeVisible();
  await expect(card.getByText("Was nur du als Trainer tun kannst, ist jetzt markiert.")).toBeVisible();
  await expect(card.locator(".news-example .btn-coach")).toBeVisible();
  if (process.env.E2E_SHOTS) await card.screenshot({ path: `${process.env.E2E_SHOTS}/coach-news.png` });
  await context.close();
  await player.page.goto("/");
  await expect(player.page.getByRole("heading", { name: /Hallo/ })).toBeVisible();
  await expect(player.page.getByRole("region", { name: "Neuigkeiten" })).toHaveCount(0);
});

test("Helfer: ohne Filter alle Mannschaften, ein Tipp filtert, ein zweiter hebt den Filter auf", async () => {
  const { page } = admin;
  await page.goto("/helfer");
  const chips = page.getByRole("group", { name: "Nach Mannschaft filtern" });
  const first = chips.getByRole("button").first();
  const referee = chips.getByRole("button", { name: "Jugendschiedsrichter" });
  // Default: all teams (the youth referees are a list of their own)
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(referee).toHaveAttribute("aria-pressed", "false");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await referee.click();
  await expect(referee).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await referee.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(referee).toHaveAttribute("aria-pressed", "false");
});

test("Info-Knopf: Erklärung mit Beispiel statt Untertext am Schalter", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("button", { name: "Erklärung: Stammkader automatisch nominieren" }).click();
  const info = page.getByRole("dialog", { name: "Stammkader automatisch nominieren" });
  await expect(info).toContainText("Beispiel:");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/info-button.png` });
  await info.getByRole("button", { name: "Verstanden" }).click();
  await expect(info).toHaveCount(0);
});

test("Ganze Mannschaft bei Spielen: alle dabei, „Kader folgt“ und „Nicht nominiert“", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("button", { name: "Erklärung: Ganze Mannschaft bei Spielen dabei" }).click();
  const info = page.getByRole("dialog", { name: "Ganze Mannschaft bei Spielen dabei" });
  await expect(info).toContainText("Beispiel:");
  await info.getByRole("button", { name: "Verstanden" }).click();
  const all = page.getByRole("switch", { name: /Ganze Mannschaft bei Spielen dabei/ });
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "true");

  const date = new Date(Date.now() + 9 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const { id } = await (await page.request.post("/api/duties/teams/1/games", { data: { opponent: "SG Allestadt", isHome: false, date, time: "11:00" } })).json();
  await player.page.goto(`/termine/${id}`);
  await expect(player.page.getByText("Kader folgt").first()).toBeVisible();
  await expect(player.page.getByText("Zugesagt").first()).toBeVisible();

  // Squad without Ida: she takes part but does not play
  const ids = (await (await page.request.get(`/api/events/${id}/squad`)).json()).candidates
    .filter((c: { person: { firstName: string }; isActive: boolean }) => c.person.firstName !== "Ida" && c.isActive)
    .map((c: { person: { id: number } }) => c.person.id);
  expect((await page.request.put(`/api/events/${id}/squad`, { data: { personIds: ids } })).ok()).toBe(true);
  await player.page.reload();
  await expect(player.page.getByText("Nicht nominiert").first()).toBeVisible();
  if (process.env.E2E_SHOTS) await player.page.screenshot({ path: `${process.env.E2E_SHOTS}/not-nominated.png` });

  // Clean up: back as before
  await page.request.patch("/api/teams/1", { data: { gameAllPlayers: false } });
  await page.request.delete(`/api/duties/games/${id}`);
});

test("Dienstart löschen: unbenutzte ja, verwendete nur archivieren", async () => {
  const a = admin.page;
  await a.goto("/verwaltung/helferdienste");
  await a.getByRole("button", { name: "Dienstart hinzufügen" }).click();
  const sheet = a.getByRole("dialog", { name: "Neue Dienstart" });
  await sheet.getByLabel("Name").fill("Probedienst");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  const types = a.getByRole("region", { name: "Dienstarten" });
  await types.getByRole("button", { name: /Probedienst/ }).click();
  const edit = a.getByRole("dialog", { name: "Probedienst" });
  await edit.getByRole("button", { name: "Dienstart löschen" }).click();
  await a.getByRole("dialog", { name: "Probedienst löschen?" }).getByRole("button", { name: "Löschen" }).click();
  await expect(a.getByText("Probedienst gelöscht.")).toBeVisible();
  await expect(types).not.toContainText("Probedienst");

  // Used in templates: disabled, with the hint
  await types.getByRole("button", { name: /Kuchen & Theke/ }).click();
  const cake = a.getByRole("dialog", { name: "Kuchen & Theke" });
  await expect(cake.getByRole("button", { name: "Dienstart löschen" })).toBeDisabled();
  await expect(cake).toContainText("Archivieren blendet sie für Neues aus.");
});

test("Statistik: Trainer über die Teamseite, Spielerin im Profil", async () => {
  const { page } = coach;
  await page.goto("/team/1");
  await page.getByRole("link", { name: /Statistik/ }).click();
  await expect(page).toHaveURL(/\/team\/1\/statistik$/);
  await expect(page.getByRole("heading", { name: "Statistik" })).toBeVisible();
  await page.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: "Saison" }).click();
  await expect(page.getByRole("region", { name: "Training" })).toBeVisible();
  await page.getByRole("button", { name: "Erklärung: So wird gezählt" }).click();
  await expect(page.getByRole("dialog", { name: "So wird gezählt" })).toContainText("dauerhaft abwesend");
  await page.getByRole("dialog", { name: "So wird gezählt" }).getByRole("button", { name: "Verstanden" }).click();
  await page.getByRole("group", { name: "Bereich" }).getByRole("button", { name: "Spiele" }).click();
  await expect(page.getByRole("region", { name: "Spiele" })).toContainText("Ø im Kader");
  // The helper plan of the team adds the helpers per family (helper duties module)
  await page.getByRole("group", { name: "Bereich" }).getByRole("button", { name: "Helfer" }).click();
  await expect(page.getByRole("region", { name: "Helfer" })).toContainText("Familien dabei");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/stats-helpers.png` });

  await player.page.goto("/profil");
  await player.page.getByRole("link", { name: /Meine Statistik/ }).click();
  await expect(player.page.getByRole("heading", { name: "Meine Statistik" })).toBeVisible();
  await expect(player.page.getByRole("region", { name: "Training" })).toBeVisible();
  // The team statistics stay with the coaches
  expect((await player.page.request.get("/api/teams/1/stats")).status()).toBe(403);
});

test("Einmalige Push-Abfrage: erscheint auf der Startseite, nach „Später“ nicht wieder", async () => {
  // Own tab: headless Chromium reports notifications as blocked, here they are still undecided
  const p = await player.context.newPage();
  await p.addInitScript(() => {
    sessionStorage.setItem("e2e-push", "1");
    Object.defineProperty((globalThis as unknown as { Notification: object }).Notification, "permission", { get: () => "default" });
  });
  await p.goto("/");
  await p.evaluate(() => localStorage.removeItem("kabine-push-asked"));
  await p.reload();
  const sheet = p.getByRole("dialog", { name: "Benachrichtigungen einschalten?" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Einschalten" })).toBeVisible();
  if (process.env.E2E_SHOTS) await p.screenshot({ path: `${process.env.E2E_SHOTS}/push-abfrage.png` });
  await sheet.getByRole("button", { name: "Später" }).click();
  await expect(sheet).toHaveCount(0);
  expect(await p.evaluate(() => localStorage.getItem("kabine-push-asked"))).toBe("1");
  await p.reload();
  await p.waitForTimeout(2500);
  await expect(p.getByRole("dialog", { name: "Benachrichtigungen einschalten?" })).toHaveCount(0);
  await p.close();
});

test("Einmalige Push-Abfrage: nicht, wenn Benachrichtigungen blockiert sind", async () => {
  // Own tab, so the blocked permission stays there
  const p = await coach.context.newPage();
  await p.addInitScript(() => {
    sessionStorage.setItem("e2e-push", "1");
    // Blocked on this device: nothing to ask, the device counts as asked
    Object.defineProperty((globalThis as unknown as { Notification: object }).Notification, "permission", { get: () => "denied" });
  });
  await p.goto("/");
  await p.evaluate(() => localStorage.removeItem("kabine-push-asked"));
  await p.reload();
  await p.waitForTimeout(2500);
  await expect(p.getByRole("dialog", { name: "Benachrichtigungen einschalten?" })).toHaveCount(0);
  expect(await p.evaluate(() => localStorage.getItem("kabine-push-asked"))).toBe("1");
  await p.close();
});

test("Startseite: nächster Termin heute mit ruhiger Animation, der gelbe Kopf öffnet den Termin", async () => {
  const { page } = player;
  await page.goto("/");
  // Fixtures: training every day at 23:30, so the next own event is today (unless the test runs after 23:30)
  const head = page.locator("a.card-head-link").first();
  await expect(head).toBeVisible();
  if ((await head.getAttribute("class"))?.includes("is-today")) {
    await expect(head.locator(".today-tag")).toContainText("heute");
    // Reduced motion: no light sweep, no pulsing
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(head.locator(".today-dot")).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: null });
  }
  await head.click();
  await expect(page).toHaveURL(/\/termine\/\d+/);
});

test("Sondertermine: ohne Anwesenheit, freiwillige Teilnahme und Anmeldung je Familie schließen sich aus", async () => {
  const c = coach.page;
  await c.goto("/team/1/termin-neu");
  await c.getByLabel("Titel").fill("Kick-off Sammelalbum");
  await c.getByLabel("Datum").fill("2099-08-01");
  await c.getByRole("button", { name: "Erklärung: Ohne Anwesenheit" }).click();
  const info = c.getByRole("dialog", { name: "Ohne Anwesenheit" });
  await expect(info).toContainText("nicht zu- oder absagen");
  await info.getByRole("button", { name: "Verstanden" }).click();
  await c.getByRole("switch", { name: /Freiwillige Teilnahme/ }).click();
  await c.getByRole("switch", { name: /Ohne Anwesenheit/ }).click();
  await expect(c.getByRole("switch", { name: /Freiwillige Teilnahme/ })).toHaveAttribute("aria-checked", "false");
  await c.getByRole("button", { name: "Termin anlegen" }).click();
  await expect(c).toHaveURL(/\/termine\/\d+/);
  await expect(c.getByText("Ohne Zu- und Absage: Wer mag, kommt einfach vorbei.")).toBeVisible();
  await expect(c.getByRole("button", { name: "Erinnern" })).toHaveCount(0);
  await expect(c.getByText(/^Absagefrist:/)).toHaveCount(0);
  const p = player.page;
  await p.goto(c.url().replace(/^https?:\/\/[^/]+/, ""));
  await expect(p.getByText("Ohne Zu- und Absage")).toBeVisible();
  await expect(p.getByRole("button", { name: "Absagen" })).toHaveCount(0);

  // Switching to optional attendance in the edit sheet
  await c.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const sheet = c.getByRole("dialog", { name: "Termin bearbeiten" });
  await sheet.getByRole("switch", { name: /Freiwillige Teilnahme/ }).click();
  await expect(sheet.getByRole("switch", { name: /Ohne Anwesenheit/ })).toHaveAttribute("aria-checked", "false");
  await sheet.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(c.getByText("Freiwillige Teilnahme: Wer mitmachen möchte, sagt bitte zu.")).toBeVisible();
  await expect(c.getByRole("group", { name: "Übersicht" })).toContainText("ohne Zusage");
  await p.reload();
  await p.getByRole("button", { name: "Ich mache mit" }).click();
  await expect(p.getByText("Zugesagt").first()).toBeVisible();
  // Withdrawing needs no reason
  await p.getByRole("button", { name: "Doch nicht" }).click();
  await expect(p.getByText("Du hast nicht zugesagt.")).toBeVisible();
});

test("Sondertermin mit Anmeldung je Familie: Zahl je Familie statt Zusage, Warnung beim Umstellen, Trainer sieht Familien", async () => {
  const c = coach.page;
  await c.goto("/team/1/termin-neu");
  await c.getByLabel("Titel").fill("Weihnachtsfeier");
  await c.getByLabel("Datum").fill("2099-08-03");
  await c.getByRole("button", { name: "Termin anlegen" }).click();
  await expect(c).toHaveURL(/\/termine\/\d+/);
  // Switching an existing event: warning in the edit sheet
  await c.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const sheet = c.getByRole("dialog", { name: "Termin bearbeiten" });
  await sheet.getByRole("switch", { name: /Anmeldung je Familie/ }).click();
  await expect(sheet).toContainText("Alle Eingeladenen bekommen beim Speichern eine Benachrichtigung");
  await sheet.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(c.getByText("Anmeldung je Familie: Gebt bitte an, wie viele aus eurer Familie kommen.")).toBeVisible();
  await expect(c.getByRole("group", { name: "Anmeldungen" })).toContainText("ohne Angabe");
  await expect(c.getByRole("button", { name: "Erinnern" })).toHaveCount(0);

  // The player registers (her family) with 3 people, without yes/no buttons
  const p = player.page;
  await p.goto(c.url().replace(/^https?:\/\/[^/]+/, ""));
  const card = p.getByRole("region", { name: /Deine Anmeldung|Eure Familie/ });
  await expect(card).toContainText("Noch nicht angemeldet");
  await expect(p.getByRole("button", { name: "Absagen" })).toHaveCount(0);
  const value = Number(await card.locator(".stepper-value").innerText());
  for (let i = value; i < 3; i++) await card.getByRole("button", { name: "Mehr" }).click();
  for (let i = value; i > 3; i--) await card.getByRole("button", { name: "Weniger" }).click();
  await card.getByRole("button", { name: "Anmelden: 3 Personen" }).click();
  await expect(card).toContainText("Angemeldet · 3 Personen");
  if (process.env.E2E_SHOTS) await p.screenshot({ path: `${process.env.E2E_SHOTS}/family-registration.png`, fullPage: true });

  await c.reload();
  await expect(c.getByRole("group", { name: "Anmeldungen" }).locator(".stat-tile").first()).toContainText("3");
  await expect(c.getByRole("region", { name: "Angemeldete Familien" })).toContainText("Ida");
});

test("Umfragen: Admin schaltet das Modul ein, Trainer legt eine Umfrage mit Vorschau an, Spielerin stimmt ab", async () => {
  await admin.page.goto("/verwaltung/verein");
  const moduleSwitch = admin.page.getByRole("switch", { name: /Umfragen/ });
  await moduleSwitch.click();
  await expect(moduleSwitch).toHaveAttribute("aria-checked", "true");

  const { page } = coach;
  await page.goto("/umfragen/neu?team=1");
  await page.reload();
  await page.getByRole("textbox", { name: "Frage", exact: true }).fill("Wohin geht die Abschlussfahrt?");
  await page.getByLabel("Antwort 1", { exact: true }).fill("Kletterhalle");
  await page.getByLabel("Antwort 2", { exact: true }).fill("Freibad");
  // Preview: voting can be tried, nothing is saved
  await page.getByRole("button", { name: "Vorschau" }).click();
  const preview = page.getByRole("dialog", { name: "Vorschau" });
  await preview.getByRole("radio", { name: "Kletterhalle" }).click();
  await preview.getByRole("button", { name: "Abstimmen" }).click();
  await expect(page.getByText("Nur Vorschau, nichts gespeichert.")).toBeVisible();
  await preview.getByRole("button", { name: "Zurück zum Bearbeiten" }).click();
  await page.getByRole("button", { name: "Umfrage starten" }).click();
  await expect(page).toHaveURL(/\/umfragen\/\d+$/);
  await expect(page.getByRole("heading", { name: "Wohin geht die Abschlussfahrt?" })).toBeVisible();

  // The player sees the poll at the very top of the start page and a dot on the Events tab
  const p = player.page;
  await p.goto("/");
  await p.reload();
  const card = p.getByRole("link", { name: /Umfrage: Wohin geht die Abschlussfahrt\?/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Stimme fehlt");
  await expect(p.getByRole("navigation", { name: "Hauptnavigation" }).getByText("(offene Umfrage)")).toBeAttached();
  await card.click();
  await expect(p).toHaveURL(/\/umfragen\/\d+$/);
  await p.getByRole("radio", { name: "Freibad" }).click();
  await p.getByRole("button", { name: "Abstimmen" }).click();
  await expect(p.getByText("Stimme gespeichert.")).toBeVisible();
  await expect(p.getByRole("region", { name: "Deine Stimme" })).toContainText("Abgestimmt");
  // Participants see the result without names
  await expect(p.getByRole("region", { name: "Ergebnis" })).toContainText("Freibad");
  await p.goto("/");
  await expect(p.getByRole("heading", { name: "Hallo Ida" })).toBeVisible();
  await expect(p.getByRole("link", { name: /Umfrage: Wohin geht/ })).toHaveCount(0);
  await expect(p.getByRole("navigation", { name: "Hauptnavigation" }).getByText("(offene Umfrage)")).toHaveCount(0);
  // The poll stays under Profile → Polls
  await p.goto("/profil");
  await p.getByRole("link", { name: /Umfragen/ }).click();
  await expect(p.getByRole("link", { name: /Wohin geht die Abschlussfahrt\?/ })).toBeVisible();

  // The coach sees who voted what
  await page.reload();
  const result = page.getByRole("region", { name: "Ergebnis" });
  await expect(result).toContainText("Freibad");
  await expect(result).toContainText(/Ida P/);
});

test("Bestellung: Mengen je Artikel und Größe, Export als Excel für den Trainer", async () => {
  const { page } = coach;
  const endsAt = `${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}T20:00`;
  const created = await page.request.post("/api/polls", {
    data: {
      teamId: 1,
      kind: "order",
      title: "Vereinsausrüstung",
      whoCoaches: true,
      endsAt,
      options: [
        { label: "Socken", priceCents: 800, sizes: ["31-34", "35-38"] },
        { label: "Mütze", priceCents: 1500 },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const id = (await created.json()).id as number;
  const detail = await (await page.request.get(`/api/polls/${id}`)).json();
  const [socks, hat] = detail.options.map((o: { id: number }) => o.id);
  const answers = [
    { optionId: socks, size: "35-38", value: 3 },
    { optionId: socks, size: "31-34", value: 1 },
    { optionId: hat, value: 1 },
  ];
  expect((await page.request.put(`/api/polls/${id}/ballot`, { data: { unitId: detail.myUnits[0].unitId, answers } })).ok()).toBe(true);

  await page.goto(`/umfragen/${id}`);
  const amounts = page.getByRole("region", { name: "Mengen" });
  await expect(amounts.getByRole("heading", { name: "Mengen" })).toBeVisible();
  await expect(amounts).toContainText("4 Stück");
  await expect(amounts.getByRole("list", { name: "Socken: Größen" })).toContainText("Größe 35-38");
  const orders = page.getByRole("region", { name: "Bestellungen" });
  const [download] = await Promise.all([page.waitForEvent("download"), orders.getByRole("button", { name: "Als Excel herunterladen" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Bestellung Vereinsausruestung \d{4}-\d{2}-\d{2}\.xlsx$/);
  const bytes = readFileSync((await download.path())!);
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(bytes.toString("latin1")).toContain("xl/worksheets/sheet3.xml");
  if (process.env.E2E_XLSX) await download.saveAs(process.env.E2E_XLSX);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/order-quantities.png`, fullPage: true });
  await page.request.delete(`/api/polls/${id}`);
});

test("Fans: Spielerin folgt einer anderen Mannschaft, sieht deren Spiel unter dem Stern und öffnet die Spielseite", async () => {
  await admin.page.goto("/verwaltung/verein");
  const moduleSwitch = admin.page.getByRole("switch", { name: /^Fans/ });
  await moduleSwitch.click();
  await expect(moduleSwitch).toHaveAttribute("aria-checked", "true");
  const { id: other } = await (await admin.page.request.post("/api/teams", { data: { name: "wF", ageClassCode: "wC" } })).json();
  const date = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const created = await admin.page.request.post(`/api/duties/teams/${other}/games`, { data: { opponent: "HSG Sternhausen", isHome: true, date, time: "13:00" } });
  expect(created.ok()).toBe(true);
  const { id: gameId } = (await created.json()) as { id: number };

  const { page } = player;
  await page.goto("/profil");
  await page.getByRole("link", { name: /Fan von/ }).click();
  await expect(page).toHaveURL(/\/profil\/fan$/);
  // Own team fixed, the other one with a star
  await expect(page.getByRole("button", { name: "wT folgen" })).toHaveCount(0);
  const star = page.getByRole("button", { name: "wF folgen" });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");

  await page.goto("/");
  const filter = page.getByRole("group", { name: "Nach Mannschaft filtern" });
  const fans = filter.getByRole("button", { name: "Spiele als Fan: wF" });
  await expect(fans).toHaveAttribute("aria-pressed", "false");
  const fanRow = page.locator("a.event-row", { hasText: "HSG Sternhausen" });
  await expect(fanRow).toHaveCount(0);
  await fans.click();
  await expect(fans).toHaveAttribute("aria-pressed", "true");
  await expect(fanRow).toBeVisible();
  await expect(page.locator(".hero-sub")).toContainText("Spiele als Fan");
  // Own team off: only the fan games
  await filter.getByRole("button", { name: "wT" }).click();
  await expect(page.locator(".hero-sub")).toHaveText("Spiele als Fan");
  await expect(fanRow).toBeVisible();
  await expect(fanRow.getByRole("img", { name: /^wF/ })).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/home-fans.png`, fullPage: true });

  // The game page: game data only
  await fanRow.click();
  await expect(page).toHaveURL(new RegExp(`/spiel/${gameId}$`));
  await expect(page.getByRole("heading", { name: /HSG Sternhausen/ })).toBeVisible();
  await expect(page.getByText("Heimspiel")).toBeVisible();
  await expect(page.getByText("Du folgst wF als Fan.")).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/fan-game.png`, fullPage: true });

  // Back to the usual selection for the tests after this one
  await page.goto("/");
  await filter.getByRole("button", { name: "wT" }).click();
  await fans.click();
  await expect(fans).toHaveAttribute("aria-pressed", "false");
  await admin.page.request.delete(`/api/duties/games/${gameId}`);
  await admin.page.request.delete(`/api/teams/${other}`);
  await admin.page.goto("/verwaltung/verein");
  await moduleSwitch.click();
  await expect(moduleSwitch).toHaveAttribute("aria-checked", "false");
});

test("Heimspieltag: Karte auf der Startseite, Seite des Tages, Einstellungen", async () => {
  await admin.page.goto("/verwaltung/verein");
  const moduleSwitch = admin.page.getByRole("switch", { name: /^Heimspieltag/ });
  await moduleSwitch.click();
  await expect(moduleSwitch).toHaveAttribute("aria-checked", "true");
  // Five teams play at home in two days: the player's wT and four more
  const date = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const teamIds = [1];
  for (const name of ["gA", "gB", "gC", "gD"]) {
    const { id } = await (await admin.page.request.post("/api/teams", { data: { name, ageClassCode: "wC" } })).json();
    teamIds.push(id);
  }
  const gameIds: number[] = [];
  for (const [i, id] of teamIds.entries()) {
    const created = await admin.page.request.post(`/api/duties/teams/${id}/games`, { data: { opponent: `TSV Gästeheim ${i}`, isHome: true, date, time: `${10 + i}:30` } });
    expect(created.ok()).toBe(true);
    gameIds.push(((await created.json()) as { id: number }).id);
  }

  const { page } = player;
  await page.goto("/");
  const card = page.locator("a.gameday-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Heimspieltag");
  await expect(card).toContainText("5 Mannschaften");
  // First to last kick-off of the day (the demo data may have one more game of wT that day)
  await expect(card).toContainText(/10:30 bis \d\d:\d\d Uhr/);
  await expect(card.locator(".gameday-games li")).toHaveText(["10:30wTdeine Mannschaft"]);
  await expect(card).toContainText("Komm vorbei und feuer mit an!");
  // No mascot uploaded: no picture
  await expect(card.locator("img")).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/home-gameday.png`, fullPage: true });

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/heimspieltag/${date}$`));
  for (let i = 0; i < 5; i++) await expect(page.locator(".gameday-item", { hasText: `TSV Gästeheim ${i}` })).toHaveCount(1);
  // Own game marked and linked to the event page, the others not marked
  const own = page.locator(".gameday-item", { hasText: "TSV Gästeheim 0" });
  await expect(own).toHaveClass(/mine/);
  await expect(own).toContainText("deine Mannschaft");
  await expect(own.getByRole("link")).toHaveAttribute("href", `/termine/${gameIds[0]}`);
  await expect(page.locator(".gameday-item", { hasText: "TSV Gästeheim 3" })).not.toHaveClass(/mine/);
  // Game data only: no names of the squad
  await expect(page.getByText("Ida")).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/gameday.png`, fullPage: true });

  // Administration: the next day with the time of the message
  await admin.page.goto("/verwaltung/heimspieltage");
  await expect(admin.page.getByRole("heading", { name: "Heimspieltage" })).toBeVisible();
  await expect(admin.page.getByText(/5 Mannschaften · der Hinweis geht am .* um 18:00 Uhr raus/)).toBeVisible();
  await admin.page.getByRole("button", { name: "Eine Mannschaft mehr" }).click();
  await expect(admin.page.getByText("In den nächsten drei Monaten keiner.")).toBeVisible();
  await admin.page.getByRole("button", { name: "Eine Mannschaft weniger" }).click();
  await expect(admin.page.getByText(/5 Mannschaften · der Hinweis/)).toBeVisible();

  // With six teams needed the card is gone
  await admin.page.getByRole("button", { name: "Eine Mannschaft mehr" }).click();
  await expect(admin.page.getByText("In den nächsten drei Monaten keiner.")).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".hero-sub")).toBeVisible();
  await expect(page.locator("a.gameday-card")).toHaveCount(0);

  // Back as before for the tests after this one
  await admin.page.getByRole("button", { name: "Eine Mannschaft weniger" }).click();
  await expect(admin.page.getByText(/5 Mannschaften · der Hinweis/)).toBeVisible();
  for (const id of gameIds) await admin.page.request.delete(`/api/duties/games/${id}`);
  for (const id of teamIds.slice(1)) await admin.page.request.delete(`/api/teams/${id}`);
  await admin.page.goto("/verwaltung/verein");
  await moduleSwitch.click();
  await expect(moduleSwitch).toHaveAttribute("aria-checked", "false");
});
