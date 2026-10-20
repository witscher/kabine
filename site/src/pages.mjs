// Content pages of kabine.dev, German and English. Each page: the same id in both languages, its path,
// title (≤ 60 characters), description (≤ 155), hero texts and body (sections with the classes of
// style.css). Only statements about Kabine itself, no comparisons with other apps by name.
import { GITHUB, ORIGIN } from "./layout.mjs";

const anchor = (text) => text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const section = (cls, kicker, h2, sub, inner = "") => `<section${kicker ? ` id="${anchor(kicker)}"` : ""}${cls ? ` class="${cls}"` : ""}>
  <div class="wrap">
    ${kicker ? `<p class="kicker">${kicker}</p>` : ""}
    <h2>${h2}</h2>
    ${sub ? `<p class="sub">${sub}</p>` : ""}
    ${inner}
  </div>
</section>`;
const cards = (cls, items) => `<div class="grid ${cls}">${items.map(([h, p]) => `<div class="card"><h3>${h}</h3><p>${p}</p></div>`).join("")}</div>`;
const ticks = (items) => `<ul class="ticks">${items.map(([b, t]) => `<li><b>${b}</b> ${t}</li>`).join("")}</ul>`;
const links = (items) => `<p class="more">${items.map(([href, label]) => `<a href="${href}">${label}</a>`).join(" · ")}</p>`;
const shots = (lang, items) =>
  `<div class="gallery small">${items
    .map(([file, alt, cap]) => `<figure class="shot"><img loading="lazy" src="/shots/${lang}/${file}.webp" width="390" height="844" alt="${alt}"><figcaption>${cap}</figcaption></figure>`)
    .join("")}</div>`;
const faq = (items) =>
  `<div class="faqs">${items.map(([q, a]) => `<details class="faq"><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>`;

/** schema.org description of the app, used on the start pages and the "why" pages. */
export function softwareApplication(lang) {
  const de = lang === "de";
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Kabine",
    url: de ? `${ORIGIN}/` : `${ORIGIN}/en/`,
    applicationCategory: "SportsApplication",
    operatingSystem: "Web (iOS, Android, desktop browsers)",
    description: de
      ? "Freie Mannschafts-App für Amateursportvereine: Training und Spiele mit Zu- und Absagen, Kader, Mannschaftschat, Helferdienste und Fahrgemeinschaften. Jeder Verein betreibt seine eigene Installation."
      : "Free team app for amateur sports clubs: trainings and games with yes/no responses, squads, team chat, helper duties and carpools. Each club runs its own installation.",
    inLanguage: ["de", "en"],
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    codeRepository: GITHUB,
    screenshot: `${ORIGIN}/shots/${lang}/01-events.webp`,
    featureList: de
      ? ["Zu- und Absagen für Training und Spiele", "Kader nominieren", "Mannschaftschat", "Helferdienste", "Fahrgemeinschaften", "Anwesenheit", "Anmeldung mit Passkey", "Nur mit Einladung"]
      : ["Yes/no responses for trainings and games", "Squad nominations", "Team chat", "Helper duties", "Carpools", "Attendance", "Passkey sign-in", "Invitation only"],
  };
}

export const PAGES = [
  // Why Kabine: the four differences -------------------------------------------------------------------
  {
    id: "why",
    de: {
      path: "/warum-kabine/",
      title: "Warum Kabine? Open Source, eigene Installation, Passkeys",
      description: "Was Kabine anders macht: Open Source, eine eigene Installation pro Verein, Zugang nur mit Einladung und Anmeldung mit Passkey statt Passwort.",
      kicker: "Warum Kabine",
      h1: "Was Kabine <mark>anders</mark> macht.",
      lead: "Vier Entscheidungen prägen die App: Der Code ist offen, jeder Verein hat seine eigene Installation, in die App kommt nur, wer eingeladen ist, und es gibt keine Passwörter.",
      jsonLd: (l) => [softwareApplication(l)],
      body: `${section(
        "",
        "1 · Open Source",
        "Freie Software, für immer kostenlos.",
        "Kabine steht unter der AGPL-3.0. Jeder kann den Code lesen, prüfen, verändern und weitergeben. Es gibt keine Lizenz, kein Abo, keine Werbung und keine Premium-Stufe, die später dazukommt.",
        ticks([
          ["Nachprüfbar.", "Was mit den Daten passiert, steht im Code und in einer vollständigen Liste der gespeicherten Daten, nicht in einem Versprechen."],
          ["Unabhängig.", "Kein Anbieter kann die Preise erhöhen, Funktionen streichen oder den Dienst einstellen. Die App gehört allen Vereinen."],
          ["Gemeinsam weiterentwickelt.", "Vereine bringen Sportarten, Spielplan-Anbindungen und Module selbst ein, auch mit einem Coding-Agenten."],
        ]) + links([[GITHUB, "Quellcode auf GitHub"], ["/#mitmachen", "Mitmachen"]]),
      )}
