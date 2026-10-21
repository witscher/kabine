# Datenschutz und Jugendschutz

Kabine wird vor allem von Kindern, Jugendlichen und ihren Eltern genutzt. Die App speichert so wenig wie möglich, zeigt es so wenigen wie möglich und behält es im Verein. Diese Seite beschreibt, was gespeichert wird, wer es sieht und wann es gelöscht wird. Sie hilft dem Verein bei der Datenschutzerklärung und beim Verzeichnis der Verarbeitungstätigkeiten. Sie ist keine Rechtsberatung; verantwortlich bleibt der Verein. Die englische Fassung steht in [privacy.md](privacy.md).

## Grundsätze

- **Ein Verein, eine Installation.** Die Daten liegen im eigenen Cloudflare-Konto des Vereins. Es gibt keinen zentralen Kabine-Server und keine gemeinsame Datenbank mehrerer Vereine. Die Entwickler von Kabine haben keinen Zugriff.
- **Nur, was eine Mannschaft braucht.** Von Spielern und Eltern Vorname und Nachname, von Spielern zusätzlich der Jahrgang. Keine Adresse, kein Geburtsdatum, keine Telefonnummer (außer jemand trägt sie selbst für SMS ein), keine Fotos, außer jemand lädt ein Profilbild hoch.
- **Nur mit Einladung.** Es gibt keine öffentliche Registrierung und keine öffentliche Seite mit Inhalten. Man kommt über Links hinein, die die Trainer in der Mannschaft teilen.
- **Kein Tracking.** Keine Statistikdienste, keine Werbung, keine fremden Skripte, Schriften oder Bilder zur Laufzeit. Die App lädt alles von der eigenen Adresse des Vereins.
- **Gründe bleiben bei den Trainern.** Warum jemand absagt, sehen nur Trainer und Admins. Die Gründe werden 60 Tage nach dem Termin gelöscht.

## Jugendschutz

- **Eltern entscheiden für Minderjährige.** Wenn eine Mannschaft Eltern einbindet, verbinden sich die Eltern mit dem Profil des Kindes und legen fest, was es in der App darf: zusagen, absagen, den Mannschaftschat lesen, darin schreiben, Aushilfe-Anfragen beantworten. Jede Änderung wird protokolliert (wer, wann). Ältere Jugend und Erwachsene kommen ohne Eltern aus.
- **Profilbilder nur mit Freigabe.** Ein Bild, das ein Minderjähriger hochlädt, sehen andere erst nach der Freigabe durch ein Elternteil. Profilbilder sind freiwillig, nur für Angemeldete sichtbar und werden beim Austritt gelöscht.
- **Chat unter Aufsicht.** In jedem Mannschaftschat sind die Trainer dabei. Sie können Mitglieder stummschalten und Nachrichten löschen. Eltern lesen im Chat der Mannschaften ihrer Kinder mit, wenn sie sich nicht abmelden. Private Nachrichten zwischen Mitgliedern gibt es nicht.
- **Abgekürzte Namen, wo andere sie sehen.** Helferdienste und Fahrgemeinschaften zeigen anderen Eltern und Spielern „Vorname N.“. Vollständige Namen sehen Trainer und Admins.
- **Austritt ist vollständig.** Wer den Verein verlässt, verliert sofort Anmeldungen, Passkeys, Push-Abos, Profilbild und künftige Rückmeldungen. Die Person und ihr Verlauf sind spätestens zum nächsten Saisonwechsel gelöscht. Chatverläufe werden bei jedem Saisonwechsel gelöscht.

## Übersicht der Daten

| Daten | Von wem | Zweck | Sichtbar für | Gelöscht |
| --- | --- | --- | --- | --- |
| Vorname, Nachname | Alle | Personen in der Mannschaft erkennen | Angemeldete der eigenen Mannschaft, abgekürzt wie oben beschrieben | Beim Austritt, spätestens zum nächsten Saisonwechsel |

