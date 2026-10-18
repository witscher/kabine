// Häufige Fragen unter Hilfe. Jeder sieht die Abschnitte seiner Rolle; Trainer und Admins
// sehen alle, damit sie Fragen von Spielern und Eltern beantworten können.
import type { ComponentChildren } from "preact";
import { Icon } from "./icons";
import { useMe } from "./session";

interface Faq {
  q: string;
  a: ComponentChildren;
}

const ALL: Faq[] = [
  {
    q: "Ich habe ein neues Handy und komme nicht mehr in die App.",
    a: (
      <>
        <p>
          Ist das neue Handy mit demselben Apple- bzw. Google-Konto angemeldet, ist dein Passkey meist schon da: einfach <em>Mit Passkey anmelden</em>.
        </p>
        <p>
          Klappt das nicht und du hast eine E-Mail-Adresse hinterlegt, nimm <em>Code per E-Mail</em>. Sonst schickt dir dein Trainer einen persönlichen Link (7 Tage
          gültig, einmal nutzbar), damit richtest du einen neuen Passkey ein. Bei Kindern können das auch die Eltern unter <em>Profil → Kind</em>.
        </p>
      </>
    ),
  },
  {
    q: "Wie installiere ich die App auf dem Handy?",
    a: (
      <p>
        Auf dem iPhone in Safari unten auf <em>Teilen</em> und <em>Zum Home-Bildschirm</em> tippen, auf Android im Browsermenü <em>App installieren</em>. Weiter unten
        unter Anleitungen steht es Schritt für Schritt.
      </p>
    ),
  },
  {
    q: "Warum kann ich die App nicht aus dem App Store installieren?",
    a: (
      <p>
        Die App gehört nur unserem Verein und läuft auf einer eigenen Adresse. Wäre sie im App Store, hätte die ganze Welt Zugriff auf die App. Das ist unnötig
        und das wollen wir auch nicht.
      </p>
    ),
  },
  {
    q: "Wie bekomme ich meine Termine in meinen Kalender?",
    a: (
      <p>
        Unter <em>Profil → Meine Termine</em> wählst du Training, Spiele und Helferdienste aus und tippst auf <em>Im Kalender abonnieren</em>. Die Termine erscheinen
        dann in der Kalender-App deines Handys und bleiben von selbst aktuell. Den Link nicht weitergeben.
      </p>
    ),
  },
  {
    q: "Ich bekomme keine Benachrichtigungen.",
    a: (
      <p>
        Unter <em>Profil → Benachrichtigungen</em> auf <em>Auf diesem Gerät aktivieren</em> tippen und erlauben, dann mit <em>Testen</em> prüfen. Auf dem iPhone geht
        das nur in der installierten App (ab iOS 16.4), nicht im Browser. Welche Themen du bekommst, wählst du dort ebenfalls.
      </p>
    ),
  },
  {
    q: "Was ist ein Passkey und ist das sicher?",
    a: (
      <p>
        Du meldest dich mit Face ID, Fingerabdruck oder der Gerätesperre an, ohne Passwort. Das ist sicherer als ein Passwort, weil es nicht erraten oder abgefangen
        werden kann. Die App bekommt dabei nie biometrische Daten zu sehen.
      </p>
    ),
  },
  {
    q: "Wer sieht meine Absagegründe?",
    a: <p>Nur die Trainer der Mannschaft und die Admins. Andere Spieler und Eltern sehen nur, wie viele zu- oder abgesagt haben. 60 Tage nach dem Termin wird der Grund gelöscht.</p>,
  },
  {
    q: "Welche Daten speichert die App über mich?",
    a: (
      <p>
        Vorname, Nachname und Jahrgang, dazu freiwillig eine E-Mail-Adresse und ein Profilbild. Außerdem deine Zu- und Absagen, Helferdienste und Chatnachrichten. Mehr
        dazu steht im <a href="/datenschutz">Datenschutzhinweis</a>.
      </p>
    ),
  },
];

const PLAYERS: Faq[] = [
  {
    q: "Muss ich jedem Training zusagen?",
    a: <p>Nein. Du bist automatisch dabei. Nur wenn du nicht kommen kannst, sagst du ab.</p>,
  },
  {
    q: "Bis wann kann ich absagen?",
    a: (
      <p>
        Bis zur Absagefrist, meist 6 Stunden vor Beginn. Die genaue Frist steht im Termin. Danach geht es weiterhin, gilt aber als kurzfristig, und dein Trainer bekommt
        eine Nachricht. Einen Grund brauchst du immer.
      </p>
    ),
  },
  {
    q: "Mein Name fehlt im Einladungslink oder ist schon vergeben.",
    a: <p>Sag deinem Trainer Bescheid. Er ergänzt dich oder prüft, wer sich mit deinem Namen angemeldet hat.</p>,
  },
  {
    q: "Ich bin länger verletzt oder kann an einem Wochentag nie.",
    a: (
      <p>
        Sag es deinem Trainer. Er setzt dich inaktiv oder für diesen Wochentag dauerhaft abwesend. Dann musst du nicht jedes Mal einzeln absagen und bekommst keine
        Erinnerungen.
      </p>
    ),
  },
  {
    q: "Was heißt „unentschuldigt gefehlt“?",
    a: <p>Du hast nicht abgesagt und warst trotzdem nicht da. Das trägt der Trainer nach dem Termin ein. Sehen können es nur du, deine Eltern und die Trainer.</p>,
  },
  {
    q: "Warum erscheint mein Profilbild nicht sofort?",
    a: <p>Bei Minderjährigen geben die Eltern das Bild frei. Bis dahin sehen es nur du und deine Eltern.</p>,
  },
];