${section(
  "alt",
  "2 · Eigene Installation",
  "Ein Verein, eine Installation, ein Konto.",
  "Es gibt keinen zentralen Kabine-Server. Jeder Verein installiert seine eigene Kopie im eigenen Cloudflare-Konto, mit eigener Datenbank und eigener Adresse, zum Beispiel app.dein-verein.de.",
  ticks([
    ["Die Daten bleiben beim Verein.", "Die Entwickler von Kabine haben auf keine Vereinsdaten Zugriff. Der Verein ist Verantwortlicher, Cloudflare Auftragsverarbeiter im Konto des Vereins."],
    ["Kein Server zu pflegen.", "Die Plattform spielt Sicherheitsupdates selbst ein. Für einen üblichen Verein reicht der kostenlose Tarif."],
    ["Updates, wann der Verein will.", "Neue Versionen kommen als Pull Request in die Kopie des Vereins. Ändert ein Update die Datenbank, notiert es vorher einen Wiederherstellungspunkt."],
    ["Aufhören ist einfach.", "Daten exportieren, Ressourcen im eigenen Konto löschen, fertig. Niemand muss gekündigt oder um Löschung gebeten werden."],
  ]) + links([["/en/docs/install/", "Installationsanleitung (Englisch)"], ["/vorstand-datenschutz/", "Für Vorstand und Datenschutz"]]),
)}
${section(
  "",
  "3 · Nur mit Einladung",
  "Keine Selbstregistrierung. Keine Fremden.",
  "In Kabine gibt es keine offene Anmeldung und keine öffentlichen Inhalte. Wer in die App kommt, bestimmt der Verein über Einladungslinks.",
  cards("g3", [
    ["Spielerlink", "Der Trainer teilt einen Link pro Mannschaft. Spieler wählen ihren eigenen Namen aus der Liste, die der Trainer angelegt hat. Vergebene Namen sind gesperrt."],
    ["Elternlink", "Eltern tragen ihren eigenen Namen ein und wählen ihr Kind, Geschwister in derselben Mannschaft gleich mit. Danach sagen sie für ihr Kind zu und ab."],
    ["Persönlicher Link", "Trainer, Betreuer und Admins bekommen einen Link nur für sich. Der erste Admin richtet die Installation mit einem Einrichtungspasswort ein."],
  ]) +
    ticks([
      ["Links laufen ab", "und lassen sich jederzeit erneuern; der alte Link gilt dann nicht mehr."],
      ["Der Link ist nur zum Einrichten da.", "Wer ihn später noch einmal öffnet, kommt mit „Direkt zur App“ in die App."],
      ["Trainer sehen, wer fehlt:", "Die Einladungsübersicht zeigt, wer noch keinen Zugang hat."],
    ]),
)}
${section(
  "alt",
  "4 · Keine Passwörter",
  "Anmelden mit Face ID, Fingerabdruck oder Displaysperre.",
  "Kabine nutzt Passkeys, den aktuellen Standard für sichere Anmeldung (WebAuthn). Es gibt kein Passwort, das jemand vergessen, weitergeben oder bei einem anderen Dienst verlieren könnte.",
  ticks([
    ["Sicher gegen Phishing.", "Ein Passkey funktioniert nur auf der echten Adresse des Vereins. Eine nachgebaute Seite kann ihn nicht abgreifen."],
    ["Keine biometrischen Daten in der App.", "Gesicht oder Fingerabdruck prüft das Handy selbst. Kabine bekommt nur einen öffentlichen Schlüssel."],
    ["Für Kinder gemacht.", "Kinder brauchen weder E-Mail-Adresse noch Telefonnummer. Wer keinen Passkey nutzen kann, meldet sich mit einem Code per E-Mail oder, wenn der Verein es einschaltet, per SMS an."],
    ["Eine Web-App, kein App Store.", "Adresse öffnen, auf den Startbildschirm legen, fertig. Mit Benachrichtigungen, auch auf dem iPhone. Jedes Update erreicht alle sofort."],
  ]),
)}
${section(
  "",
  "Und außerdem",
  "Gebaut für den Vereinsalltag.",
  "",
  cards("g3", [
    ["Datensparsam", "Von Spielern und Eltern nur Vorname, Nachname und Jahrgang. Absagegründe sehen nur Trainer und werden nach 60 Tagen gelöscht."],
    ["Kein Tracking, keine Werbung", "Keine fremden Skripte, Schriften oder Bilder. Die meisten Nutzer sind Kinder."],
    ["Aus der Praxis", "Entstanden in einem Handballverein, in dem mehrere hundert Spieler, Eltern und Trainer die App jeden Tag nutzen."],
  ]),
)}`,
    },
    en: {
      path: "/en/why-kabine/",
      title: "Why Kabine? Open source, own installation, passkeys",
      description: "What makes Kabine different: open source, one installation per club, access by invitation only and passkey sign-in instead of passwords.",
      kicker: "Why Kabine",
      h1: "What makes Kabine <mark>different</mark>.",
      lead: "Four decisions shape the app: the code is open, every club has its own installation, only invited people get in, and there are no passwords.",
      jsonLd: (l) => [softwareApplication(l)],
      body: `${section(
        "",
        "1 · Open source",
        "Free software, free of charge for good.",
        "Kabine is licensed under the AGPL-3.0. Anyone can read, check, change and share the code. No licence fee, no subscription, no ads and no premium tier added later.",
        ticks([
          ["Verifiable.", "What happens to the data is in the code and in a complete list of the stored data, not in a promise."],
          ["Independent.", "No vendor can raise prices, drop features or shut the service down. The app belongs to all clubs."],
          ["Built together.", "Clubs contribute sports, game schedule connectors and modules themselves, also with a coding agent."],
        ]) + links([[GITHUB, "Source code on GitHub"], ["/en/#contribute", "Contribute"]]),
      )}
${section(
  "alt",
  "2 · Own installation",
  "One club, one installation, one account.",
  "There is no central Kabine server. Every club installs its own copy in its own Cloudflare account, with its own database and its own address, for example app.your-club.org.",
  ticks([
    ["The data stays with the club.", "The developers of Kabine have no access to any club's data. The club is the controller, Cloudflare the processor in the club's account."],
    ["No server to maintain.", "The platform applies security updates itself. The free plan is enough for a typical club."],
    ["Updates when the club wants.", "New versions arrive as a pull request in the club's copy. If an update changes the database, it notes a restore point first."],
    ["Leaving is easy.", "Export the data, delete the resources in your own account, done. Nobody to cancel with or to ask for deletion."],
  ]) + links([["/en/docs/install/", "Installation guide"], ["/en/club-board-privacy/", "For the board and privacy"]]),
)}
${section(
  "",
  "3 · Invitation only",
  "No self sign-up. No strangers.",
  "Kabine has no open registration and no public content. The club decides who gets in, with invitation links.",
  cards("g3", [
    ["Player link", "The coach shares one link per team. Players pick their own name from the list the coach created. Taken names are locked."],
    ["Parent link", "Parents enter their own name and pick their child, siblings in the same team right away. Then they respond for their child."],
    ["Personal link", "Coaches, staff and admins get a link just for them. The first admin sets up the installation with a setup password."],
  ]) +
    ticks([
      ["Links expire", "and can be renewed at any time; the old link then stops working."],
      ["The link is for setting up only.", "Whoever opens it again later gets into the app with “Straight to the app”."],
      ["Coaches see who is missing:", "the invitations overview shows who has no access yet."],
    ]),
)}
${section(
  "alt",
  "4 · No passwords",
  "Sign in with Face ID, fingerprint or screen lock.",
  "Kabine uses passkeys, the current standard for secure sign-in (WebAuthn). There is no password anyone could forget, pass on or lose at another service.",
  ticks([
    ["Phishing-resistant.", "A passkey only works on the club's real address. A fake page cannot capture it."],
    ["No biometric data in the app.", "The phone checks face or fingerprint itself. Kabine only receives a public key."],
    ["Made for children.", "Children need neither an e-mail address nor a phone number. Whoever cannot use a passkey signs in with a code by e-mail or, if the club switches it on, by SMS."],
    ["A web app, no app store.", "Open the address, add it to the home screen, done. With notifications, also on the iPhone. Every update reaches everyone at once."],
  ]),
)}
${section(
  "",
  "And also",
  "Built for everyday club life.",
  "",
  cards("g3", [
    ["Data-minimal", "Of players and parents only first name, last name and birth year. Decline reasons are seen by coaches only and deleted after 60 days."],
    ["No tracking, no ads", "No third-party scripts, fonts or images. Most users are children."],
    ["From practice", "Born in a handball club where several hundred players, parents and coaches use the app every day."],
  ]),
)}`,
    },
  },

  // Sports ---------------------------------------------------------------------------------------------
  {
    id: "handball",
    de: {
      path: "/handball/",
      title: "Handball-App für Vereine – kostenlos und Open Source",
      description: "Kabine für Handballvereine: Spielpläne aus handball4all, Altersklassen von Bambini bis Aktive, Zeitnehmer, Sekretär, KiHaSL und Helferdienste.",
      kicker: "Für Handballvereine",
      h1: "Die Handball-App für den <mark>ganzen</mark> Verein.",
      lead: "Kabine ist in einem Handballverein entstanden und kennt den Handball-Alltag: Spielpläne aus handball4all, Altersklassen, Hallen, Zeitnehmer und Sekretär, Kinder- und Jugendschiedsrichter.",
      body: `${section(
        "",
        "Spielbetrieb",
        "Spielpläne aus handball4all, ohne Abtippen.",
        "Mit dem Modul „Spielplan aus handball4all“ verbindet der Trainer seine Mannschaft einmal mit dem Spielplan des Verbands. Danach holt Kabine die Spiele selbst.",
        ticks([
          ["Spiele kommen von selbst:", "neue Spiele, verlegte Anwurfzeiten und Hallen werden übernommen, abgesetzte Spiele abgesagt, Betroffene benachrichtigt."],
          ["Ergebnisse, Tabelle, Liveticker:", "Tabelle und Spielbericht sind einen Tipp entfernt, abgerufen erst, wenn jemand sie öffnet."],
          ["Heim und Auswärts:", "Hallen der Gegner kommen mit Adresse, für die Fahrgemeinschaft und die Karte."],
          ["Ohne handball4all:", "Spiele lassen sich auch aus einer Tabelle übernehmen oder einzeln anlegen."],
        ]),
      )}
