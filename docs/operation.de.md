# Kabine betreiben

Was die Leute, die die App für den Verein betreiben, von Zeit zu Zeit tun. Befehle laufen in einem Checkout der Kopie des Vereins, mit `npm ci` erledigt und `npx wrangler login` (oder einem `CLOUDFLARE_API_TOKEN`). Es gibt auch eine [englische Fassung](operation.md).

## Jede Saison

Der **Saisonwechsel** (*Verwaltung → Saisonwechsel*) bereitet die neue Saison vor: er zeigt eine Vorschau, ordnet die Spieler den Mannschaften ihrer neuen Altersklasse zu, löscht Termine, Trainingspläne, Chatverläufe und Rückmeldungen der alten Saison und entfernt Personen, die den Verein verlassen haben. Exportier die Daten vorher (nächster Abschnitt).

Trainingspläne, Trainer und Betreuer werden nach dem Wechsel neu gesetzt. Ferien und Feiertage des neuen Schuljahres werden beim Wechsel geladen.

## Sicherung

- **Import:** *Verwaltung → Import / Wiederherstellen* übernimmt Mannschaften, Trainer und Spieler aus den Listen des Vereins (Excel .xlsx, CSV oder eine eingefügte Tabelle). Die Listen werden im Browser des Admins gelesen und nicht hochgeladen; übernommen werden nur Vorname, Nachname, Jahrgang, Mannschaft und Rolle, nach einer Prüfung. Vorhandene Mannschaften und Personen werden wiedererkannt, so entsteht nichts doppelt.
- **Wiederherstellen:** dieselbe Seite nimmt einen Export von Kabine zurück (die JSON-Datei unten), etwa beim Umzug auf eine neue Installation. Der Admin hakt an, was übernommen wird: Vereinseinstellungen, Saison und Ferien, Mannschaften, Personen, Zuordnungen zu Mannschaften, Trainingspläne, Termine, Chats. Alles wird zusammengeführt, nichts gelöscht oder überschrieben: was schon da ist, bleibt und wird übersprungen, zweimal ausführen ändert also nichts. Alles angehakt auf einer neuen Installation stellt den Verein vollständig wieder her; Admin-Rollen kommen nur dann mit. Passkeys und Anmeldungen sind nicht Teil eines Exports, alle melden sich also neu an (E-Mail-Code oder persönlicher Link). Chats werden nur in Mannschaften wiederhergestellt, deren Chat noch leer ist. Exportier vorher die aktuellen Daten; innerhalb von 30 Tagen lässt sich die Datenbank auch mit D1 Time Travel zurücksetzen (siehe *Updates*).
- **Export:** *Verwaltung → Export* lädt alle Vereinsdaten als JSON-Datei herunter (Personen, Mannschaften, Termine, Rückmeldungen, Einstellungen). Sitzungen, Passkeys, Push-Abos, Einladungslinks und erzeugte Schlüssel sind nicht enthalten. Bewahr die Datei sicher und zugriffsgeschützt auf; sie enthält Namen von Minderjährigen.
- **D1 Time Travel:** Cloudflare hält einen wiederherstellbaren Verlauf der Datenbank (7 Tage im kostenlosen Tarif, 30 im kostenpflichtigen): `npx wrangler d1 time-travel info DB` zeigt ein Lesezeichen, `npx wrangler d1 time-travel restore DB --bookmark=<lesezeichen>` geht zurück. Das Zurücksetzen verwirft alles, was danach geschrieben wurde.

## Wartungsmodus

Vor riskanten Arbeiten an den Daten schaltest du unter *Verwaltung → Updates und Wartung* den Wartungsmodus ein. Nur Admins können die App dann benutzen, alle anderen sehen eine Wartungsseite, und der stündliche Cron-Lauf (Erinnerungen, automatische Nachrichten) pausiert. Er wirkt nach etwa einer Minute. Aus einem Checkout:

```sh
npm run maintenance:on
npm run maintenance:status
npm run maintenance:off
```

Der Schalter liegt in KV (Schlüssel `maintenance`), unabhängig von der Datenbank.

