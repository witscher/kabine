import { useClub } from "../club";
import { useSession } from "../session";
import { TopBar, useDocumentTitle } from "../ui";

export function PrivacyPage() {
  useDocumentTitle("Datenschutz");
  const { me } = useSession();
  const club = useClub();
  return (
    <main class={`page ${me ? "" : "no-tabs"}`}>
      <TopBar title="Datenschutz und Quellen" back={me ? "/profil" : "/"} />
      <div class="content">
        <section class="card card-pad stack">
          <h2 style={{ fontSize: "22px" }}>Verantwortlich</h2>
          <p>
            Die App ist ein internes Angebot von {club.name}.{" "}
            {club.privacyUrl ? (
              <>
                Die vollständige Datenschutzerklärung und das Impressum des Vereins findest du auf <a href={club.privacyUrl}>{new URL(club.privacyUrl).host}</a>.{" "}
              </>
            ) : null}
            Die folgenden Hinweise beschreiben, was speziell in dieser App gespeichert wird.
          </p>
          {club.privacyText ? <p style={{ whiteSpace: "pre-line" }}>{club.privacyText}</p> : null}
        </section>
        <section class="card card-pad stack">
          <h2 style={{ fontSize: "22px" }}>Welche Daten speichert die App?</h2>
          <p>
            Von Spielerinnen, Spielern und Eltern nur Vorname, Nachname und (bei Spielern) das Geburtsjahr. Keine Telefonnummer, keine Anschrift. Admins sind
            zusätzlich über ihre E-Mail-Adresse erkennbar.
          </p>
          <p>
            Die E-Mail-Adresse an deinem Zugang dient der Anmeldung. Erinnerungen zum Helferplan kommen nur per Mail, wenn du das im Profil einschaltest. Beim
            Feedback geht sie nur mit, wenn du eine Antwort wünschst. Sonst sieht sie niemand, auch Trainer und Admins nicht.
          </p>
          <p>
            Ein Profilbild ist freiwillig. Es sehen alle, die in der App angemeldet sind. Bei Minderjährigen gibt ein Elternteil das Bild frei, bevor andere es
            sehen. Du kannst dein Bild jederzeit entfernen, beim Austritt aus dem Verein wird es gelöscht.
          </p>
          <p>
            Technisch notwendig sind außerdem: Passkeys (nur ein öffentlicher Schlüssel, nie biometrische Daten), Anmeldungen auf Geräten und Push-Abos für
            Benachrichtigungen. Damit die App auch ohne Netz funktioniert, speichert sie die zuletzt geladenen Inhalte auf deinem Gerät. Beim Abmelden werden
            sie gelöscht.
          </p>
          <p>
            Zu- und Absagen mit Begründung sehen nur Trainer und Admins. Bitte gib bei Absagen keine Details zu Erkrankungen an, „krank“ genügt. Begründungen
            werden 60 Tage nach dem Termin automatisch gelöscht.
          </p>
          <p>
            Im Helferplan sehen die Helfenden einer Mannschaft, wer welchen Dienst übernimmt, als „Vorname N.“. Der persönliche Kalender-Link enthält nur deine
            eigenen Dienste und die deiner Kinder.
          </p>
          <p>Rückmeldungen über „Hilfe und Feedback“ gehen per Mail an den Betreuer der App und werden in der App nicht gespeichert.</p>
          <p>Zu jedem Zugang speichert die App den Tag der letzten Nutzung, ohne Uhrzeit. Ihn sehen nur Admins, damit sie ungenutzte Zugänge erkennen.</p>
          <p>Chatverläufe werden zum Saisonwechsel gelöscht. Nach einem Vereinsaustritt werden alle Daten spätestens beim nächsten Saisonwechsel gelöscht.</p>
        </section>
        <section class="card card-pad stack">
          <h2 style={{ fontSize: "22px" }}>Quellen</h2>
          <p>
            Ferientermine: <a href="https://www.openholidaysapi.org">OpenHolidays API</a>, Daten unter der{" "}
            <a href="https://opendatacommons.org/licenses/odbl/">Open Database License (ODbL)</a>.
          </p>
          <p>Spielpläne: handball4all. Der Abruf erfolgt nur vom Gerät eines Trainers oder Admins.</p>
          <p>
            Icon Helferplan: <a href="https://lucide.dev">Lucide</a> (ISC-Lizenz).
          </p>
          <p>Schriften: Barlow und Barlow Condensed (SIL Open Font License), direkt von dieser App ausgeliefert.</p>
        </section>
      </div>
    </main>
  );
}