${section(
  "alt",
  "Altersklassen und Training",
  "Von den Bambini bis zu den Aktiven.",
  "Das Handball-Profil bringt die Altersklassen mit Jahrgängen und Spielzeiten mit: Bambini, Minis, E- bis A-Jugend, Aktive. Beim Saisonwechsel rücken Spieler in die Mannschaft ihrer neuen Altersklasse vor, mit Vorschau.",
  ticks([
    ["Trainingszeiten einmal pro Saison:", "Die App erzeugt die Trainings und lässt Schulferien und Feiertage der Region aus."],
    ["Gemeinsames Training:", "Zwei Mannschaften in einer Halle, für die andere freiwillig."],
    ["Kader nominieren:", "mit Stammkader und Aushilfen aus anderen Mannschaften, Kadergröße pro Mannschaft."],
  ]),
)}
${section(
  "",
  "Heimspieltag",
  "Zeitnehmer, Sekretär, Kuchen und Theke.",
  "Die Helferdienste für Heimspiele kommen aus Vorlagen: Zeitnehmer und Sekretär, Kuchen und Theke, Trikots waschen. Eltern tragen sich selbst ein, der Plan aktualisiert sich live.",
  cards("g3", [
    ["Zeitnehmer und Sekretär", "Dienste, für die man eine Einweisung braucht, sind als solche markiert."],
    ["KiHaSL und JuHaSL", "Das Modul „Jugendschiedsrichter“ legt für Heimspiele der markierten Altersklassen einen Schiedsrichterdienst an, mit eigener Rolle per Link."],
    ["Fahrgemeinschaften", "Für Auswärtsspiele bieten Eltern Plätze an, Spieler buchen."],
  ]) + links([["/funktionen/helferdienste/", "Mehr zu Helferdiensten"], ["/funktionen/fahrgemeinschaften/", "Mehr zu Fahrgemeinschaften"]]),
)}
${section(
  "alt",
  "Bilder",
  "So sieht es in der Demo aus.",
  "Der erfundene Handballverein „SV Musterstadt“ mit wD-Jugend und Damen.",
  shots("de", [
    ["04-squad", "Kader für ein Handballspiel nominieren", "Kader nominieren"],
    ["07-helper-duties", "Helferdienste für ein Heimspiel", "Helferdienste"],
    ["06-carpool", "Fahrgemeinschaft zu einem Auswärtsspiel", "Fahrgemeinschaft"],
  ]),
)}`,
    },
    en: {
      path: "/en/handball/",
      title: "Handball team app for clubs – free and open source",
      description: "Kabine for handball clubs: game schedules from handball4all, age classes from Bambini to adults, timekeeper, scorer, youth referees and helper duties.",
      kicker: "For handball clubs",
      h1: "The handball app for the <mark>whole</mark> club.",
      lead: "Kabine was born in a handball club and knows handball life: schedules from handball4all, age classes, halls, timekeeper and scorer, youth referees.",
      body: `${section(
        "",
        "Fixtures",
        "Schedules from handball4all, no typing.",
        "With the module “Game schedule from handball4all” the coach links the team once with the association's schedule (German handball associations). After that Kabine fetches the games itself.",
        ticks([
          ["Games arrive by themselves:", "new games, moved throw-off times and halls are taken over, cancelled games called off, the people affected notified."],
          ["Results, table, live ticker:", "table and game report are one tap away, fetched only when someone opens them."],
          ["Home and away:", "opponents' halls come with their address, for carpools and the map."],
          ["Without handball4all:", "games can also be taken from a spreadsheet or created one by one."],
        ]),
      )}
${section(
  "alt",
  "Age classes and training",
  "From Bambini to adults.",
  "The handball profile brings the age classes with birth years and playing times: Bambini, Minis, E to A youth, adults. At the season change players move up to the team of their new age class, with a preview.",
  ticks([
    ["Training times once a season:", "the app creates the trainings and leaves out the region's school holidays and public holidays."],
    ["Joint training:", "two teams in one hall, optional for the other one."],
    ["Squad nominations:", "with core squad and stand-ins from other teams, squad size per team."],
  ]),
)}
${section(
  "",
  "Home game day",
  "Timekeeper, scorer, cake and kiosk.",
  "Helper duties for home games come from templates: timekeeper and scorer, cake and kiosk, washing shirts. Parents sign up themselves, the plan updates live.",
  cards("g3", [
    ["Timekeeper and scorer", "Duties that need training are marked as such."],
    ["Youth referees", "The module “Youth referees” adds a referee duty to home games of the marked age groups, with its own role by link."],
    ["Carpools", "For away games parents offer seats, players book."],
  ]) + links([["/en/features/helper-duties/", "More on helper duties"], ["/en/features/carpools/", "More on carpools"]]),
)}
${section(
  "alt",
  "Screenshots",
  "This is how it looks in the demo.",
  "The invented handball club “SV Musterstadt” with a D youth and a women's team.",
  shots("en", [
    ["04-squad", "Nominating the squad for a handball game", "Squad nomination"],
    ["07-helper-duties", "Helper duties for a home game", "Helper duties"],
    ["06-carpool", "Carpool to an away game", "Carpool"],
  ]),
)}`,
    },
  },
  {
    id: "football",
    de: {
      path: "/fussball/",
      title: "Fußball-App für Vereine – kostenlos und Open Source",
      description: "Kabine für Fußballvereine: Jugend von G bis A, Training mit Zu- und Absagen, Kader, Chat, Helferdienste wie Kuchen, Theke und Linienrichter.",
      kicker: "Für Fußballvereine",
      h1: "Die Mannschafts-App für den <mark>Fußball</mark>verein.",
      lead: "Kabine bringt ein Fußball-Profil mit: Altersklassen von der G- bis zur A-Jugend, Spielzeiten, Platz statt Halle und typische Helferdienste. Zu- und Absagen, Kader und Chat funktionieren wie in jeder Sportart.",
      body: `${section(
        "",
        "Fußball-Profil",
        "Von der G-Jugend bis zu den Aktiven.",
        "Bei der Einrichtung wählt der Verein Fußball. Dann stimmen Altersklassen, Spielzeiten und Begriffe: zum Beispiel Platz statt Halle.",
        ticks([
          ["Altersklassen U7 bis U19", "mit Jahrgängen, dazu die Aktiven. Beim Saisonwechsel rücken Spieler mit Vorschau in die neue Altersklasse vor."],
          ["Training einmal planen:", "Trainingszeiten pro Saison festlegen, die App lässt Ferien und Feiertage aus."],
          ["Spiele anlegen", "einzeln oder aus einer Tabelle, mit Heim und Auswärts, Treffpunkt und Kader."],
        ]),
      )}
