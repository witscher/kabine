# handball.net

Spielpläne der deutschen Handballverbände, die ihren Spielbetrieb in Handball360 führen, von [handball.net](https://www.handball.net) (betrieben vom Deutschen Handballbund). Es funktioniert wie das Modul handball4all: Ein Trainer fügt den Link der Mannschaftsseite (`https://www.handball.net/team/<id>?…`) oder ihres Kalenders (`webcal://www.handball.net/kalender/team/<id>.ics`) ein, und von da an kommen Spiele, Hallen und Ergebnisse der Mannschaft von selbst in Kabine. Für Handballvereine ab Werk eingeschaltet, wie handball4all. Die [englische Fassung](README.md) enthält auch die technischen Einzelheiten.

- **Zugriff:** das öffentliche Kalender-Abo, das handball.net für jede Mannschaft anbietet („Kalender abonnieren“ auf der Mannschaftsseite, `https://www.handball.net/kalender/team/<id>.ics`). Es ist für Kalender-Apps gedacht (es kündigt eine Aktualisierung alle 6 Stunden an) und erlaubt Browser. Die interne Schnittstelle der Website ist für andere Seiten gesperrt und wird nicht verwendet. Nutzungsbedingungen: [handball.net](https://www.handball.net/nutzungsbedingungen).
- **Auf dem Server geprüft:** jedes Spiel muss die Mannschaft des Kalenders nennen.
- **Daten:** pro Spiel Kennung, Spielnummer, Datum und Anpfiff, Heim und Gast, Halle mit Adresse, Ergebnis. Der Kalender hat keine Tabelle. Spiele ohne Uhrzeit (00:00) werden übersprungen, abgesagte Spiele fehlen im Kalender, also sagt Kabine sie ab. Keine personenbezogenen Daten.
- **Links in der App:** die Seite des Spiels auf handball.net (Liveticker, Bericht, Ergebnis) und die Seite der Mannschaft als Tabelle; einfache Links, es wird nichts abgerufen.

Offen: Eine Mannschaft in mehreren Ligen zeigt vielleicht alle in einem Kalender; ob die Kennung der Mannschaft in der nächsten Saison gleich bleibt, ist noch nicht bekannt.

## So funktioniert der Abgleich

- **Im Browser des Trainers, nicht auf dem Server.** Die App auf dem Handy oder Computer eines Trainers der Mannschaft holt den Kalender der Mannschaft, eine Anfrage, wie eine Kalender-App auf dem Handy, und gibt ihn an den Server des Vereins, der ihn prüft. Der Server hat keinen Zeitplan, nach dem er abruft, und ruft handball.net nie selbst auf.
- **Einmal pro Woche,** wenn ein Trainer der Mannschaft die App öffnet und der letzte Abgleich 7 Tage oder länger her ist, für verlegte und neue Spiele. Nur solange die Mannschaft noch Spiele vor sich hat; nach dem letzten Spiel der Saison hört es auf.
- **Nach einem Spiel ohne Ergebnis:** sobald Anpfiff plus Spielzeit der Altersklasse plus eine Stunde vorbei sind, höchstens zweimal pro Spiel und mindestens 3 Stunden auseinander. Dann wartet es auf das nächste Spiel. Jeder Abgleich zählt auch als der wöchentliche, in einer Woche mit Spiel gibt es also meist nur den nach dem Spiel.
- **Der Knopf** („Jetzt abgleichen“) ist für kurzfristig verlegte oder abgesagte Spiele: Trainer höchstens einmal pro Stunde und Mannschaft, Admins höchstens alle 10 Minuten pro Mannschaft.
- **Mehrere Trainer lösen einen Abruf aus, nicht jeder einen.** Ob ein Abgleich fällig ist, steht an der Mannschaft und am Spiel, und nur ein Gerät zur Zeit bekommt eine Reservierung für 10 Minuten; einen Abgleich, der noch nicht fällig ist, lehnt der Server ab. Admins ohne Trainerrolle lösen ihn nie von selbst aus, sonst würden sie für jede Mannschaft abrufen.
- **Wenn es scheitert,** steht der Fehler unter *Mannschaft → Einstellungen* und *Verwaltung → Spielpläne*, und der nächste App-Start eines Trainers versucht es erneut. Es gibt keinen Alarm und keine Wiederholungsschleife. Öffnet eine Weile kein Trainer die App, wird nichts abgerufen; der nächste, der sie öffnet, gleicht ab.

## Wie wenig abgerufen wird

Sehr wenig. Jeder Abgleich ist **eine Anfrage** für den Kalender einer Mannschaft, die Datei, die handball.net zum Abonnieren anbietet.

- **Pro Mannschaft und Woche in der Saison:** meist eine Anfrage (nach dem Spiel oder die wöchentliche). Höchstens eine wöchentliche plus zwei pro Spiel, und nur, wenn ein Trainer die App öffnet.
- **Ein großer Verein mit 50 Mannschaften** verursacht etwa **50 Anfragen pro Woche**, dazu einige, wenn Ergebnisse spät eingetragen werden, verteilt über die Woche, je nachdem, wann Trainer die App öffnen. Ein kleiner Verein mit 10 Mannschaften: etwa 10.
- **Zum Vergleich:** eine Person, die denselben Kalender in einer Kalender-App abonniert, ruft ihn alle 6 Stunden ab, etwa 28-mal pro Woche. Kabine ruft den Kalender einer Mannschaft etwa einmal pro Woche ab, für die ganze Mannschaft.
- **Links** zur Seite des Spiels und der Mannschaft sind einfache Links: handball.net sieht einen Besuch nur, wenn jemand einen antippt.
- **Außerhalb der Saison,** wenn alle Spiele gespielt sind, wird von selbst nichts abgerufen.

Das ist weit entfernt von automatisiertem Auslesen: kein Crawler, kein Server, der nach Zeitplan abruft, kein Auslesen von Webseiten, und nur der Kalender, den handball.net zum Abonnieren veröffentlicht.