Den eigenen Namen ändern nur Admins; Spieler, Eltern und Trainer wenden sich an ihren Trainer oder einen Admin, die ihn korrigieren (Recht auf Berichtigung, Art. 16 DSGVO). So weiß jeder, wer wer ist, und Kinder können sich nicht umbenennen.

| Jahrgang | Spieler | Altersklasse und Mannschaft | Trainer, Admins | Wie oben |
| Mannschaften, Rollen | Alle | Wer welche Termine und Chats sieht | Mannschaft (Trainer und Admins vollständig) | Beim Austritt; zum Saisonwechsel neu zugeordnet |
| Eltern-Kind-Verbindung, Freigaben mit Protokoll | Eltern, Minderjährige | Eltern handeln für ihre Kinder | Das Elternteil, Trainer, Admins | Beim Austritt |
| Rückmeldungen (zu/ab, später) | Spieler | Planung von Training und Spiel | Trainer, Admins; Betreuer und, wenn die Mannschaft es einschaltet, die Mannschaft (ohne Gründe) | Zum Saisonwechsel |
| Absagegründe | Spieler | Planung | Trainer, Admins | 60 Tage nach dem Termin |
| „Ich bin nicht da“ von Trainern, Leitungen, Betreuern und Organisatoren, mit optionaler Notiz | Verantwortliche des Termins | Planung, Vertretung | Dass jemand fehlt: alle, die den Termin sehen. Die Notiz: Trainer und Admins des Termins | Notiz 60 Tage nach dem Termin, der Eintrag mit dem Termin zum Saisonwechsel |
| Anwesenheit nach dem Termin (anwesend, entschuldigt, unentschuldigt), Anwesenheitsstatistik | Spieler | Überblick für Trainer | Trainer, Admins; der Spieler und seine Eltern sehen den eigenen Eintrag | Termindaten zum Saisonwechsel; Saisonsummen bleiben bis zum Austritt |
| Kadernominierungen | Spieler | Spiele | Mannschaft | Zum Saisonwechsel |
| Helferdienste | Eltern, Spieler | Dienste bei Spielen und Veranstaltungen | Helfer der Mannschaft („Vorname N.“), Trainer | Zum Saisonwechsel |
| Fahrgemeinschaften | Fahrer, Mitfahrer | Auswärtsspiele | Nominierte und ihre Eltern („Vorname N.“), Trainer | Zum Saisonwechsel |
| Chatnachrichten, Reaktionen | Mitglieder | Kommunikation der Mannschaft | Mitglieder des Chats | Zum Saisonwechsel |
| E-Mail-Adresse | Wer eine einträgt | Anmeldecodes, Zugangslinks; Helferplan-Mails und Antworten auf Feedback nur auf Wunsch | Niemand in der App; Admins nur im Datenexport | Beim Austritt |
| Handynummer (SMS-Modul) | Wer eine einträgt | Anmeldecodes und Erinnerungen per SMS | Niemand | Auf Wunsch im Profil, beim Austritt |
| Profilbild | Wer eins hochlädt | Einander erkennen | Angemeldete; bei Minderjährigen nach Freigabe der Eltern | Auf Wunsch, beim Austritt |
| Passkeys | Alle mit Zugang | Anmeldung (nur öffentlicher Schlüssel, keine Biometrie) | Niemand | Beim Entfernen im Profil, beim Austritt |
| Anmeldungen (Sitzungen) mit Gerätetyp | Alle mit Zugang | Angemeldet bleiben | Die Person selbst (Geräteliste) | Laufen 30 Tage nach letzter Nutzung, 90 Tage nach Anmeldung ab; beim Austritt entfernt |
| Push-Abos | Geräte mit Benachrichtigungen | Benachrichtigungen | Niemand | Beim Abschalten, beim Austritt |
| Tag der letzten Nutzung | Alle mit Zugang | Ungenutzte Zugänge erkennen | Admins | Beim Austritt |
| Persönlicher Kalenderlink | Wer einen anlegt | Kalender-Abo | Die Person selbst | Beim Zurücksetzen, beim Austritt |
| Merkmal „Ordentliches Mitglied“ | Erwachsene | Wer Veranstaltungen organisieren und bestimmte Dienste übernehmen darf | Admins | Beim Austritt |