${section(
  "alt",
  "Am Spieltag",
  "Theke, Linienrichter, Trikots.",
  "Für Heimspiele kommen die Helferdienste aus Vorlagen: Kuchen und Theke, Linienrichter, Trikots waschen. Eltern tragen sich selbst ein.",
  cards("g3", [
    ["Helferdienste", "Vorlagen für Heim- und Auswärtsspiele, Eltern übernehmen Dienste selbst, der Plan aktualisiert sich live."],
    ["Fahrgemeinschaften", "Eltern bieten Plätze zum Auswärtsspiel an, Spieler buchen sich ein."],
    ["Anwesenheit", "Nach dem Spiel trägt der Trainer ein, wer da war. Ohne Eintrag zählt die Rückmeldung."],
  ]) + links([["/funktionen/helferdienste/", "Helferdienste"], ["/funktionen/fahrgemeinschaften/", "Fahrgemeinschaften"], ["/funktionen/anwesenheit/", "Anwesenheit"]]),
)}
${section(
  "",
  "Spielpläne",
  "Und die Spiele aus dem Verband?",
  "Eine automatische Anbindung an Spielplan-Systeme gibt es in Kabine nur über erlaubte Zugänge: offizielle Schnittstellen, öffentliche Exporte oder mit Erlaubnis des Verbands. Für Fußball gibt es so eine Anbindung noch nicht; bis dahin kommen Spiele aus einer Tabelle oder werden einzeln angelegt. Wer einen erlaubten Zugang kennt, kann eine Anbindung beisteuern.",
  links([["/#mitmachen", "Mitmachen"], [`${GITHUB}/issues/new/choose`, "Idee als Issue anlegen"]]),
)}`,
    },
    en: {
      path: "/en/football/",
      title: "Football team app for clubs – free and open source",
      description: "Kabine for football clubs: U7 to U19 youth, trainings with yes/no responses, squads, chat and helper duties such as kiosk, linesman and shirts.",
      kicker: "For football clubs",
      h1: "The team app for your <mark>football</mark> club.",
      lead: "Kabine comes with a football profile: age classes from U7 to U19, playing times, pitch instead of hall and typical helper duties. Responses, squads and chat work as in every sport.",
      body: `${section(
        "",
        "Football profile",
        "From U7 to adults.",
        "During setup the club picks football. Then age classes, playing times and wording fit: for example pitch instead of hall.",
        ticks([
          ["Age classes U7 to U19", "with birth years, plus adults. At the season change players move up to their new age class, with a preview."],
          ["Plan training once:", "set training times per season, the app leaves out school holidays and public holidays."],
          ["Create games", "one by one or from a spreadsheet, home and away, with meeting point and squad."],
        ]),
      )}
${section(
  "alt",
  "On match day",
  "Kiosk, linesman, shirts.",
  "Helper duties for home games come from templates: cake and kiosk, assistant referee, washing shirts. Parents sign up themselves.",
  cards("g3", [
    ["Helper duties", "Templates for home and away games, parents take on duties themselves, the plan updates live."],
    ["Carpools", "Parents offer seats to the away game, players book one."],
    ["Attendance", "After the game the coach records who was there. Without an entry the response counts."],
  ]) + links([["/en/features/helper-duties/", "Helper duties"], ["/en/features/carpools/", "Carpools"], ["/en/features/attendance/", "Attendance"]]),
)}
${section(
  "",
  "Fixtures",
  "What about the association's schedule?",
  "Kabine connects to schedule systems only through permitted access: official APIs, public exports or the association's permission. There is no such connector for football yet; until then games come from a spreadsheet or are created one by one. If you know a permitted access, you can contribute a connector.",
  links([["/en/#contribute", "Contribute"], [`${GITHUB}/issues/new/choose`, "Open an issue"]]),
)}`,
    },
  },

  // Audiences ------------------------------------------------------------------------------------------
  {
    id: "coaches",
    de: {
      path: "/jugendtrainer/",
      title: "App für Jugendtrainer: Zu- und Absagen, Kader, Anwesenheit",
      description: "Weniger Nachrichten, mehr Training: Kabine zeigt Jugendtrainern, wer kommt, mit Gründen, erinnert automatisch und lässt Eltern für ihre Kinder antworten.",
      kicker: "Für Jugendtrainer",
      h1: "Wissen, wer <mark>kommt</mark>. Ohne Nachrichten-Chaos.",
      lead: "Kabine nimmt Jugendtrainern das Hinterhertelefonieren ab: Trainings entstehen aus dem Trainingsplan, Eltern sagen für ihre Kinder ab, die App erinnert, und nach dem Termin steht fest, wer da war.",
      body: `${section(
        "",
        "Vor dem Training",
        "Einmal planen, die ganze Saison wissen, wer kommt.",
        "",
        ticks([
          ["Trainingsplan statt Einzeltermine.", "Zeiten einmal pro Saison festlegen; Ferien und Feiertage der Region fallen von selbst weg, eine Trainingspause ist ein Klick."],
          ["Zugesagt, bis jemand absagt.", "Niemand muss jede Woche antworten. Wer absagt, gibt einen kurzen Grund an, den nur Trainer sehen."],
          ["Kurzfristige Absagen", "nach der Absagefrist kommen als Push, damit du planen kannst."],
          ["Dauerhaft verhindert oder inaktiv:", "für Verletzungen oder einen festen Wochentag, ohne jede Woche neu abzusagen."],
        ]),
      )}
${section(
  "alt",
  "Spiele",
  "Kader, Treffpunkt, Aushilfen.",
  "",
  cards("g3", [
    ["Kader nominieren", "Mit Stammkader, Kadergröße und Aushilfen aus anderen Mannschaften. Die Nominierten sehen das Spiel mit Treffpunkt."],
    ["Eltern antworten für Kinder", "Eltern sagen zu und ab und entscheiden, was ihr Kind in der App darf."],
    ["„Ich bin nicht da“", "Wenn du selbst nicht kannst, meldest du dich ab, ohne den Termin abzusagen. Die anderen Trainer sehen deine Notiz."],
  ]),
)}
${section(
  "",
  "Nach dem Termin",
  "Anwesenheit in einer Minute.",
  "Nach dem Training trägst du ein, wer da war: anwesend, entschuldigt, unentschuldigt. Ohne Eintrag zählt die Rückmeldung, wer nicht geantwortet hat, steht oben. Am Saisonende gibt es die Anwesenheitsstatistik.",
  links([["/funktionen/anwesenheit/", "Mehr zur Anwesenheit"]]),
)}
${section(
  "alt",
  "Kommunikation",
  "Ein Chat pro Mannschaft. Mit dir.",
  "Im Mannschaftschat sind Trainer immer dabei, private Nachrichten gibt es nicht. Mit Erwähnungen, Reaktionen und Benachrichtigungen.",
  shots("de", [
    ["03-coach-responses", "Die Trainerin sieht, wer zu- und wer abgesagt hat, mit Gründen", "Rückmeldungen"],
    ["04-squad", "Kader für ein Spiel nominieren", "Kader"],
    ["05-chat", "Mannschaftschat mit Trainerin, Mutter und Spielerin", "Chat"],
  ]),
)}`,
    },
    en: {
      path: "/en/youth-coaches/",
      title: "App for youth coaches: responses, squads, attendance",
      description: "Fewer messages, more training: Kabine shows youth coaches who is coming, with reasons, reminds automatically and lets parents respond for their children.",
      kicker: "For youth coaches",
      h1: "Know who is <mark>coming</mark>. Without message chaos.",
      lead: "Kabine saves youth coaches the chasing: trainings come from the training plan, parents decline for their children, the app reminds, and after the event it is clear who was there.",
      body: `${section(
        "",
        "Before training",
        "Plan once, know who is coming all season.",
        "",
        ticks([
          ["Training plan instead of single events.", "Set times once a season; the region's holidays drop out by themselves, a training break is one click."],
          ["Accepted until someone declines.", "Nobody has to answer every week. Whoever declines gives a short reason only coaches see."],
          ["Short-notice declines", "after the deadline come as a push, so you can plan."],
          ["Away long-term or inactive:", "for injuries or a fixed weekday, without declining again every week."],
        ]),
      )}
