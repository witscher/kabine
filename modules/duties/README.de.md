# Helferdienste

Eltern (oder die Spieler selbst) tragen sich für Dienste bei Heimspielen, Sonderterminen und Vereinsterminen ein: Kuchen und Theke, Zeitnehmer, Trikots waschen. Trainer wählen pro Mannschaft Vorlagen, Organisatoren von Sonderterminen planen ihre eigenen Dienste. Erinnerungen kommen per Push, E-Mail oder, mit dem SMS-Modul, per SMS. Die [englische Fassung](README.md) enthält auch die technischen Einzelheiten.

- **Speichert:** wer welchen Dienst bei welchem Spiel oder Termin übernimmt, optionale Notizen (etwa welcher Kuchen), Dienstwünsche und „Das kann ich“, Freigaben durch Admins (etwa Jugendschiedsrichter, auch für Kinder) und die Links, die sie erteilen (als Hash), die Dienste, die jedes Heimspiel einer Altersklasse bekommt, aus welchen Mannschaften die Helfer einer Vorlagenzeile oder eines Zeitblocks kommen (und bei abwechselnden Mannschaften, welche dran ist und ob ihr Chat Bescheid bekam), welche Erinnerungen verschickt wurden. Tabellen `duty_types`, `duty_templates`, `duty_template_items`, `event_duties`, `duties`, `skill_consents`, `skill_grants`, `skill_grant_links`, `age_class_duties`, `duty_notifications`.
- **Liest außerdem:** den Jahrgang der Person, die einen Dienst „Nur Erwachsene“ übernehmen würde (keine neuen Daten).
- **Wer es sieht:** die Helfer der Mannschaft sehen Namen als „Vorname N.“, Trainer und Admins vollständig. Der persönliche Kalenderlink enthält nur die eigenen Dienste und die der eigenen Kinder.
- **Gelöscht:** beim Saisonwechsel.

## Helfer-Tab

Ohne Auswahl zeigt der Tab die Termine aller Mannschaften der Person zusammen, jeden mit seinem Mannschaftszeichen; ein Tipp auf eine Mannschaft filtert, ein zweiter hebt den Filter auf, wie in der Terminliste. Die Jugendschiedsrichter haben eine eigene Liste. Top-Helfer erscheinen nur für eine einzelne Mannschaft. Ein Link von einem Termin wählt dessen Mannschaft und springt zum Termin.

## Dienstarten

Eine Dienstart sagt, *was* zu tun ist: Name, vor Ort oder Aufgabe, Hinweis, Vorkenntnisse, und wer hilft, bezogen auf die Mannschaft des Termins (Eltern, Spielerinnen und Spieler, Trainer, Mitglieder; darf leer bleiben, wenn die Helfer aus anderen Mannschaften kommen). Drei Schalter:

- **Vergibt der Trainer:** niemand trägt sich selbst ein. Trainer, Admins und Organisatoren tragen unter *Jemanden eintragen* Personen ein; angeboten werden nur Personen, die zu „Wer hilft“ oder zu den Mannschaften des Zeitblocks passen. Die Person (und die Eltern eines Kindes) erfährt es sofort und kann zurücktreten. Kein „Helfer gesucht“, zählt nicht bei „Helfer gesucht“; Trainer sehen die offenen Plätze trotzdem.
- **„Helfer gesucht“ schicken** (für neue Dienstarten an): aus bei Diensten, bei denen die Nachricht zu viele erreichen würde. Wird nur ein Dienst gesucht, nennt ihn die Push-Nachricht.
- **Nur Erwachsene:** wer nach Jahrgang unter 18 ist, kann sich nicht eintragen, wird nicht eingetragen und bekommt kein „Helfer gesucht“. Ohne Jahrgang zählt eine Person als erwachsen; es zählt, wer den Dienst macht (ein Elternteil für die Mannschaft seines Kindes, das Kind, wenn es selbst aushilft).

Admins können eine Dienstart mit einer anderen derselben Art **zusammenführen**: Vorlagenzeilen, Zeitblöcke, Einträge, Zustimmungen, Freigaben und Pflichtdienste der Altersklassen wandern mit, die alte Dienstart wird gelöscht.

## Helfer aus

Jede Vorlagenzeile und jeder Zeitblock sagt, woher die Helfer kommen:

- **Wie Dienstart:** „Wer hilft“ der Dienstart für die Mannschaft des Termins (bei Vereinsterminen für alle Mannschaften).
- **Mannschaften:** nur die Spieler dieser Mannschaften; bei Kindern tragen die beteiligten Eltern das Kind ein, und das Kind macht den Dienst. Trainer und Admins des Termins können sich weiterhin selbst eintragen.
- **Abwechselnd** (nur in Vorlagen): jedes Spiel bekommt die nächste Mannschaft der Liste, nach der des letzten Blocks dieser Dienstart mit derselben Liste. Die Mannschaft wird am Block gespeichert: verlegte, abgesagte oder neue Spiele mischen nicht neu. Verantwortliche ändern sie pro Spiel innerhalb der Liste und sehen einen Hinweis, wenn die Mannschaft zur selben Zeit einen eigenen Termin hat. Eine Woche vorher bekommt die Mannschaft eine Systemnachricht in ihrem Chat, keine Push-Nachricht an alle Eltern.

Die Liste **Aushelfen** im Helfer-Tab zeigt kommende Termine anderer Mannschaften mit solchen Blöcken, die eine Mannschaft nennen, in der man selbst oder ein Kind spielt (abwechselnd: nur, wenn diese Mannschaft dran ist). Wer sich darüber einträgt (oder vom Trainer eingetragen wird), sieht den Termin der anderen Mannschaft, ohne die Teilnehmerliste.

## Vereinstermine

Sondertermine für den ganzen Verein (ohne Mannschaft) können Zeitblöcke haben, beim Anlegen oder später. Alle sehen alle Dienste; eintragen darf sich, wer nach „Wer hilft“ über alle Mannschaften passt, und „Helfer aus“ gilt wie sonst. Admins und die Organisatoren des Termins verwalten sie, nicht die Trainer einzelner Mannschaften. Der Helfer-Tab zeigt sie unter **Ganzer Verein**. Kein „Helfer gesucht“ (es würde den ganzen Verein erreichen), Erinnerungen an die Eingetragenen wie sonst.

## Dienste eines Termins verwalten

*Dienste verwalten* (Helfer-Tab) und *Helferdienste verwalten* (Seite eines Sondertermins) öffnen dasselbe Fenster: Zeitblöcke nacheinander hinzufügen, eine Vorlage anwenden, Zeit, Plätze und „Helfer aus“ ändern, Personen eintragen. Ein Zeitblock lässt sich mit seinen Einträgen löschen, nach einer Rückfrage, die sagt, wie viele mitgehen; benachrichtigt wird niemand.

## Qualifikationen

Dienste mit Vorkenntnissen gibt die Person selbst frei („Das kann ich“) oder ein Admin. Von Admins freigegebene Dienste können die freigegebenen Personen aus allen Mannschaften übernehmen, etwa Jugendschiedsrichter bei den Heimspielen der jüngsten Altersklassen. Admins verwalten das unter *Verwaltung → Freigaben*, auch mit Links, die eine Freigabe erteilen.

## Dienstart löschen

Admins löschen eine Dienstart nur, wenn sie nirgends verwendet wird: in keiner Vorlage, in keinem Pflichtdienst einer Altersklasse und in keinem Zeitblock eines Termins, auch vergangener, denn diese Einträge der Helfer gingen mit. Zustimmungen und Freigaben zu ihr gehen mit. *Wer sie übernimmt* lässt sich später ändern.
