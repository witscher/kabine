# Vereinsmaskottchen

Viele Vereine haben ein Maskottchen, das die Kinder kennen. Mit diesem Modul laden Admins seine Bilder hoch, und die App zeigt sie: Gesichter neben dem Ergebnis eines Spiels für Spieler unter 14 und das Maskottchen auf den Karten des Heimspieltags. Kabine enthält keine Bilder eines Vereins im Code. Die [englische Fassung](README.md) enthält auch die technischen Einzelheiten.

- **Plätze für Bilder:**
  - vier Gesichter für Ergebnisse, quadratisch: *Sieg*, *Unentschieden*, *Knapp verloren* (mit bis zu 4 Toren) und *Deutlich verloren* (mit 5 oder mehr). Die Ergebnisanzeige in der Terminliste wird sie verwenden; bis dahin sind sie nur gespeichert.
  - *Karte Heimspieltag:* das Bild auf der großen Karte des Heimspieltags, beliebige Form.
  - *Kachel Heimspieltag:* der Kopf auf den kleinen Kacheln späterer Heimspieltage und auf der Seite des Tages, beliebige Form.
- **Verwaltung → Vereinsmaskottchen:** eine Kachel pro Platz mit dem Bild auf einem Schachbrettmuster (so sieht man die Transparenz), hochladen oder ersetzen, entfernen.
- **Für andere Module:** das Modul Heimspieltag zeigt die Bilder, solange dieses Modul an ist. Ist es aus, bleiben die Bilder gespeichert, werden aber nicht gezeigt.
- In der öffentlichen Demo ist das Hochladen gesperrt.

## Bilder vorbereiten

Die App prüft jedes Bild vor dem Hochladen und sagt, was nicht passt. Diese Bilder kommen durch und sehen gut aus:

- **Format:** PNG oder WebP mit Transparenz, oder SVG. Ein SVG wird in der Größe des Platzes in ein PNG oder WebP gezeichnet, Verläufe, Filter und eingebettete Schriften werden also zu Pixeln; einfache Formen funktionieren am besten. JPEG wird abgelehnt, es hat keine Transparenz.
- **Größe:** mindestens 256 Pixel an der längeren Seite; 512 bis 1024 Pixel sind ein guter Anfang. Die App verkleinert Gesichter und Kopf auf 256 Pixel und das Bild der Karte auf 512 Pixel, nie größer als das Original.
- **Gesichter quadratisch:** Breite und Höhe dürfen höchstens 2 % voneinander abweichen; das Gesicht wird dann quadratisch gezeichnet. Etwas Platz um das Gesicht lassen, damit es nicht an die Ränder stößt.
- **Hintergrund durchsichtig oder weiß:** die App prüft die äußeren zwei Pixelreihen und -spalten. Ist mehr als ein Viertel davon weder durchsichtig noch weiß, gilt das Bild als farbig hinterlegt und wird abgelehnt. Ein Maskottchen, das hier und da den Rand berührt, ist in Ordnung, ein farbiges Quadrat dahinter nicht. Durchsichtig ist am besten: die große Karte des Heimspieltags ist schwarz, ein weißer Hintergrund erscheint dort als weißer Kasten.
- **Höchstens etwa 200 KB** nach dem Verkleinern (200.000 Bytes). Die gewählte Datei darf größer sein: die App komprimiert sie und macht sie, wenn sie immer noch zu groß ist, schrittweise kleiner, bis hinunter auf 256 Pixel. Flächige Farben und klare Umrisse bleiben klein; Fotos und feine Strukturen passen vielleicht nicht.
- **Eine einfache Form, die auch klein noch erkennbar ist:** die Gesichter erscheinen klein neben dem Ergebnis eines Spiels, der Kopf mit etwa 56 Pixeln auf den Kacheln, das Bild der Karte etwa 120 Pixel breit. Kräftige Umrisse, wenige Details, ein klarer Ausdruck. Das Bild vor dem Hochladen einmal in dieser Größe anschauen.
- **Ein Gesicht pro Ergebnis:** *Sieg*, *Unentschieden*, *Knapp verloren* und *Deutlich verloren*. Die vier sollten sich gleichen, mit gleichem Ausschnitt und gleicher Größe, so dass sich nur der Ausdruck ändert: jubelnd, zufrieden, ein wenig traurig, aber aufmunternd, tröstend. Sie werden Spielern unter 14 gezeigt, die Niederlagen also freundlich halten.
- **Karte und Kopf:** das Bild der *Karte Heimspieltag* darf jede Form haben, ein Maskottchen, das jubelt oder winkt, passt gut; es sitzt unten rechts auf der großen Karte. Die *Kachel Heimspieltag* zeigt nur den Kopf, ungefähr quadratisch, weil er in einem kleinen Quadrat erscheint.

Wo ein Bild fehlt, wird an seiner Stelle nichts gezeigt; ein Verein kann also mit den Gesichtern anfangen und den Rest später ergänzen.

## Datenschutz

- **Speichert:** keine personenbezogenen Daten. Bis zu sechs Bilder (`mascot_images`: Platz, Typ, Version, Zeitpunkt des Hochladens, Bild), von einem Admin hochgeladen; wer hochgeladen hat, wird nicht gespeichert.
- **Wer es sieht:** alle, die die App öffnen, wie das Vereinslogo (auch auf der Anmeldeseite). Mit der Version in der Adresse ausgeliefert und ein Jahr lang zwischengespeichert.
- **Gelöscht:** wenn ein Admin ein Bild entfernt oder ersetzt. Nicht im Export.
