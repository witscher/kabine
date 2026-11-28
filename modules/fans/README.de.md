# Fans

Alle mit einem Zugang können anderen Mannschaften des Vereins folgen und deren Spiele sehen, etwa ein Jugendspieler, der die erste Damenmannschaft anschauen will, oder Eltern eines D-Jugend-Spielers, die der C-Jugend folgen. Die [englische Fassung](README.md) enthält auch die technischen Einzelheiten.

- **Profil → Fan von …:** alle Mannschaften des Vereins (keine Gruppen). Eigene Mannschaften (in jeder Rolle) und die Mannschaften der Kinder, bei denen Eltern eingebunden sind, sind fest dabei: deren Termine sind ohnehin da. Ein Stern folgt einer Mannschaft. Schalter: *Nur Heimspiele* (Liste, Push und Kalender; unbekannt zählt als auswärts) und ein Knopf mit dem Vereinskürzel in der Terminliste (pro Gerät).
- **Startseite:** ein Stern hinter den Mannschaftsknöpfen schaltet die Spiele aller gefolgten Mannschaften ein (nur Spiele, nie Trainings). Sie stehen als eigene Zeilen in der Liste, nach Zeit einsortiert, mit einem gelben *Heim*-Zeichen bei Heimspielen. Gespielte Spiele fallen aus *Kommend* heraus. Ein laufendes Spiel zeigt *Spiel läuft gerade* und die Live-Links der Spielplan-Module. Der Knopf mit dem Vereinskürzel zeigt alle Spiele des Vereins.
- **Spielseite:** Beginn, Halle, Gegner, Ergebnis, ob es stattfindet, Liveticker oder Spielbericht. Jede angemeldete Person kann sie für ein Spiel einer Mannschaft des Vereins öffnen (diese Daten sind ohnehin öffentlich); nie die Terminseite, den Kader, Rückmeldungen, Namen, Treffpunkt, den Grund einer Absage, Fahrgemeinschaften oder den Chat.
- **Push** (Thema *Spiele als Fan*, nur für den eigenen Zugang, nicht pro Kind): wenn ein kommendes Spiel abgesagt wird, die Absage zurückgenommen wird oder sich Beginn oder Halle ändern (von Hand oder durch einen Spielplan-Abgleich), und der frühere von altem und neuem Beginn höchstens 72 Stunden entfernt ist. Ohne Grund. Nicht an Mitglieder der Mannschaften des Spiels und deren Eltern, die bekommen die Nachricht der Mannschaft.
- **Kalender:** ein Haken *Spiele als Fan* unter *Profil → Meine Termine*, ab Werk aus. Nur Spieldaten.

## Datenschutz

- **Speichert:** pro Zugang die gefolgten Mannschaften (`fan_follows`), ob *Nur Heimspiele* an ist (`fan_home_only`) und ob die Spiele in den Kalender kommen (`fan_calendar`). Auf dem Gerät: der Stern und die Ansicht aller Spiele (`kabine-home-list`), der Vereinsknopf (`kabine-fans-club-button`), ohne personenbezogene Daten.
- **Wer es sieht:** nur die Person selbst. Niemand kann lesen, wem andere folgen. Fans sehen nur Spieldaten.
- **Gelöscht:** wenn die Person nicht mehr folgt oder es abschaltet, den Verein verlässt oder die Mannschaft oder der Zugang gelöscht wird.
- **Saisonwechsel:** gefolgte Mannschaften bleiben. Eine gefolgte Mannschaft, in der man jetzt selbst spielt, zählt als eigene.
- **Export:** gefolgte Mannschaften und *Nur Heimspiele* sind im Export und in der Wiederherstellung enthalten, wie die Benachrichtigungseinstellungen; die Kalender-Einstellung nicht.
