// Wartungsmodus: Nur Admins kommen in die App, Cron-Läufe pausieren. Der Schalter liegt in KV
// (unabhängig von der Datenbank, damit er auch während Migrationen gilt) und wird mit
// `npm run maintenance:on` / `maintenance:off` gesetzt. Siehe docs/deployment.md, Wartungsmodus.

export const MAINTENANCE_KEY = "maintenance";

export interface MaintenanceState {
  since: string;
}

/** Aktueller Zustand; KV hält den Wert höchstens 30 Sekunden im Cache des Standorts. */
export async function maintenanceState(kv: KVNamespace): Promise<MaintenanceState | null> {
  const raw = await kv.get(MAINTENANCE_KEY, { cacheTtl: 30 });
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MaintenanceState>;
    return { since: typeof parsed.since === "string" ? parsed.since : "" };
  } catch {
    return { since: "" };
  }
}

/** Ohne Anmeldung erreichbar, damit Admins sich während der Wartung anmelden können. */
export function maintenanceAllowed(path: string, signedIn: boolean): boolean {
  if (path === "/api/health" || path.startsWith("/api/auth/") || path === "/api/client-errors") return true;
  // Ohne Anmeldung liefert /session nur „nicht angemeldet“ (Anmeldeseite für Admins)
  return path === "/api/session" && !signedIn;
}