Für die Nutzung ohne Netz zwischengespeicherte Inhalte auf dem Gerät werden beim Abmelden gelöscht.

## Wer für den Verein Daten verarbeitet

- **Cloudflare** betreibt die App und speichert die Datenbank (Workers, D1, KV, Durable Objects, Queues). Der Verein schließt im eigenen Konto den Auftragsverarbeitungsvertrag von Cloudflare ab. Sollen die Daten in der EU bleiben, die Datenbank von Hand mit `npx wrangler d1 create kabine --jurisdiction eu` anlegen (siehe Installation von Hand in [install.md](install.md)).
- **Push-Dienste** der Gerätehersteller (Apple, Google, Mozilla, Microsoft) stellen Benachrichtigungen zu. Der Inhalt ist Ende-zu-Ende verschlüsselt, der Push-Dienst sieht nur die Geräteadresse.
- **E-Mail:** Cloudflare Email Sending oder der eigene Mailserver des Vereins.
- **SMS (optional):** der Anbieter, den der Verein wählt (derzeit seven.io).
- **OpenHolidays API:** Die App holt Schulferien und Feiertage der Region. Es werden keine personenbezogenen Daten übertragen.
- **handball4all (optional):** Das Gerät eines Trainers oder Admins holt den Spielplan direkt beim Verband. Es werden keine personenbezogenen Daten übertragen.

## Vorlage für die Datenschutzerklärung des Vereins

Der folgende Abschnitt kann in die Datenschutzerklärung des Vereins übernommen und angepasst werden. Die Datenschutzseite in der App (*Profil → Datenschutz*) zeigt allen die Einzelheiten von oben und verlinkt auf die Erklärung des Vereins.

> **Mannschafts-App „[Name der App]“**
>
> Für Training, Spiele und die Kommunikation in den Mannschaften betreibt der Verein unter [Adresse] eine Mannschafts-App. Sie wird von Spielerinnen und Spielern, ihren Eltern und den Trainerinnen und Trainern des Vereins genutzt. Zugang gibt es nur auf Einladung der Trainer.
>
> Wir verarbeiten: Vorname, Nachname und Jahrgang der Spieler; Vorname und Nachname von Eltern und Trainern; Mannschaftszugehörigkeit; Zu- und Absagen zu Terminen und, falls angegeben, Absagegründe; Kadernominierungen; Helferdienste und Fahrgemeinschaften; Nachrichten in den Mannschaftschats; freiwillig eine E-Mail-Adresse, eine Handynummer und ein Profilbild. Technisch notwendig sind Passkeys (öffentliche Schlüssel), Anmeldungen und Push-Abos der Geräte.
>
> Zweck ist die Organisation des Sportbetriebs des Vereins (Art. 6 Abs. 1 lit. b DSGVO, Mitgliedschaft), bei freiwilligen Angaben wie Profilbild und E-Mail-Adresse die Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), bei Minderjährigen durch die Eltern. Absagegründe werden 60 Tage nach dem Termin gelöscht, Rückmeldungen, Chats und Termine zum Ende jeder Saison, alle Daten einer Person bei ihrem Austritt, spätestens zum nächsten Saisonwechsel.
>
> Die App läuft auf der Infrastruktur der Cloudflare, Inc. als Auftragsverarbeiter ([Auftragsverarbeitungsvertrag]). Benachrichtigungen werden über die Push-Dienste der Gerätehersteller zugestellt. [Falls genutzt: SMS werden über [Anbieter] versendet.] Es gibt kein Tracking und keine Werbung.
>
> Ansprechperson für Fragen zur App: [Name, E-Mail].