${section(
  "alt",
  "Games",
  "Squad, meeting point, stand-ins.",
  "",
  cards("g3", [
    ["Nominate the squad", "With core squad, squad size and stand-ins from other teams. The nominated see the game with the meeting point."],
    ["Parents respond for children", "Parents accept and decline and decide what their child may do in the app."],
    ["“I'm not there”", "If you cannot make it yourself, you say so without cancelling the event. The other coaches see your note."],
  ]),
)}
${section(
  "",
  "After the event",
  "Attendance in a minute.",
  "After training you record who was there: present, excused, unexcused. Without an entry the response counts, and who did not respond comes first. At the end of the season there are the attendance statistics.",
  links([["/en/features/attendance/", "More on attendance"]]),
)}
${section(
  "alt",
  "Communication",
  "One chat per team. With you in it.",
  "Coaches are always in the team chat, there are no private messages. With mentions, reactions and notifications.",
  shots("en", [
    ["03-coach-responses", "The coach sees who accepted and who declined, with reasons", "Responses"],
    ["04-squad", "Nominating the squad for a game", "Squad"],
    ["05-chat", "Team chat with coach, mother and player", "Chat"],
  ]),
)}`,
    },
  },
  {
    id: "board",
    de: {
      path: "/vorstand-datenschutz/",
      title: "DSGVO-konforme Vereins-App: Kabine für Vorstand und Datenschutz",
      description: "Datensparsam, ohne Tracking, Daten im eigenen Konto des Vereins: was Vorstand und Datenschutzbeauftragte über Kabine wissen müssen, mit Datenverzeichnis.",
      kicker: "Für Vorstand und Datenschutz",
      h1: "Eine Vereins-App, die der Datenschutz <mark>mitträgt</mark>.",
      lead: "Die meisten Nutzer sind Kinder. Kabine speichert deshalb so wenig wie möglich, verschlüsselt jede Verbindung, läuft im eigenen Konto des Vereins und kommt mit einer vollständigen Liste der gespeicherten Daten und einer Vorlage für die Datenschutzerklärung.",
      body: `${section(
        "",
        "Datensparsamkeit",
        "Vorname, Nachname, Jahrgang. Mehr nicht.",
        "Von Spielern und Eltern speichert Kabine nur Vorname, Nachname und bei Spielern den Jahrgang. Keine Adresse, kein Geburtsdatum. E-Mail und Telefonnummer sind freiwillig und nur für die Anmeldung da.",
        ticks([
          ["Rollen sehen nur, was sie brauchen:", "Absagegründe nur Trainer und Admins, Namen bei Helferdiensten abgekürzt („Kim M.“)."],
          ["Löschfristen eingebaut:", "Absagegründe nach 60 Tagen, Termine, Rückmeldungen und Chats zum Saisonwechsel, Personen beim Austritt."],
          ["Eltern entscheiden", "über Profilbilder und darüber, was ihr Kind in der App darf."],
          ["Kein Tracking, keine Werbung,", "keine fremden Skripte, Schriften oder Bilder."],
        ]) + links([["/docs/datenschutz/", "Datenschutz und Datenverzeichnis"]]),
      )}
