# handball4all

Spielpläne der deutschen Handballverbände von [handball4all](https://www.handball4all.de). Ein Trainer fügt den Link der Mannschaftsseite im Portal des Verbands ein; die App liest daraus Verband (`ogId`), Liga (`lId`) und Mannschaft (`tId`), und von da an kommen Spiele, Hallen, Ergebnisse und die Tabelle der Mannschaft von selbst in Kabine. Die [englische Fassung](README.md) enthält auch die technischen Einzelheiten.

- **Zugriff:** die öffentliche JSON-Schnittstelle, die die Portale selbst verwenden (`spo.handball4all.de/service/if_g_json.php`). Sie ist gegen automatisierte Zugriffe geschützt und erlaubt Browser (CORS), deshalb holt das Gerät des Trainers die Daten, wie die Portalseite im Browser. Der Server ruft handball4all nie auf.
- **Daten:** Spiele, Hallen, Ergebnisse und die Tabelle der Liga. Keine personenbezogenen Daten. Die Tabelle kommt mit dem Spielplan, ohne zusätzlichen Abruf.
- **Links in der App:** Tabelle, Liveticker während eines Spiels und danach der Spielbericht; beide werden erst beim Antippen nachgeschlagen, vom Gerät, ohne Cookies und Referrer.

## Link der Mannschaft

Ein Trainer der Mannschaft oder ein Admin kopiert einmal die Adresse der Mannschaftsseite im Portal des Verbands:

1. Öffne das Portal des Verbands auf handball4all.de (die Website des Verbands verlinkt es, meist bei Spielbetrieb oder Ergebnissen), wähl die Liga und dann die Mannschaft, etwa mit einem Tipp auf ihren Namen in der Tabelle.
2. Kopier die Adresse aus der Adresszeile des Browsers. Sie sieht so aus, mit dem Portalnamen des Verbands und drei Zahlen (die hier sind erfunden):

   `https://www.handball4all.de/home/portal/beispiel-hv#/league?ogId=123&lId=45678&tId=901234`

   Es kommt auf die drei Zahlen an: `ogId` (Verband), `lId` (Liga) und `tId` (Mannschaft), hinter `#` oder `?`. Ein Link der Liga ohne `tId` reicht nicht. Jede Adresse auf handball4all.de mit diesen Zahlen funktioniert, auch der Schnittstellen-Link `https://spo.handball4all.de/service/if_g_json.php?cmd=ps&og=123&cl=45678&ct=901234`.
3. Öffne in Kabine *Mannschaft → Einstellungen → Spielplan*, füg ihn bei *Link aus dem handball4all-Portal* ein (sind mehrere Quellen eingeschaltet, wähl vorher *handball4all* als Quelle), tipp auf *Verknüpfen* und dann auf *Jetzt abgleichen*.

Spielt die Mannschaft in einer neuen Liga (etwa nach dem Saisonwechsel), verknüpfst du den neuen Link genauso.

## So funktioniert der Abgleich

- **Im Browser des Trainers, nicht auf dem Server.** Die App auf dem Handy oder Computer eines Trainers der Mannschaft holt den Spielplan der Mannschaft, eine Anfrage, und gibt ihn an den Server des Vereins, der ihn prüft wie alles, was aus einem Browser kommt. Der Server hat keinen Zeitplan, nach dem er abruft, und ruft handball4all nie selbst auf.
- **Einmal pro Woche,** wenn ein Trainer der Mannschaft die App öffnet und der letzte Abgleich 7 Tage oder länger her ist, für verlegte und neue Spiele. Nur solange die Mannschaft noch Spiele vor sich hat; nach dem letzten Spiel der Saison hört es auf.
- **Nach einem Spiel ohne Ergebnis:** sobald Anpfiff plus Spielzeit der Altersklasse plus eine Stunde vorbei sind, höchstens zweimal pro Spiel und mindestens 3 Stunden auseinander. Dann wartet es auf das nächste Spiel. Jeder Abgleich zählt auch als der wöchentliche, in einer Woche mit Spiel gibt es also meist nur den nach dem Spiel.
- **Der Knopf** („Jetzt abgleichen“) ist für kurzfristig verlegte oder abgesagte Spiele: Trainer höchstens einmal pro Stunde und Mannschaft, Admins höchstens alle 10 Minuten pro Mannschaft.
- **Mehrere Trainer lösen einen Abruf aus, nicht jeder einen.** Ob ein Abgleich fällig ist, steht an der Mannschaft und am Spiel, und nur ein Gerät zur Zeit bekommt eine Reservierung für 10 Minuten. Admins ohne Trainerrolle lösen den Abgleich nie von selbst aus, sonst würden sie für jede Mannschaft abrufen.
- **Wenn es scheitert** (die Schnittstelle ist nicht erreichbar), steht der Fehler unter *Mannschaft → Einstellungen* und *Verwaltung → Spielpläne*, und der nächste App-Start eines Trainers versucht es erneut. Es gibt keinen Alarm und keine Wiederholungsschleife.

## Wie wenig abgerufen wird

Sehr wenig. Jeder Abgleich ist **eine Anfrage** für eine Mannschaft: dasselbe JSON, das ein Browser lädt, wenn jemand die Seite der Mannschaft im Portal öffnet.

- **Pro Mannschaft und Woche in der Saison:** meist eine Anfrage (nach dem Spiel oder die wöchentliche). Höchstens eine wöchentliche plus zwei pro Spiel, und nur, wenn ein Trainer die App öffnet. Ist das Ergebnis beim ersten Versuch da, braucht es keinen zweiten.
- **Ein großer Verein mit 50 Mannschaften** verursacht etwa **50 Anfragen pro Woche**, dazu einige, wenn Ergebnisse spät eingetragen werden, verteilt über die Woche, je nachdem, wann Trainer die App öffnen. Ein kleiner Verein mit 10 Mannschaften: etwa 10.
- **Liveticker und Spielbericht:** wenn jemand auf den Knopf tippt, lädt sein Gerät den Spielplan der Mannschaft einmal, um den Ticker oder Bericht des Spiels zu finden, und öffnet ihn. Ohne Antippen wird nichts abgerufen, nichts fragt regelmäßig nach.
- **Außerhalb der Saison,** wenn alle Spiele gespielt sind, wird von selbst nichts abgerufen.

Das ist weit entfernt von automatisiertem Auslesen: kein Crawler, kein Server, der nach Zeitplan abruft, keine Abrufe anderer Mannschaften oder Ligen, und pro Mannschaft etwa so viel wie eine Person, die einmal pro Woche die Seite der Mannschaft im Portal anschaut.