## Updates

Neue Versionen von Kabine erreichen einen Verein auf drei Wegen:

- **In der App:** einmal am Tag fragt die Installation bei kabine.dev nach der neuesten Version. Gibt es eine neuere, sehen Admins einen Hinweis oben in der *Verwaltung* und den Abschnitt *Neue Versionen* unter *Verwaltung → Updates und Wartung*, und sie bekommen eine Push-Nachricht ([Update-Hinweise](#update-hinweise)).
- **Auf GitHub:** einmal in der Woche (Montagmorgen) öffnet der Workflow `.github/workflows/update.yml` in der Kopie des Vereins einen Pull Request „Update Kabine to vX.Y.Z“ mit der neuesten Version. Die Kopie braucht diesen Workflow einmal ([Installation](install.de.md), Schritt 6).
- **Die Installation des Updates:** Mergen des Pull Requests stellt die Version über Workers Builds bereit (`npm run deploy`, `scripts/deploy.mjs`). Ohne das wird nichts installiert; du entscheidest, wann.

## Ein Update installieren

1. **Den Pull Request öffnen.** *Verwaltung → Updates und Wartung → Update installieren* öffnet ihn in der Kopie deines Vereins auf GitHub (oder diese Anleitung, wenn die App die Kopie nicht kennt). Auf GitHub selbst: deine Kopie → *Pull requests* → „Update Kabine to vX.Y.Z“. Die App kann bis zu einer Woche vor dem Pull Request von einer Version wissen; damit er gleich kommt, [führ den Workflow von Hand aus](#kein-update-pull-request).
2. **Lesen, was der Pull Request sagt.** Ganz oben steht (auf Englisch):
   - *No database changes: the app keeps running during the deploy.* Keine Änderungen an der Datenbank; merge, wann du willst.
   - **Database changes:** die Version ändert die Datenbank (die Migrationsdateien stehen dabei). Die App pausiert während des Deployments etwa eine Minute, also merge zu einer ruhigen Zeit.
   - **Check wrangler.jsonc:** die Version ändert die Cloudflare-Konfiguration, zum Beispiel eine neue Bindung. Vergleich deine `wrangler.jsonc` mit der der Version (der Pull Request behält deine, mit deinen Kennungen der Ressourcen und deiner Domain) und trag die neuen Einträge **vor** dem Mergen in deiner Kopie nach (Datei auf GitHub bearbeiten, *Commit changes*).
   - **Update the workflows by hand, after the deploy:** GitHub lässt das automatische Update keine Dateien in `.github/workflows` ändern. Die aufgeführten Dateien ersetzt du **nach** dem Mergen von Hand (Schritt 6).
   - Darunter: die Versionshinweise jeder Version seit der installierten.

   Eine fehlgeschlagene Prüfung „Workers Builds“ am Pull Request selbst kommt von den Builds für Preview-Branches; schalte sie aus wie in [der Installation](install.de.md) (Schritt 1). Das Deployment nach dem Mergen ist davon nicht betroffen.
3. **Zu einer ruhigen Zeit mergen.** *Merge pull request → Confirm merge*. Nicht kurz vor einem Spiel oder wenn gerade viele zu- und absagen, vor allem, wenn sich die Datenbank ändert.
4. **Die Wartungsminute.** Workers Builds startet das Deployment nach ein, zwei Minuten; insgesamt dauert es ein paar Minuten.
   - *Ohne Änderungen an der Datenbank:* bauen und hochladen. Die App läuft weiter; offene Seiten holen sich die neue Version beim nächsten Start.
   - *Mit Änderungen an der Datenbank:* das Skript notiert zuerst einen **Wiederherstellungspunkt** (ein Lesezeichen von D1 Time Travel, im Build-Protokoll ausgegeben) und markiert dann das Update in der Datenbank. Etwa eine Minute lang sehen alle, Admins eingeschlossen, „Kabine wird aktualisiert“, und der Cron-Lauf pausiert. Die Migrationen laufen, die neue Version wird hochgeladen, die Markierung entfernt, und die App lädt sich von selbst neu. Bricht der Build ab, läuft die Markierung nach 15 Minuten ab.
5. **Die Version prüfen.** Nach ein paar Minuten zeigt *Verwaltung → Updates und Wartung* die neue Version unter *Installierte Version*, und unter *Letztes Update* wann, welche Änderungen an der Datenbank und den Wiederherstellungspunkt mit dem Befehl zum Zurückgehen; der Hinweis oben in der *Verwaltung* ist weg. Nach 15 Minuten noch die alte Version? Sieh dir den Build im Cloudflare-Dashboard an (*Workers & Pages → dein Worker → Deployments*, das Build-Protokoll des Merges). Ein Build, der vor den Migrationen fehlschlug, hat nichts geändert: starte ihn dort neu. Schlug er danach fehl, läuft die vorige Version mit der neuen Datenbank weiter; starte ihn neu oder [geh zurück](#ein-update-rückgängig-machen).
6. **Workflow-Dateien, wenn der Pull Request welche aufgeführt hat.** Öffne jeden Link, kopier den Inhalt, bearbeite dieselbe Datei in deiner Kopie auf GitHub und füg ihn ein. Mach das erst nach Schritt 5: jeder Commit in die Kopie startet ein Deployment, eine Änderung am Workflow kurz vor dem Mergen stellt die alte Version bereit, und der Build des Merges gleich danach stellt vielleicht gar nichts bereit. Ist das trotzdem passiert, ist noch die alte Version installiert: committe eine beliebige kleine Änderung in die Kopie (oder starte das Deployment im Cloudflare-Dashboard neu), um das Update bereitzustellen.

Willst du eine Version lieber erst selbst prüfen, schalt den Wartungsmodus ein, merge, prüf die App als Admin und schalt ihn wieder aus.

## Update-Hinweise

**Was die App prüft.** Einmal am Tag, ab 10 Uhr in der Zeitzone des Vereins, holt die Installation auf dem Server `https://kabine.dev/releases.json` (der stündliche Cron-Lauf; nie aus einem Browser): die neueste Version mit Datum, einem Link zu ihren Versionshinweisen und ob sie ein Sicherheitsupdate ist. Die Anfrage ist eine gewöhnliche HTTPS-Anfrage mit dem User-Agent `Kabine/<installierte Version>`; Cloudflare fügt jeder Anfrage eines Workers den Header `CF-Worker` mit der Domain der Installation hinzu. Es werden kein Cookie, keine Kennung und nichts über die Leute des Vereins gesendet, und kabine.dev protokolliert und wertet diese Anfragen nicht aus. Ist kabine.dev nicht erreichbar, versucht es die App am nächsten Tag wieder.

**Was Admins sehen.** Hat kabine.dev eine neuere Version als die installierte:

- einen Hinweis oben in der *Verwaltung*, den jeder Admin für diese Version auf seinem Gerät schließen kann,
- einen Punkt bei *Updates und Wartung* und dort den Abschnitt *Neue Versionen*: Version und Datum, *Versionshinweise*, *Update installieren* und die Schritte oben,
- eine Push-Nachricht an jeden Admin (in seiner Sprache), einmal je neuer Version. Wer *Als Admin arbeiten* ausgeschaltet hat, bekommt keine.

**Sicherheitsupdates** sind in ihren Versionshinweisen als solche gekennzeichnet. Die App zeigt „Sicherheitsupdate“ in Rot, und der Hinweis lässt sich nicht schließen, bis das Update installiert ist. Installier sie bald.

**„Update installieren“** öffnet den Update-Pull-Request in der Kopie deines Vereins, wenn die App die Kopie kennt: das Deployment in Workers Builds findet sie im Checkout (im Build-Protokoll steht `GitHub copy: owner/name`) und vermerkt sie mit dem Update. Bis zum ersten Deployment mit dieser Funktion, oder wenn das Deployment sie nicht gefunden hat, nimmt die App den Quellcode-Link unter *Verwaltung → Verein*, wenn er auf eine Kopie auf GitHub zeigt (diesen Link sehen alle unter *Hilfe*, trag ihn also nur für eine öffentliche Kopie ein). Sonst öffnet der Knopf diese Anleitung. Die App hat selbst keinen Zugriff auf GitHub; sie verlinkt nur dorthin.

**Ausschalten.** *Verwaltung → Updates und Wartung → Nach neuen Versionen suchen*: aus, holt die Installation nichts, und es gibt weder Hinweis noch Push-Nachricht; Update-Pull-Requests kommen trotzdem auf GitHub an. Nur die Push-Nachricht: *Profil → Benachrichtigungen → Neue Kabine-Versionen (Admins)*, je Admin.

## Kein Update-Pull-Request

**Den Workflow von Hand ausführen.** In deiner Kopie auf GitHub: *Actions → Kabine updates → Run workflow*. Innerhalb einer Minute erscheint ein Pull Request „Update Kabine to v…“, oder der Lauf zeigt, warum nicht. Ist die Kopie schon auf der neuesten Version, tut er nichts.

Kommt nichts:

- **Kein Workflow „Kabine updates“ unter *Actions*:** die Kopie hat den Update-Workflow noch nicht. Leg ihn an wie in [der Installation](install.de.md) (Schritt 6).
- **Actions sind ausgeschaltet:** *Settings → Actions → General → Actions permissions*: Actions erlauben. In einer öffentlichen Kopie pausiert GitHub geplante Workflows außerdem nach 60 Tagen ohne Aktivität im Repository; *Actions → Kabine updates → Enable workflow* schaltet ihn wieder ein.
- **Ein Issue „Kabine vX.Y.Z is ready to install“ statt eines Pull Requests:** GitHub hat den Workflow den Pull Request nicht öffnen lassen. Öffne ihn über den Link im Issue, prüf ihn und merge ihn. Für das nächste Mal: *Settings → Actions → General → Workflow permissions* → *Allow GitHub Actions to create and approve pull requests* ankreuzen und speichern.
- **Der Lauf ist fehlgeschlagen:** öffne ihn unter *Actions*; der letzte rote Schritt sagt, warum. „Open the pull request by hand“ mit einem Link bedeutet dasselbe wie das Issue oben.
- **Der Pull Request dieser Version wurde ohne Mergen geschlossen:** der Workflow öffnet ihn nicht noch einmal. Öffne ihn auf GitHub wieder (*Pull requests → Closed*) oder warte auf die nächste Version.

## Versionen überspringen

Eine Kopie kann von jeder Version direkt auf die neueste gehen. Der Pull Request bringt immer die neueste Version, listet die Änderungen an der Datenbank und zeigt die Versionshinweise jeder Version seit der installierten; das Deployment spielt alle ausstehenden Migrationen der Reihe nach ein, mit einer Pause und einem Wiederherstellungspunkt. Ein älterer Update-Pull-Request, der noch offen ist, wird mit einem Link auf den neuen geschlossen, damit niemand versehentlich eine ältere Version installiert. Willst du eine Version bewusst auslassen, merge ihren Pull Request einfach nicht; die nächste Version bringt sie ohnehin mit.

## Ein Update rückgängig machen

Migrationen halten die vorige Version lauffähig (`migrations/README.md`), daher reicht es meist, nur den Worker zurückzusetzen: *Workers & Pages → dieser Worker → Deployments → Rollback*. Das gilt für eine Version zurück. Nach einem Update, das Versionen übersprungen hat, passt ein älterer Worker vielleicht nicht mehr zur Datenbank (eine spätere Version kann entfernen, was er noch braucht): setz dann den Worker und die Datenbank zusammen auf den Wiederherstellungspunkt zurück. Setz die Datenbank auch zurück, wenn die Daten selbst falsch sind:

```sh
npx wrangler d1 time-travel restore DB --bookmark=<wiederherstellungspunkt>
```

Der Wiederherstellungspunkt steht im Build-Protokoll und unter *Verwaltung → Updates und Wartung → Letztes Update* (mit einem Knopf, der den Befehl kopiert). D1 Time Travel reicht im kostenlosen Tarif 7 Tage zurück, im bezahlten 30. Das Zurücksetzen verwirft alles, was nach dem Wiederherstellungspunkt geschrieben wurde. Schalt vorher den Wartungsmodus ein und wieder aus, wenn du die App geprüft hast. Der zurückgesetzte Worker zeigt unter *Installierte Version* wieder die alte Version; installier eine spätere Version, wenn das Problem behoben ist.

## Eine ältere Kopie aktualisieren

Kopien, die vor der ersten Version (v0.2.0, Oktober 2026) angelegt wurden, brauchen einmal drei Dinge. Danach kommen Updates wie oben beschrieben.

1. **Den Update-Workflow anlegen oder ersetzen.** Mit dem Deploy-Knopf angelegte Kopien haben keinen, und ältere können ein Update nicht abschließen. Leg in deiner Kopie auf GitHub `.github/workflows/update.yml` mit dem Inhalt der [aktuellen Fassung](https://github.com/witscher/kabine/blob/main/.github/workflows/update.yml) an oder bearbeite sie, und kreuz unter *Settings → Actions → General → Workflow permissions* die Option *Allow GitHub Actions to create and approve pull requests* an. Führ ihn dann einmal aus: *Actions → Kabine updates → Run workflow*. Innerhalb einer Minute erscheint ein Pull Request „Update Kabine to v…“ (oder ein Issue mit einem Link dazu).
2. **Die Build-Einstellungen prüfen.** Im Cloudflare-Dashboard: *Workers & Pages → dein Worker → Settings → Build*, der Deploy-Befehl muss `npm run deploy` sein; im Reiter *Previews Base* schaltest du *Builds for Preview branches* aus.
3. **Den Wartungsmodus für dieses eine Update von Hand einschalten.** Die laufende alte Version kennt die automatische Pause noch nicht. In einem Checkout deiner Kopie (mit `npm ci` erledigt und `npx wrangler login`):

   ```sh
   npm run maintenance:on
   ```

   Warte eine Minute, merge den Pull Request, warte, bis der Build fertig ist, und schalte den Wartungsmodus unter *Verwaltung → Updates und Wartung* wieder aus (oder `npm run maintenance:off`). Von da an pausiert die App von selbst, wenn ein Update die Datenbank ändert.

Der Pull Request sagt auch, ob `wrangler.jsonc` neue Einträge braucht; vergleich das vor dem Mergen mit der Version.

## Von Hand aus einem Klon installiert

Hast du `witscher/kabine` geklont und stellst von deinem Rechner aus bereit, behalte deine `wrangler.jsonc` (Kennungen der Ressourcen, Domain) und hol die neue Version:

```sh
git stash            # deine Änderungen an wrangler.jsonc, falls nicht committet
git fetch --tags
git checkout v0.2.0  # die gewünschte Version
git stash pop        # wrangler.jsonc von Hand auflösen, falls die Version sie geändert hat
npm ci
npm run deploy       # Wiederherstellungspunkt, Pause, Migrationen, Hochladen
```

Beim ersten Update einer Kopie, die älter als v0.2.0 ist, schaltest du vor `npm run deploy` den Wartungsmodus ein (Schritt 3 oben).

## Logs

`npx wrangler tail` zeigt Anfragen und Fehler live. Mit `observability` in `wrangler.jsonc` hält das Dashboard Logs für einige Tage (*Workers & Pages → kabine → Observability*).

**Fehler-E-Mail.** Den Text eines unerwarteten Serverfehlers sieht nie jemand, nur eine allgemeine Meldung; meldet Cloudflare Überlastung (etwa „too much load“ von D1, eine Grenze, die für das ganze Cloudflare-Konto gilt), lesen sie, dass gerade viel los ist und sie es in ein paar Minuten noch einmal versuchen sollen. Kabine zählt diese Fehler pro Tag in KV (höchstens 20, 14 Tage aufbewahrt) und schickt ab dem dritten Fehler eines Tages eine E-Mail an den **Eigentümer** der Installation (*Verwaltung → Verein*), an die bestätigte E-Mail-Adresse seines Zugangs, mit Zeit, Ort und dem Anfang jeder Meldung. Trag im Profil des Eigentümers eine bestätigte E-Mail-Adresse ein, um sie zu bekommen; ohne sie oder ohne eingerichteten E-Mail-Versand wird nichts verschickt. Die vollständigen Meldungen bleiben in den Logs.

## Geheimnisse

| Geheimnis | Zweck | Wenn es sich ändert |
| --- | --- | --- |
| `ADMIN_BOOTSTRAP_TOKEN` | Einrichtungslink des ersten Admins, funktioniert einmal | Nach der Einrichtung harmlos; kann gelöscht werden |
| `APP_SECRET` | Signiert Einladungs- und E-Mail-Links, verschlüsselt das SMTP-Passwort und den SMS-Schlüssel | Offene Links funktionieren nicht mehr; SMTP-Passwort und SMS-Schlüssel neu eintragen |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push-Nachrichten | Jedes Gerät muss die Benachrichtigungen neu einschalten |

Ohne `APP_SECRET` und die VAPID-Schlüssel als Geheimnisse verwendet die App die Schlüssel, die sie beim ersten Start erzeugt hat (Tabelle `instance_secrets`). Mit `npx wrangler secret put` gesetzte Geheimnisse haben Vorrang; der Wechsel von erzeugten zu eigenen Schlüsseln hat die Folgen aus der Tabelle.

## Optionale Variablen

Der Knopf „Deploy to Cloudflare“ fragt nach keiner davon; die App funktioniert ohne sie. Setz sie nur, wenn du sie brauchst, als Klartext-Variablen des Workers (*Workers & Pages → kabine → Settings → Variables and Secrets*) oder in `wrangler.jsonc` unter `vars`.

| Variable | Ohne sie | Setzen, wenn |
| --- | --- | --- |
| `ORIGIN` | Die App verwendet die Adresse, unter der sie geöffnet wurde (z. B. `https://app.dein-verein.de`), und merkt sie sich für Links in Push-Nachrichten und E-Mails. | Die App unter mehr als einer Adresse erreichbar ist und Links immer auf eine davon zeigen sollen. |
| `RP_ID` | Passkeys sind an den Hostnamen gebunden, unter dem die App geöffnet wurde. | Derselbe Fall wie bei `ORIGIN`: auf den Hostnamen dieser Adresse setzen (`app.dein-verein.de`), nie auf eine `workers.dev`-Adresse, die du nicht mehr verwenden wirst. |
| `MAIL_FROM` | Die Absenderadresse kommt aus dem Einrichtungsassistenten (*Verwaltung → E-Mail*). | Du willst einen Standardabsender, bevor der Assistent gelaufen ist. |

## Impressum und Datenschutzerklärung

Anbieter der App und Verantwortlicher für ihre Daten ist der Verein. Sein Impressum und seine Datenschutzerklärung werden unter *Verwaltung → Verein* verlinkt und erscheinen unter jedem Bildschirm und jeder E-Mail der App; solange eines fehlt, sehen Admins eine Warnung. Aktualisiere die Datenschutzerklärung, wenn der Verein ein Modul einschaltet, das etwas Neues speichert (SMS, Helferdienste, Fahrgemeinschaften, eine Spielplan-Quelle), oder seinen Mail- oder SMS-Anbieter wechselt: die Datenschutzseite der App listet, was jedes eingeschaltete Modul speichert.

## Einladungen

Ohne Einladungslink kommt niemand in die App. Es gibt drei Arten:

- **Mannschaftslinks** (*Mannschaft → Einladungen*): ein Spielerlink und ein Elternlink pro Mannschaft, 14 Tage gültig, für die private Gruppe der Mannschaft oder als QR-Code beim Training. Wer einen solchen Link hat, kann einen Namen der Mannschaft wählen, teil ihn also nur dort, wo die Mannschaft unter sich ist. Ein neuer Link zieht den vorigen zurück; der Saisonwechsel zieht alle zurück. Sobald mehr als 5 Spieler (oder mehr als 5 Eltern der Spieler der Mannschaft) einen Zugang haben, gilt die Mannschaft als eingerichtet: wer dann einen neuen Mannschaftslink erstellt, sieht den Hinweis, den wenigen, die noch fehlen, lieber einen persönlichen Link oder einen Elternlink für ihr Kind zu schicken. Der Mannschaftslink lässt sich trotzdem erstellen.
- **Elternlink für ein Kind** (*Mannschaft → Kader → der Spieler → Eltern*, für Admins auch *Verwaltung → Personen → die Person*): ein Link für die Eltern dieses Kindes, 7 Tage gültig. Er verknüpft nur dieses Kind; jedes Elternteil richtet damit seinen eigenen Zugang ein, bis zu zwei Eltern pro Kind (Admins können unter *Verwaltung → Personen* mehr verknüpfen). Erstellen können ihn die Trainer des Kindes und Admins, solange die Mannschaft Eltern einbindet und das Kind weniger als zwei verknüpfte Eltern hat. Er ist für Eltern, die nicht in der Gruppe sind, oder wenn die Mannschaft eingerichtet ist, statt den Elternlink der Mannschaft noch einmal zu teilen. Ein neuer Link für dasselbe Kind zieht den vorigen zurück.
- **Persönliche Links** (das Blatt der Person): ein einmaliger Link für den eigenen Zugang einer Person, 7 Tage gültig, auch um nach einem verlorenen Gerät einen neuen Passkey einzurichten (siehe *Eigentümer und Admins*).

Von jedem Link wird nur ein Hash gespeichert.

## Rollen und Vertrauen

Ein Verein lebt von Vertrauen, vor allem in seine Trainer, und Kabine bildet das ab. Trainern wird ihre Mannschaft anvertraut, Admins der ganze Verein: Trainer legen Spieler und Aushilfen an, planen Trainings mit anderen Mannschaften und halten fest, wer da war, ohne einen Admin zu fragen. Wähl Trainer und Admins entsprechend aus, und nimm die Rolle weg, wenn jemand die Aufgabe abgibt.

Was Kabine in jedem Fall verschließt: alles, was eine Person ohne Anmeldung oder irgendein angemeldeter Nutzer (oft ein Kind) missbrauchen könnte, alles, womit ein übernommener Zugang den Zugang eines anderen übernehmen könnte, und Schritte, die leicht aus Versehen passieren und viel bewirken, etwa ein falscher Spielplan-Link oder vereinsweite Änderungen, die sich nicht rückgängig machen lassen. Anmeldecodes per E-Mail oder SMS erlauben je fünf Versuche und höchstens fünf Codes pro Adresse und Stunde, zehn pro Tag.

## Eigentümer und Admins

Der erste Admin ist der **Eigentümer**. Andere Admins können dem Eigentümer weder die Admin-Rolle noch den Zugang nehmen. Halte mindestens zwei Admins, damit der Verein nicht von einer Person abhängt. Ein Admin, der sein Gerät verloren hat, bekommt von einem anderen Admin einen persönlichen Link oder meldet sich mit einem Code per E-Mail an, wenn E-Mail eingerichtet ist. Ein persönlicher Link für einen bestehenden Zugang richtet einen neuen Passkey ein und meldet die bisherigen Geräte ab; die E-Mail-Adresse des Zugangs bleibt. Ist diese Adresse vielleicht nicht die eigene der Person, schaltet ein Admin vor dem Erstellen des Links im Blatt der Person (*Verwaltung → Personen*) *Auch die E-Mail-Adresse für die Anmeldung entfernen* ein: das Öffnen des Links entfernt sie dann, und die Person kann eine neue eintragen. *Verwaltung → Protokoll* zeigt, wann ein solcher Link verwendet wurde.

### Notfallzugang für Admins

Notfall-Befehle umgehen die normalen Wege in die App (Einladungen durch einen Admin, den Schutz des Eigentümers). Verwende sie nur im Notfall: sie brauchen jemanden mit Zugang zum Cloudflare-Konto des Vereins, laufen aus einem Checkout der Kopie des Vereins (mit `npm ci` erledigt und `npx wrangler login`), und der Vorstand sollte von jedem Einsatz wissen.

| Lage | Befehl |
| --- | --- |
| Kein Admin kann sich mehr anmelden (Geräte verloren, der einzige Admin hat den Verein verlassen) | `npm run admin:link -- --first Alex --last Admin --email alex@dein-verein.de` |
| Der Eigentümer ist weg oder nicht mehr vertrauenswürdig | dasselbe mit `--owner` |
| Admin-Zugänge sind oder könnten kompromittiert sein | dasselbe mit `--revoke-all-admins` |

Was jeder davon tut:

- **Immer:** legt den Admin an oder macht die Person mit dieser Admin-Adresse wieder zum Admin (auch den Eigentümer oder jemanden, der ausgetreten ist), zieht ältere persönliche Links dieser Person zurück und gibt einen Link aus, der 24 Stunden gilt. Wer ihn öffnet, richtet einen Passkey ein; hatte die Person schon einen Zugang, werden dessen Geräte abgemeldet. Gespeichert wird nur ein Hash des Links, wie bei jeder Einladung. Die Ausgabe listet die anderen Admins mit dem Datum, an dem sie zuletzt gesehen wurden: prüf, ob jeder noch dazugehört.
- **`--owner`:** die Person wird außerdem Eigentümer der Installation. Danach kann sie in der App dem bisherigen Eigentümer die Admin-Rolle oder den Zugang nehmen, was andere Admins nicht können.
- **`--revoke-all-admins`:** jeder andere Admin verliert Admin-Rolle und Admin-Adresse, wird auf allen Geräten abgemeldet, und seine offenen persönlichen Links werden zurückgezogen. Die anderen Rollen (Trainer, Elternteil, Spieler) bleiben. Schließt `--owner` ein. Der Befehl verlangt vorher die Eingabe von `REVOKE` (oder `--yes`).

Optionen: `--origin https://app.dein-verein.de`, wenn die Adresse der App noch nicht bekannt ist, `--env <name>` für eine Umgebung aus `wrangler.jsonc`, `--config <datei>` für eine andere Wrangler-Konfiguration, `--local` für die lokale Datenbank.

**Nachvollziehbar.** Jeder Einsatz wird in der Datenbank festgehalten und allen Admins unter *Verwaltung → Updates und Wartung → Notfallzugang für Admins* gezeigt (die letzten 20: Zeit, Adresse, Wechsel des Eigentümers, wem die Admin-Rolle genommen wurde). In der App lässt sich das nicht entfernen. Das Audit-Log des Cloudflare-Kontos zeigt, wer dort was geändert hat.

**Danach:**

1. Öffne den Link sofort auf dem Gerät, das den Zugang bekommen soll.
2. *Verwaltung → Personen*: prüf jeden Admin und nimm allen die Rolle, die nicht dazugehören. Sorg dafür, dass es wieder mindestens zwei vertrauenswürdige Admins gibt.
3. Nach kompromittierten Zugängen außerdem: prüf, wer Zugang zum Cloudflare-Konto hat und welche API-Tokens es gibt, ändere die Geheimnisse (siehe *Geheimnisse*), sieh dir die letzten Deployments des Workers an und sperr in der App die Zugänge kompromittierter Personen.
4. Sag dem Vorstand Bescheid. Könnten Unbefugte personenbezogene Daten gesehen haben, muss der Verein als Verantwortlicher das bewerten und es, wo nötig, innerhalb von 72 Stunden der Datenschutzaufsicht melden (Art. 33 DSGVO).

## Deinstallieren

Lösch im Cloudflare-Dashboard den Worker, die D1-Datenbank, den KV-Namespace und die Queue, danach die Kopie auf GitHub. Geräte behalten eine zwischengespeicherte Kopie der zuletzt geladenen Inhalte, bis die App von ihnen entfernt oder die Browserdaten gelöscht werden.