${section(
  "alt",
  "Verantwortung",
  "Der Verein ist Verantwortlicher, Cloudflare Auftragsverarbeiter.",
  "Kabine läuft im eigenen Cloudflare-Konto des Vereins. Es gibt keinen zentralen Anbieter, der Daten sieht.",
  ticks([
    ["Auftragsverarbeitungsvertrag", "schließt der Verein im eigenen Cloudflare-Konto ab; er enthält die EU-Standardvertragsklauseln, Cloudflare ist unter dem EU-US Data Privacy Framework zertifiziert."],
    ["Datenbank in der EU:", "bei der Installation ausdrücklich in der EU angelegt, der Mannschaftschat liegt in der EU-Jurisdiktion."],
    ["Keine Selbstregistrierung:", "nur eingeladene Personen kommen in die App, angemeldet wird mit Passkey ohne Passwort."],
    ["Datenexport", "auf Knopfdruck, mit Hinweis auf den sicheren Umgang mit der Datei."],
  ]),
)}
${section(
  "",
  "Verschlüsselung",
  "Verschlüsselt übertragen, verschlüsselt gespeichert.",
  "Ja, das ist heute Standard. Bei Kinderdaten gehört es trotzdem ausdrücklich dazu.",
  ticks([
    ["HTTPS mit TLS auf jeder Verbindung:", "Die Adresse des Vereins bekommt automatisch ein Zertifikat, unverschlüsselte Aufrufe gibt es nicht, und der Browser merkt sich das (HSTS)."],
    ["Datenbank verschlüsselt gespeichert:", "Cloudflare D1 verschlüsselt alle Daten im Ruhezustand und bei der Übertragung, ohne dass der Verein etwas einstellen muss."],
    ["Sitzungen geschützt:", "Das Anmelde-Cookie ist für Skripte unlesbar (HttpOnly) und wird nur verschlüsselt gesendet (Secure)."],
    ["Keine Passwörter, keine fremden Skripte:", "Anmeldung mit Passkey; eine strenge Sicherheitsrichtlinie (CSP) lässt nur Code von der eigenen Adresse zu."],
  ]) + links([["https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/", "Cloudflare: Zertifikate (Universal SSL)"], ["https://developers.cloudflare.com/d1/reference/data-security/", "Cloudflare D1: Datensicherheit"]]),
)}
${section(
  "alt",
  "Warum Cloudflare?",
  "Sicherheit, die ein Verein allein nicht betreiben könnte.",
  "Ein eigener Server muss eingerichtet, aktualisiert, gesichert und überwacht werden, im Verein meist ehrenamtlich. Kabine läuft stattdessen auf der Plattform von Cloudflare, einem der größten Netzwerke für Sicherheit und Auslieferung im Internet.",
  cards("g3", [
    ["Schutz vor Überlastungsangriffen", "DDoS-Schutz ist in allen Tarifen enthalten, auch im kostenlosen, und wird nicht nach Menge berechnet. Angriffe werden automatisch erkannt und abgewehrt; laut Cloudflare hat das Netzwerk über 500 Tbit/s Kapazität."],
    ["Kein Server zum Pflegen", "Betriebssystem, Webserver und Sicherheitsupdates betreut die Plattform. Es gibt keinen offenen Port, keinen vergessenen Patch und kein Admin-Passwort für einen Server."],
    ["Weitgehend kostenlos", "Für einen üblichen Verein mit einigen hundert Mitgliedern reicht der kostenlose Tarif. Wer mehr Spielraum will, zahlt zurzeit 5 US-Dollar im Monat."],
    ["Geprüft und zertifiziert", "Cloudflare ist unter anderem nach ISO 27001 und SOC 2 zertifiziert; die Nachweise stehen im Trust Hub."],
    ["Wiederherstellung eingebaut", "Die Datenbank hat eine Historie (Time Travel), mit der sich ein Fehler auf einen früheren Stand zurückdrehen lässt."],
    ["Daten in der EU", "Datenbank und Mannschaftschat liegen in der EU-Jurisdiktion. Anfragen bearbeitet Cloudflare an Standorten in der Nähe der Nutzer."],
  ]) + links([["https://developers.cloudflare.com/ddos-protection/", "Cloudflare: DDoS-Schutz"], ["https://developers.cloudflare.com/workers/platform/pricing/", "Cloudflare: Preise der Plattform"], ["https://www.cloudflare.com/trust-hub/compliance-resources/", "Cloudflare: Zertifizierungen"]]),
)}
${section(
  "",
  "Ausblick",
  "Kabine auf eigenen Servern?",
  "Heute läuft Kabine nur bei Cloudflare. Das könnte sich ändern, ohne die App neu zu schreiben.",
  ticks([
    ["Die Laufzeit ist schon Open Source:", "workerd, der Kern von Cloudflare Workers, steht unter der Apache-2.0-Lizenz und lässt sich auf eigenen Servern betreiben."],
    ["Selbstbetrieb wird offiziell:", "Im Oktober 2026 ist das Team von Deno zu Cloudflare gewechselt, um Workers und Durable Objects auf eigener Infrastruktur zu einer offiziell unterstützten Möglichkeit zu machen, mit Ideen aus Denos celld."],
    ["Was für Kabine noch fehlt:", "Für die Datenbank (D1), den Schlüsselspeicher (KV), Warteschlangen und Zeitpläne gibt es noch keinen offiziellen Weg zum Selbstbetrieb. Erst wenn das steht, kann Kabine auch im eigenen Rechenzentrum oder bei einem deutschen Hoster laufen."],
    ["Gute Ausgangslage:", "Kabine baut vollständig auf dem Workers-Programmiermodell auf. Wird es außerhalb von Cloudflare verfügbar, wäre ein Umzug eine Anpassung, keine Neuentwicklung. Das Projekt verfolgt die Entwicklung."],
  ]) + links([["https://blog.cloudflare.com/deno-joins-cloudflare/", "Cloudflare: Deno is joining Cloudflare"], ["https://deno.com/blog/cloudflare", "Deno: Ankündigung"], ["https://github.com/cloudflare/workerd", "workerd auf GitHub"]]),
)}
${section(
  "alt",
  "Zum Nachlesen",
  "Offizielle Unterlagen von Cloudflare.",
  "Für die Prüfung durch Vorstand und Datenschutzbeauftragte, direkt beim Anbieter:",
  ticks([
    ["DSGVO bei Cloudflare:", `<a href="https://www.cloudflare.com/de-de/trust-hub/gdpr/">Trust Hub: DSGVO</a>`],
    ["Auftragsverarbeitungsvertrag (DPA)", `mit EU-Standardvertragsklauseln: <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">Cloudflare Customer DPA</a>`],
    ["Datenstandort der Datenbank (EU-Jurisdiktion):", `<a href="https://developers.cloudflare.com/d1/configuration/data-location/">D1: Data location</a>`],
    ["Datenstandort des Chats:", `<a href="https://developers.cloudflare.com/durable-objects/reference/data-location/">Durable Objects: Data location</a>`],
    ["Zertifizierungen (ISO 27001, SOC 2 u. a.):", `<a href="https://www.cloudflare.com/trust-hub/compliance-resources/">Compliance resources</a>`],
    ["EU-US Data Privacy Framework:", `<a href="https://www.dataprivacyframework.gov/list">Liste der zertifizierten Unternehmen</a> (nach „Cloudflare“ suchen)`],
  ]),
)}
${section(
  "",
  "Betrieb",
  "Wenig Aufwand, volle Kontrolle.",
  "",
  cards("g3", [
    ["Kontrollierte Updates", "Updates kommen als Pull Request, der Verein bestimmt den Zeitpunkt. Ändert ein Update die Datenbank, ruht die App eine Minute und es gibt einen Wiederherstellungspunkt."],
    ["Wartungsmodus", "Ein Schalter unter Verwaltung: Nur Admins kommen in die App, automatische Nachrichten pausieren."],
    ["Eigentümer geschützt", "Wer die Installation eingerichtet hat, kann von anderen Admins nicht ausgesperrt werden."],
  ]),
)}
${section(
  "alt",
  "Häufige Fragen",
  "Was Vorstände vor dem Start fragen.",
  "",
  faq([
    ["Was kostet Kabine?", "Die Software ist kostenlos (AGPL-3.0). Für einen üblichen Verein reicht der kostenlose Tarif von Cloudflare; SMS kosten nur, wenn das SMS-Modul eingeschaltet ist."],
    ["Wer hat Zugriff auf unsere Daten?", "Nur der Verein. Die Entwickler von Kabine haben keinen Zugriff auf die Daten irgendeines Vereins."],
    ["Was passiert, wenn wir aufhören?", "Daten exportieren, Worker, Datenbank, Speicher und Warteschlange im eigenen Konto löschen. Dann sind die Daten weg."],
    ["Ersetzt Kabine unsere Vereinsverwaltung?", "Nein. Mitgliederverwaltung, Beiträge, Buchhaltung und Website bleiben, wo sie sind. Kabine organisiert die Mannschaften."],
  ]),
)}`,
    },
    en: {
      path: "/en/club-board-privacy/",
      title: "GDPR-friendly club app: Kabine for the board and privacy",
      description: "Data-minimal, no tracking, data in the club's own account: what club boards and data protection officers need to know about Kabine, with data inventory.",
      kicker: "For the board and privacy",
      h1: "A club app your data protection officer can <mark>back</mark>.",
      lead: "Most users are children. So Kabine stores as little as possible, encrypts every connection, runs in the club's own account and comes with a complete list of the stored data and a template for the privacy policy.",
      body: `${section(
        "",
        "Data minimisation",
        "First name, last name, birth year. Nothing more.",
        "Of players and parents Kabine stores only first name, last name and, for players, the birth year. No address, no date of birth. E-mail and phone number are optional and only for signing in.",
        ticks([
          ["Roles see only what they need:", "decline reasons only coaches and admins, names shortened in helper duties (“Kim M.”)."],
          ["Deletion built in:", "decline reasons after 60 days, events, responses and chats at the season change, people when they leave."],
          ["Parents decide", "on profile pictures and on what their child may do in the app."],
          ["No tracking, no ads,", "no third-party scripts, fonts or images."],
        ]) + links([["/en/docs/privacy/", "Privacy and data inventory"]]),
      )}
