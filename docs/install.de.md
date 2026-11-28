# Kabine installieren

Kabine läuft im eigenen Cloudflare-Konto deines Vereins. Niemand sonst hostet eure Daten, und der kostenlose Tarif reicht für einen typischen Verein mit einigen hundert Mitgliedern. Diese Anleitung dauert etwa 30 Minuten. Es gibt auch eine [englische Fassung](install.md).

## Was du brauchst

- Ein **Cloudflare-Konto** für den Verein (kostenlos). Leg es mit einer E-Mail-Adresse des Vereins an, nicht mit einer privaten, damit es einen Vorstandswechsel übersteht.
- Ein **GitHub-Konto**. Der Deploy-Knopf legt dort eine Kopie von Kabine an, und Updates kommen als Pull Request in diese Kopie.
- Am besten eine **Domain in Cloudflare**, zum Beispiel `app.dein-verein.de`. Passkeys sind an die Adresse der App gebunden, wähl also die endgültige Adresse, bevor du Leute einlädst. Zum Ausprobieren reicht eine `*.workers.dev`-Adresse.

## 1. Bereitstellen

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/witscher/kabine)

Der Knopf legt eine Kopie des Repositorys in deinem GitHub-Konto an und die Cloudflare-Ressourcen, die die App braucht: den Worker, eine D1-Datenbank, einen KV-Namespace, eine Queue für Push-Nachrichten und zwei Durable Objects (Mannschaftschat, Live-Helferplan).

Er fragt nach einem Geheimnis, `ADMIN_BOOTSTRAP_TOKEN`. Wähl ein Passwort mit mindestens 16 Zeichen und heb es auf, bis sich der erste Admin angemeldet hat. Alles andere erzeugt die App beim ersten Start selbst: den Schlüssel für signierte Links und das Schlüsselpaar für Push-Nachrichten. Sie liegen in der Datenbank und verlassen sie auch mit dem Datenexport nicht. Willst du sie selbst verwalten, setz `APP_SECRET`, `VAPID_PUBLIC_KEY` und `VAPID_PRIVATE_KEY` als Geheimnisse des Workers (`npm run secrets:generate` erzeugt einen Satz).

Die Kopie enthält den Update-Workflow nicht; Schritt 6 ergänzt ihn.

Prüf in den Einstellungen des Workers unter *Build*, dass der Deploy-Befehl `npm run deploy` lautet. Er spielt die Datenbank-Migrationen ein, bevor er die neue Version hochlädt. Mit einem einfachen `npx wrangler deploy` bleibt die Datenbank auf dem alten Stand.

An derselben Stelle, im Reiter *Previews Base*, schaltest du *Builds for Preview branches* aus und speicherst. Kabine braucht keine Vorschauen: eine Vorschau bräuchte eine eigene Datenbank, einen eigenen KV-Namespace und eine eigene Queue (einen `previews`-Block in `wrangler.jsonc`), und neuer Code gegen die echte Datenbank des Vereins ohne ihre Migrationen wäre riskant. Bleibt es an, zeigt jeder Update-Pull-Request eine fehlgeschlagene Prüfung „Workers Builds“ (`npx wrangler preview` bricht mit „needs a `previews` block“ ab), obwohl das Deployment nach dem Mergen funktioniert.

**Daten in Europa:** Wenn der Knopf die D1-Datenbank anlegt, wähl dafür die EU-Jurisdiktion. Das lässt sich nur beim Anlegen einstellen, nicht später ändern. Verspricht eure Datenschutzerklärung die EU, prüf es nach dem Deployment unter *Storage & Databases → D1 → kabine*. Der Mannschaftschat liegt bereits in der EU-Jurisdiktion. (Bei der Installation von Hand: `npx wrangler d1 create kabine --jurisdiction eu`.)

## 2. Domain hinzufügen

Mach das, bevor sich jemand anmeldet. Öffne im Cloudflare-Dashboard *Workers & Pages → kabine → Settings → Domains & Routes → Add → Custom domain* und trag eine Subdomain des Vereins ein, zum Beispiel `app.dein-verein.de`. Cloudflare legt den DNS-Eintrag und das Zertifikat an.

Die Domain des Vereins muss im selben Cloudflare-Konto verwaltet werden (ihr DNS bei Cloudflare). Wird sie woanders verwaltet, bitte die Person, die die Domain des Vereins betreut, ihr DNS zu Cloudflare umzuziehen (kostenlos), oder registrier eine neue Domain für die App bei Cloudflare.