const PARENTS: Faq[] = [
  {
    q: "Wie bekommt mein Kind einen eigenen Zugang?",
    a: (
      <p>
        Unter <em>Profil → dein Kind</em> auf <em>Zugang für … einrichten</em> tippen. Den Link (7 Tage gültig, einmal nutzbar) gibst du nur deinem Kind oder öffnest
        ihn direkt auf seinem Handy. Hat dein Kind ein neues Handy, erzeugst du dort einen <em>Link für neuen Passkey</em>. Das geht in Mannschaften, in denen Eltern
        eingebunden sind.
      </p>
    ),
  },
  {
    q: "Ich habe Kinder in verschiedenen Mannschaften.",
    a: (
      <p>
        Melde dich zuerst mit deinem bestehenden Zugang an und öffne dann den Elternlink der anderen Mannschaft. Dort verknüpfst du das Kind mit deinem Zugang. Ein
        zweiter Zugang ist nicht nötig.
      </p>
    ),
  },
  {
    q: "Kann auch das zweite Elternteil mitmachen?",
    a: <p>Ja, über denselben Elternlink der Mannschaft mit eigenem Zugang. Pro Kind können zwei Elternteile verknüpft sein.</p>,
  },
  {
    q: "Sagt mein Kind selbst ab oder ich?",
    a: (
      <p>
        Beides ist möglich, es gilt die letzte Rückmeldung. Ihr seht jeweils, wer geantwortet hat. Was dein Kind selbst darf (zusagen, absagen, Chat), stellst du unter{" "}
        <em>Profil → dein Kind</em> ein. In Mannschaften ohne Eltern-Einbindung, meist den älteren, regelt das Kind alles selbst.
      </p>
    ),
  },
  {
    q: "Wie trage ich mich im Helferplan ein?",
    a: (
      <p>
        Im Reiter <em>Helfer</em> beim Dienst auf <em>Eintragen</em> tippen. Jeder Dienst hat eine Uhrzeit, Aufgaben wie Trikots waschen erledigst du vor oder
        nach dem Termin. Dienste mit Vorkenntnissen, etwa Zeitnehmer und Sekretär, bietet dir die App nur an, wenn du sie unter <em>Profil → Das kann ich</em>{" "}
        einschaltest. Deine Dienste kannst du unter <em>Profil → Meine Termine</em> im Kalender abonnieren.
      </p>
    ),
  },
  {
    q: "Ich möchte keine Chatnachrichten bekommen.",
    a: (
      <p>
        Im Chat der Mannschaft kannst du dich über das Menü <em>Vom Chat abmelden</em> und später wieder anmelden. Nur die Push-Nachrichten abschalten geht unter{" "}
        <em>Profil → Benachrichtigungen</em>.
      </p>
    ),
  },
];

