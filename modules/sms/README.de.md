# SMS

Anmeldecodes und Erinnerungen an Helferdienste per SMS, für Personen, die eine Handynummer eintragen. Ab Werk aus; es braucht ein Konto bei einem SMS-Anbieter (Kosten pro Nachricht). Erster Anbieter: [seven.io](https://www.seven.io) (deutsches Unternehmen, Server in der EU). Die [englische Fassung](README.md) enthält auch die technischen Einzelheiten.

- **Speichert:** die Handynummer von Personen, die selbst eine eintragen, und ob sie bestätigt ist. Der Schlüssel des Anbieters wird verschlüsselt gespeichert.
- **Wer es sieht:** niemand außer der Person selbst, auch keine Admins.
- **Gelöscht:** wenn sie im Profil entfernt wird und wenn die Person den Verein verlässt.

Solange das Modul an ist, zeigt das Profil das Feld für die Handynummer und die Anmeldeseite „Code per SMS“. Die Zugangsdaten des Anbieters trägt ein Admin unter *Verwaltung → SMS* ein. Wer das Modul einschaltet, ergänzt die Datenschutzerklärung des Vereins um den SMS-Anbieter.