Verwende ab jetzt nur noch diese Adresse. Passkeys, die unter der `workers.dev`-Adresse angelegt wurden, funktionieren auf der Vereinsdomain nicht; die Einrichtungsseite warnt, wenn sie dort geöffnet wird.

## 3. Erster Admin

Öffne `https://app.dein-verein.de`. Eine neue Installation geht direkt in ihre Einrichtung: gib das Einrichtungspasswort ein, das du beim Bereitstellen gewählt hast (`ADMIN_BOOTSTRAP_TOKEN`), dann deinen Namen und deine E-Mail-Adresse, und leg einen Passkey an (Face ID, Fingerabdruck oder die Bildschirmsperre deines Geräts). Das Passwort funktioniert einmal. (Der direkte Link `https://app.dein-verein.de/einrichtung#<passwort>` macht dasselbe ohne Tippen.)

Auch das Build-Protokoll des Deployments endet mit diesen Schritten.

Gleich danach öffnet sich der Einrichtungsassistent:

1. Sprache und Region: Sprache, Land und Bundesland des Vereins (für Schulferien und Feiertage), Zeitzone.
2. Verein: Name, Kurzname, Kürzel, Farben und Logo.
3. Sportart und Saison: bringt Altersklassen, Spielzeiten und Helferdienste der Sportart mit.
4. Funktionen: Helferdienste (mit Jugendschiedsrichtern und anderen Diensten, die ein Admin freigibt), Fahrgemeinschaften, handball4all, handball.net, SMS. Was jedes Modul tut und speichert, steht in der [Dokumentation der Module](https://kabine.dev/docs/#module).
5. E-Mail (optional): der SMTP-Server des Vereins oder Cloudflare Email Sending mit dem Workers-Paid-Tarif (siehe unten). Ab Werk aus.
6. Erste Mannschaften: von Hand oder aus den Listen des Vereins importiert. Excel-Dateien (.xlsx, auch mehrere Blätter), CSV oder eine eingefügte Tabelle; gelesen werden nur Vorname, Nachname, Jahrgang, Mannschaft und Rolle, im Browser. Dieselbe Person in mehreren Listen wird zu einer; abweichende Jahrgänge und ähnliche Namen kommen als Rückfragen. Mannschaften, Trainer und Spieler werden erst angelegt, wenn alles geprüft und korrigiert ist. Derselbe Import steht später unter *Verwaltung → Import / Wiederherstellen*.
7. Erste Personen: Trainer und weitere Admins, jeweils mit einem persönlichen Link.
8. Datenschutz: Links zu Impressum und Datenschutzerklärung des Vereins, Kontakt für Fragen.

Anbieter der Installation und Verantwortlicher für ihre Daten ist der Verein, nicht das Kabine-Projekt. Trag beide Links ein, bevor du Leute einlädst: sie erscheinen unter jedem Bildschirm, in der Seite selbst (auch ohne JavaScript) und unter jeder E-Mail. Solange einer fehlt, sehen Admins unter *Verwaltung* eine Warnung. Verlinke nie die rechtlichen Seiten von kabine.dev; sie gelten nur für die Projektwebsite und die Demo. [Datenschutz](privacy.de.md) enthält eine Vorlage für den Abschnitt über die App.

Alles lässt sich später unter *Verwaltung* ändern. „Später weitermachen“ verlässt den Assistenten; er öffnet sich wieder unter *Verwaltung → Einrichtungsassistent*.

## 4. E-Mail (optional, empfohlen)

Kabine verschickt E-Mails für Anmeldecodes auf neuen Geräten, Zugangslinks und Erinnerungen an Helferdienste. Ohne E-Mail melden sich alle mit Passkeys und den Links an, die die Trainer verteilen; die Anmeldeseite bietet „Code per E-Mail“ erst an, wenn der Versand eingerichtet ist.

E-Mail ist aus, bis der Verein sie einrichtet.

- **SMTP:** der Mailserver des Vereins, mit TLS auf Port 465 oder STARTTLS auf Port 587. Das Passwort wird verschlüsselt gespeichert. Funktioniert im kostenlosen Cloudflare-Tarif.
- **Cloudflare Email Sending:** braucht den [Workers-Paid-Tarif](https://developers.cloudflare.com/email-service/platform/pricing/) (im kostenlosen Tarif sendet es nur an bestätigte Adressen des eigenen Kontos). Richte die Domain in Cloudflare für den Versand ein (*Email → Email Sending*), ergänze `"send_email": [{ "name": "EMAIL" }]` in `wrangler.jsonc` deiner Kopie und stelle neu bereit. Wähl dann im Assistenten *Cloudflare* und trag die Absenderadresse ein, zum Beispiel `no-reply@dein-verein.de`.

Der Assistent verschickt eine Test-Mail.

## 5. Leute einladen

Trainer trägt ein Admin unter *Verwaltung → Mannschaften → Trainer* ein, sie bekommen einen persönlichen Link. Die Trainer legen dann ihre Spieler an (einzeln oder als Liste aus einer Tabelle), erstellen Trainingspläne und teilen die Einladungslinks für Spieler und Eltern in der Gruppe der Mannschaft. Der Tab Einladungen zeigt, wer noch nicht erreichbar ist.

Push-Nachrichten funktionieren auf Android und in Desktop-Browsern sofort. Auf dem iPhone muss die App zuerst zum Home-Bildschirm hinzugefügt werden (Safari → Teilen → *Zum Home-Bildschirm*); die App erklärt das allen.

## 6. Updates

Neue Versionen von Kabine kommen als Pull Request in deine Kopie auf GitHub; du entscheidest, wann du sie installierst. Der Deploy-Knopf kopiert den Update-Workflow nicht mit (GitHub lässt ihn keine Workflow-Dateien anlegen), ergänze ihn also einmal, direkt nach der Installation:

1. In deiner Kopie auf GitHub: *Add file → Create new file*, nenn sie `.github/workflows/update.yml`, füg den Inhalt [des Update-Workflows](https://github.com/witscher/kabine/blob/main/.github/workflows/update.yml) ein und committe ihn.
2. *Settings → Actions → General*: unter *Workflow permissions* **Allow GitHub Actions to create and approve pull requests** ankreuzen und speichern.
3. *Actions → Kabine updates → Run workflow*: er sucht sofort nach einer neuen Version. Ist deine Kopie schon auf der neuesten, tut er nichts.

Von da an sucht der Workflow jeden Montag nach einer neuen Version und öffnet einen Pull Request „Update Kabine to vX.Y.Z“. Er sagt, ob die Version die Datenbank oder die Cloudflare-Konfiguration (`wrangler.jsonc`) ändert. Mergen stellt die neue Version bereit; ändert sie die Datenbank, zeigt die App etwa eine Minute lang „Kabine wird aktualisiert“, und das Deployment notiert vorher einen Wiederherstellungspunkt ([Betrieb, Updates](operation.de.md#updates)). Lässt GitHub den Workflow den Pull Request trotzdem nicht öffnen, öffnet er ein Issue mit einem Link, über den du ihn selbst öffnest. Von einer neuen Version erfahren Admins auch in der App: ein Hinweis in der *Verwaltung* und eine Push-Nachricht, mit einem Knopf *Update installieren*, der den Pull Request öffnet ([Betrieb, Ein Update installieren](operation.de.md#ein-update-installieren) und [Update-Hinweise](operation.de.md#update-hinweise)).

Eine Kopie von vor Oktober 2026 braucht einmal ein paar Schritte: [Betrieb, Eine ältere Kopie aktualisieren](operation.de.md#eine-ältere-kopie-aktualisieren).

## Installation von Hand

Ohne den Knopf, mit Node.js 22 oder neuer und einem Cloudflare-API-Token:

```sh
git clone https://github.com/witscher/kabine && cd kabine
npm ci
npx wrangler d1 create kabine --jurisdiction eu   # hält die Daten in der EU; die database_id in wrangler.jsonc eintragen
npx wrangler kv namespace create KV    # die id in wrangler.jsonc eintragen
npx wrangler queues create kabine-push
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN
npm run deploy
```

Dann weiter mit Schritt 2.

## Kosten und Grenzen

Der kostenlose Tarif von Cloudflare Workers reicht für einen Verein mit mehreren hundert Mitgliedern: Anfragen, D1-Lese- und Schreibzugriffe, KV, Durable Objects und Queues haben jeweils Tageskontingente. Kabine ist so gebaut, dass es deutlich darunter bleibt (siehe `docs/dev/design.md`, Database read load). Die aktuellen Grenzen stehen auf den Preisseiten von Cloudflare. Ist eine Grenze erreicht, antwortet die App bis zum nächsten Tag mit Fehlern; der kostenpflichtige Tarif (zum Zeitpunkt des Schreibens 5 US-Dollar im Monat) nimmt dieses Risiko. In einem Checkout deiner Kopie zeigt `npm run d1:stats -- 7d` die gelesenen Zeilen pro Tag im Vergleich zur kostenlosen Grenze und welche Abfragen am meisten lesen.

SMS kosten beim Anbieter (seven.io) Geld pro Nachricht. Das Modul ist ab Werk aus.