${section(
  "alt",
  "Responsibility",
  "The club is the controller, Cloudflare the processor.",
  "Kabine runs in the club's own Cloudflare account. There is no central provider who sees data.",
  ticks([
    ["Data processing agreement", "is concluded by the club in its own Cloudflare account; it includes the EU standard contractual clauses, and Cloudflare is certified under the EU-US Data Privacy Framework."],
    ["Database in the EU:", "created explicitly in the EU at installation, the team chat is in the EU jurisdiction."],
    ["No self sign-up:", "only invited people get in, sign-in is by passkey without a password."],
    ["Data export", "at the push of a button, with a reminder to keep the file safe."],
  ]),
)}
${section(
  "",
  "Encryption",
  "Encrypted in transit, encrypted at rest.",
  "Yes, this is standard today. With children's data it still belongs on the list.",
  ticks([
    ["HTTPS with TLS on every connection:", "the club's address gets a certificate automatically, there are no unencrypted requests, and the browser remembers that (HSTS)."],
    ["Database encrypted at rest:", "Cloudflare D1 encrypts all data at rest and in transit, without any setting by the club."],
    ["Sessions protected:", "the sign-in cookie cannot be read by scripts (HttpOnly) and is only sent encrypted (Secure)."],
    ["No passwords, no third-party scripts:", "sign-in with passkeys; a strict security policy (CSP) only allows code from the club's own address."],
  ]) + links([["https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/", "Cloudflare: certificates (Universal SSL)"], ["https://developers.cloudflare.com/d1/reference/data-security/", "Cloudflare D1: data security"]]),
)}
${section(
  "alt",
  "Why Cloudflare?",
  "Security a club could not run on its own.",
  "A server of your own has to be set up, updated, backed up and monitored, in a club usually by a volunteer. Kabine runs on the Cloudflare platform instead, one of the largest security and delivery networks on the internet.",
  cards("g3", [
    ["Protection against overload attacks", "DDoS protection is included in every plan, the free one too, and is not billed by volume. Attacks are detected and mitigated automatically; according to Cloudflare the network has more than 500 Tbps of capacity."],
    ["No server to maintain", "Operating system, web server and security updates are the platform's job. No open port, no forgotten patch, no admin password for a server."],
    ["Largely free", "The free plan is enough for a typical club with a few hundred members. More headroom currently costs 5 US dollars a month."],
    ["Audited and certified", "Cloudflare is certified under ISO 27001 and SOC 2, among others; the reports are in its Trust Hub."],
    ["Recovery built in", "The database keeps a history (Time Travel) to roll a mistake back to an earlier state."],
    ["Data in the EU", "Database and team chat are in the EU jurisdiction. Cloudflare handles requests at locations near the users."],
  ]) + links([["https://developers.cloudflare.com/ddos-protection/", "Cloudflare: DDoS protection"], ["https://developers.cloudflare.com/workers/platform/pricing/", "Cloudflare: platform pricing"], ["https://www.cloudflare.com/trust-hub/compliance-resources/", "Cloudflare: certifications"]]),
)}
${section(
  "",
  "Outlook",
  "Kabine on your own servers?",
  "Today Kabine runs on Cloudflare only. That may change without rewriting the app.",
  ticks([
    ["The runtime is already open source:", "workerd, the core of Cloudflare Workers, is licensed under Apache-2.0 and can run on your own servers."],
    ["Self-hosting is becoming official:", "In October 2026 the Deno team joined Cloudflare to make Workers and Durable Objects on your own infrastructure a first-class supported option, with ideas from Deno's celld."],
    ["What Kabine still needs:", "For the database (D1), the key-value store (KV), queues and schedules there is no official way to self-host yet. Only then can Kabine run in your own data centre or at a local hosting provider."],
    ["A good starting point:", "Kabine is built entirely on the Workers programming model. Once that is available outside Cloudflare, moving would be an adaptation, not a rewrite. The project follows the development."],
  ]) + links([["https://blog.cloudflare.com/deno-joins-cloudflare/", "Cloudflare: Deno is joining Cloudflare"], ["https://deno.com/blog/cloudflare", "Deno: announcement"], ["https://github.com/cloudflare/workerd", "workerd on GitHub"]]),
)}
${section(
  "alt",
  "Further reading",
  "Official documents from Cloudflare.",
  "For review by the board and the data protection officer, straight from the provider:",
  ticks([
    ["GDPR at Cloudflare:", `<a href="https://www.cloudflare.com/trust-hub/gdpr/">Trust Hub: GDPR</a>`],
    ["Data processing agreement (DPA)", `with EU standard contractual clauses: <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">Cloudflare Customer DPA</a>`],
    ["Database location (EU jurisdiction):", `<a href="https://developers.cloudflare.com/d1/configuration/data-location/">D1: Data location</a>`],
    ["Chat location:", `<a href="https://developers.cloudflare.com/durable-objects/reference/data-location/">Durable Objects: Data location</a>`],
    ["Certifications (ISO 27001, SOC 2 and more):", `<a href="https://www.cloudflare.com/trust-hub/compliance-resources/">Compliance resources</a>`],
    ["EU-US Data Privacy Framework:", `<a href="https://www.dataprivacyframework.gov/list">list of certified companies</a> (search for “Cloudflare”)`],
  ]),
)}
${section(
  "",
  "Operation",
  "Little effort, full control.",
  "",
  cards("g3", [
    ["Controlled updates", "Updates arrive as a pull request, the club decides when. If an update changes the database, the app pauses for a minute and there is a restore point."],
    ["Maintenance mode", "One switch under administration: only admins get in, automatic messages pause."],
    ["Owner protected", "Whoever set up the installation cannot be locked out by other admins."],
  ]),
)}
${section(
  "alt",
  "FAQ",
  "What boards ask before starting.",
  "",
  faq([
    ["What does Kabine cost?", "The software is free (AGPL-3.0). The free Cloudflare plan is enough for a typical club; SMS cost money only if the SMS module is switched on."],
    ["Who can access our data?", "Only the club. The developers of Kabine have no access to any club's data."],
    ["What happens if we stop?", "Export the data, delete the Worker, database, storage and queue in your own account. Then the data is gone."],
    ["Does Kabine replace our club management software?", "No. Membership, fees, accounting and the website stay where they are. Kabine organises the teams."],
  ]),
)}`,
    },
  },

  // Features -------------------------------------------------------------------------------------------
  {
    id: "duties",
    de: {
      path: "/funktionen/helferdienste/",
      title: "Helferdienste im Verein planen: Kuchen, Kasse, Zeitnehmer",
      description: "Helferdienste für Heimspiele und Vereinsfeste: Vorlagen, Live-Plan, Eltern tragen sich selbst ein. In Kabine, der freien Mannschafts-App.",
      kicker: "Funktion · Helferdienste",
      h1: "Helferdienste, die sich <mark>selbst</mark> füllen.",
      lead: "Kuchen, Theke, Kasse, Zeitnehmer: Für jedes Heimspiel entsteht der Helferplan aus einer Vorlage, Eltern tragen sich selbst ein, und alle sehen live, was noch offen ist.",
      body: `${section(
        "",
        "So funktioniert es",
        "Einmal einrichten, jeden Spieltag nutzen.",
        "",
        ticks([
          ["Vorlagen für Heim und Auswärts:", "Die Mannschaft wählt, welche Dienste zu ihren Spielen gehören, mit Zeitfenstern vor und nach dem Spiel."],
          ["Eltern tragen sich selbst ein,", "für sich oder für ihr Kind. Wer schon einen Dienst hat, wird nicht mehr gefragt."],
          ["Live-Plan:", "Der Plan aktualisiert sich bei allen sofort, ohne Neuladen."],
          ["Auf der Startseite:", "Eigene Dienste stehen beim Termin, offene Plätze werden angezeigt, bis sie besetzt sind."],
        ]),
      )}
