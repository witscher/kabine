// When does the app show the start animation? Once a day, on first opening (Berlin calendar day).

/** lastShownDay and today as YYYY-MM-DD (Europe/Berlin). */
export function shouldShowSplash(lastShownDay: string | null, today: string): boolean {
  return lastShownDay !== today;
}
