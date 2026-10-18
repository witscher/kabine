// Wann zeigt die App die Startanimation? Einmal am Tag, beim ersten Öffnen (Berliner Kalendertag).

/** lastShownDay und today als YYYY-MM-DD (Europe/Berlin). */
export function shouldShowSplash(lastShownDay: string | null, today: string): boolean {
  return lastShownDay !== today;
}