${section(
  "alt",
  "Auch für Vereinsfeste",
  "Sondertermine mit Zeitblöcken.",
  "Für Turniere, Feste und Arbeitseinsätze legt der Organisator Zeitblöcke mit Diensten an, auch einmalige wie Grill. Weitere Organisatoren helfen beim Verwalten.",
  shots("de", [["07-helper-duties", "Helferdienste für ein Heimspiel", "Helferplan eines Heimspiels"]]),
)}
${section(
  "",
  "Je nach Sportart",
  "Die passenden Dienste von Anfang an.",
  "Das Sportprofil bringt typische Dienste mit, zum Beispiel Zeitnehmer und Sekretär im Handball oder Linienrichter im Fußball. Admins passen Dienstarten und Vorlagen an.",
  links([["/handball/", "Handball"], ["/fussball/", "Fußball"]]),
)}`,
    },
    en: {
      path: "/en/features/helper-duties/",
      title: "Plan club helper duties: cake, kiosk, timekeeper",
      description: "Helper duties for home games and club events: templates, live plan, parents sign up themselves. In Kabine, the free team app.",
      kicker: "Feature · Helper duties",
      h1: "Helper duties that fill <mark>themselves</mark>.",
      lead: "Cake, kiosk, till, timekeeper: for every home game the helper plan comes from a template, parents sign up themselves, and everyone sees live what is still open.",
      body: `${section(
        "",
        "How it works",
        "Set up once, use every match day.",
        "",
        ticks([
          ["Templates for home and away:", "the team chooses which duties belong to its games, with time slots before and after the game."],
          ["Parents sign up themselves,", "for themselves or their child. Whoever already has a duty is not asked again."],
          ["Live plan:", "the plan updates for everyone at once, without reloading."],
          ["On the start page:", "your own duties show with the event, open slots are shown until they are filled."],
        ]),
      )}
${section(
  "alt",
  "Also for club events",
  "Special events with time blocks.",
  "For tournaments, parties and work days the organiser creates time blocks with duties, also one-off ones like the barbecue. Further organisers help manage them.",
  shots("en", [["07-helper-duties", "Helper duties for a home game", "Helper plan of a home game"]]),
)}
${section(
  "",
  "By sport",
  "The right duties from the start.",
  "The sport profile brings typical duties, for example timekeeper and scorer in handball or assistant referee in football. Admins adjust duty types and templates.",
  links([["/en/handball/", "Handball"], ["/en/football/", "Football"]]),
)}`,
    },
  },
  {
    id: "carpools",
    de: {
      path: "/funktionen/fahrgemeinschaften/",
      title: "Fahrgemeinschaften zum Auswärtsspiel organisieren",
      description: "Eltern bieten Plätze an, Spieler buchen sich ein, der Chat erinnert, solange noch jemand sucht: Fahrgemeinschaften für Auswärtsspiele in Kabine.",
      kicker: "Funktion · Fahrgemeinschaften",
      h1: "Wer fährt? <mark>Geklärt.</mark>",
      lead: "Für Auswärtsspiele bieten Eltern Plätze im Auto an, Spieler buchen sich ein. Niemand muss im Chat durchzählen.",
      body: `${section(
        "",
        "So funktioniert es",
        "Plätze anbieten, Plätze buchen.",
        "",
        ticks([
          ["Fahrer bieten freie Plätze an,", "direkt beim Spiel, und ändern die Zahl jederzeit."],
          ["Spieler buchen", "einen Platz, auch mit Begleitung; wer noch sucht, steht unter „Suchen noch“."],
          ["Der Mannschaftschat erinnert", "vor dem Spiel, solange noch jemand sucht."],
          ["Trainer behalten den Überblick", "und tragen bei Bedarf jemanden als Mitfahrer ein."],
          ["Abgekürzte Namen:", "Mitfahrer sehen „Kim M.“, keine Telefonnummern."],
        ]),
      )}
${section(
  "alt",
  "Bild",
  "So sieht es aus.",
  "",
  shots("de", [["06-carpool", "Fahrgemeinschaft zu einem Auswärtsspiel", "Fahrgemeinschaft"]]),
)}`,
    },
    en: {
      path: "/en/features/carpools/",
      title: "Organise carpools to away games",
      description: "Parents offer seats, players book one, the chat reminds while someone is still looking: carpools for away games in Kabine, the free team app.",
      kicker: "Feature · Carpools",
      h1: "Who drives? <mark>Sorted.</mark>",
      lead: "For away games parents offer seats in their car, players book one. Nobody has to count in the chat.",
      body: `${section(
        "",
        "How it works",
        "Offer seats, book seats.",
        "",
        ticks([
          ["Drivers offer free seats,", "right at the game, and change the number at any time."],
          ["Players book", "a seat, also with companions; whoever still needs one is listed under “Still looking”."],
          ["The team chat reminds", "before the game while someone is still looking."],
          ["Coaches keep the overview", "and add someone as a passenger if needed."],
          ["Shortened names:", "passengers see “Kim M.”, no phone numbers."],
        ]),
      )}
${section(
  "alt",
  "Screenshot",
  "This is how it looks.",
  "",
  shots("en", [["06-carpool", "Carpool to an away game", "Carpool"]]),
)}`,
    },
  },
  {
    id: "attendance",
    de: {
      path: "/funktionen/anwesenheit/",
      title: "Anwesenheit im Training erfassen: anwesend, entschuldigt",
      description: "Nach dem Training eintragen, wer da war: anwesend, entschuldigt, unentschuldigt. Ohne Eintrag zählt die Rückmeldung. Mit Saisonstatistik.",
      kicker: "Funktion · Anwesenheit",
      h1: "Wer war <mark>da</mark>? In einer Minute eingetragen.",
      lead: "Nach dem Termin hält der Trainer fest, wer wirklich da war. Weil die Rückmeldungen schon da sind, ist meist nur noch ein Tipp nötig.",
      body: `${section(
        "",
        "So funktioniert es",
        "Ohne Eintrag zählt die Rückmeldung.",
        "Wer zugesagt hat, gilt als anwesend; wer abgesagt hat, ist entschuldigt. Wer nicht geantwortet hat, steht oben unter „Noch einzutragen“.",
        ticks([
          ["Anwesend, entschuldigt, unentschuldigt", "pro Person mit einem Tipp, auch „abgesagt, aber doch gekommen“."],
          ["Die Rückmeldung bleibt,", "der Eintrag des Trainers gilt."],
          ["Bis zum Ende des Folgetags", "tragen Trainer ein, Admins die ganze Saison."],
          ["Spieler und Eltern", "sehen ihren eigenen Eintrag, wenn er von ihrer Rückmeldung abweicht. Ohne Push."],
        ]),
      )}
${section(
  "alt",
  "Statistik",
  "Die Saison in Zahlen.",
  "Zum Saisonwechsel verdichtet Kabine die Anwesenheit zu Zahlen pro Person und Mannschaft: Trainings und Spiele, anwesend, unentschuldigt, kurzfristige Absagen. Die Termine selbst werden gelöscht, die Zahlen bleiben.",
  links([["/jugendtrainer/", "Für Jugendtrainer"]]),
)}`,
    },
    en: {
      path: "/en/features/attendance/",
      title: "Record training attendance: present, excused, unexcused",
      description: "Record after training who was there: present, excused, unexcused. Without an entry the response counts. With season statistics.",
      kicker: "Feature · Attendance",
      h1: "Who was <mark>there</mark>? Recorded in a minute.",
      lead: "After the event the coach records who was really there. Because the responses are already in, usually a single tap is enough.",
      body: `${section(
        "",
        "How it works",
        "Without an entry the response counts.",
        "Whoever accepted counts as present; whoever declined is excused. Whoever did not respond is listed first under “Still to record”.",
        ticks([
          ["Present, excused, unexcused", "per person with one tap, also “declined but came anyway”."],
          ["The response stays,", "the coach's entry counts."],
          ["Until the end of the following day", "coaches record, admins the whole season."],
          ["Players and parents", "see their own entry where it differs from their response. No push."],
        ]),
      )}
${section(
  "alt",
  "Statistics",
  "The season in numbers.",
  "At the season change Kabine condenses attendance into figures per person and team: trainings and games, present, unexcused, short-notice declines. The events are deleted, the figures stay.",
  links([["/en/youth-coaches/", "For youth coaches"]]),
)}`,
    },
  },
];