const COACHES: Faq[] = [
  {
    q: "Wie kommen Spieler und Eltern in die App?",
    a: (
      <p>
        Unter <em>Team → Einladungen</em> den Spieler- bzw. Elternlink erzeugen und in die WhatsApp-Gruppe der Mannschaft schicken. Jeder wählt dort seinen Namen bzw.
        sein Kind aus.
      </p>
    ),
  },
  {
    q: "Ein Spieler oder Elternteil kommt nicht mehr in die App.",
    a: (
      <p>
        Im Kader die Person öffnen und <em>Link für neuen Passkey</em> (bzw. <em>Persönlichen Einladungslink</em>) erzeugen. Den Link nur direkt an diese Person
        schicken, er ist 7 Tage gültig und einmal nutzbar.
      </p>
    ),
  },
  {
    q: "Wie nominiere ich den Kader für ein Spiel?",
    a: (
      <p>
        Im Spiel auf <em>Kader nominieren</em> tippen, auswählen und veröffentlichen. Fehlen Leute, holst du über <em>Aushilfe anfragen</em> Spieler aus anderen
        Mannschaften. Mit <em>Stammkader festlegen</em> (Team → Kader) und dem Schalter <em>Stammkader automatisch für alle Spiele nominieren</em> (Team → Einstellungen) ist der Stammkader für alle Spiele vorab nominiert.
      </p>
    ),
  },
  {
    q: "Ein Spieler soll auch in der zweiten Mannschaft spielen.",
    a: (
      <p>
        Im Kader auf <em>Hinzufügen → Aus anderer Mannschaft</em> und die Person aufnehmen. Sie spielt dann in beiden Mannschaften, gemeinsame Trainings sieht sie nur
        einmal.
      </p>
    ),
  },
  {
    q: "Training absagen, verschieben oder in den Ferien aussetzen.",
    a: (
      <p>
        Im Training auf <em>Absagen</em> oder <em>Verschieben</em> tippen, alle bekommen eine Nachricht. Für Ferien unter <em>Team → Trainingspläne</em> bei den Ferien{" "}
        <em>Trainingspause</em> oder einen eigenen <em>Ferienplan</em> wählen.
      </p>
    ),
  },
  {
    q: "Wie aktualisiere ich den Spielplan?",
    a: (
      <p>
        Unter <em>Team → Einstellungen → Spielplan</em> auf <em>Jetzt abgleichen</em> tippen. Die App holt den Spielplan nur auf Knopfdruck von handball4all, nie
        automatisch. Verlegte Spiele melden sich dann bei allen.
      </p>
    ),
  },
  {
    q: "Für einen Spieler absagen oder „fehlt unentschuldigt“ eintragen.",
    a: (
      <p>
        Im Termin auf den Namen tippen. Vor dem Termin kannst du dort für ihn absagen oder wieder zusagen. Nach Beginn erscheint der Schalter{" "}
        <em>Fehlt unentschuldigt</em>. Vergangene Termine findest du unter <em>Termine → Vergangen</em>.
      </p>
    ),
  },
  {
    q: "Inaktiv oder dauerhaft abwesend: Was ist der Unterschied?",
    a: (
      <p>
        <em>Inaktiv</em> gilt für alle Termine, etwa bei Verletzung oder Auslandsaufenthalt. <em>Dauerhaft abwesend</em> gilt nur für eine bestimmte Trainingszeit,
        etwa jeden Dienstag. In beiden Fällen muss niemand absagen und es gibt keine Erinnerungen.
      </p>
    ),
  },
  {
    q: "Was ist der Unterschied zwischen Gruppe und Mannschaft?",
    a: (
      <p>
        Eine <em>Gruppe</em> hat nur einen Chat und Sondertermine mit Zu- und Absage, etwa das Trainerteam. Training, Spiele, Kader, Helferplan und Eltern gibt es nur
        bei Mannschaften. Wer eine Gruppe verantwortet, legt unter <em>Team</em> Sondertermine an und moderiert den Chat. Mitglieder ordnet ein Admin zu.
      </p>
    ),
  },
  {
    q: "Helferplätze ändern oder ein Spiel ohne handball4all anlegen.",
    a: (
      <p>
        Im Reiter <em>Helfer</em> auf der Karte <em>Verwalten</em>: Uhrzeit und Plätze je Dienst ändern (0 blendet ihn aus), einen Zeitblock hinzufügen oder
        entfernen, jemanden eintragen oder das Spiel ausblenden. Freundschaftsspiele, Turniere oder Spieltage ohne handball4all legst du unter{" "}
        <em>Team → Termin anlegen → Spiel</em> an, die Mannschaft bekommt dann eine Nachricht.
      </p>
    ),
  },
  {
    q: "Welche Dienste gibt es bei unseren Spielen, und wie bekommt ein Sondertermin Helfer?",
    a: (
      <p>
        Die Dienste eines Spiels kommen aus einer Vorlage. Unter <em>Team → Einstellungen → Helferplan</em> wählst du die Vorlage für Heim- und Auswärtsspiele;
        Vorlagen und Dienstarten pflegen Admins unter <em>Verwaltung → Helferdienste</em>. Beim Sondertermin schaltest du <em>Helfer benötigt</em> ein und legst
        Zeitblöcke an, auch einen eigenen Dienst nur für diesen Termin, etwa Grill. Bei einem bestehenden Sondertermin geht das im Termin unter{" "}
        <em>Helfer: Zeitblock hinzufügen</em>. Dort fügst du unter <em>Organisatoren</em> auch weitere Personen hinzu, die die Helferdienste mitverwalten.
      </p>
    ),
  },
];

function Section(props: { title: string; items: Faq[] }) {
  return (
    <section class="stack-sm" aria-label={`Häufige Fragen: ${props.title}`}>
      <h3 class="faq-group">{props.title}</h3>
      {props.items.map((f) => (
        <details class="card howto-fold faq">
          <summary>
            <span>{f.q}</span>
            <Icon name="chevron" size={18} />
          </summary>
          <div class="card-body">{f.a}</div>
        </details>
      ))}
    </section>
  );
}

export function FaqList() {
  const me = useMe();
  const isCoach = me.isAdmin || me.manageableTeams.length > 0;
  const isPlayer = me.memberships.some((m) => m.role === "player" || m.role === "helper");
  const isParent = me.children.length > 0;
  return (
    <section class="stack" aria-label="Häufige Fragen">
      <h2 class="section-title">Häufige Fragen</h2>
      <Section title="Für alle" items={ALL} />
      {isPlayer || isCoach ? <Section title="Spielerinnen und Spieler" items={PLAYERS} /> : null}
      {isParent || isCoach ? <Section title="Eltern" items={PARENTS} /> : null}
      {isCoach ? <Section title="Trainerinnen und Trainer" items={COACHES} /> : null}
    </section>
  );
}
