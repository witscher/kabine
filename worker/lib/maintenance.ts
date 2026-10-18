// Maintenance mode: only admins get into the app, cron runs pause. The switch lives in KV
// (independent of the database, so it also applies during migrations) and is set with
// `npm run maintenance:on` / `maintenance:off`. See docs/operation.md, Maintenance mode.

export const MAINTENANCE_KEY = "maintenance";

export interface MaintenanceState {
  since: string;
}

/** Current state; KV keeps the value in the location's cache for at most 30 seconds. */
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

/** Reachable without sign-in, so admins can sign in during maintenance. */
export function maintenanceAllowed(path: string, signedIn: boolean): boolean {
  if (path === "/api/health" || path.startsWith("/api/auth/") || path === "/api/client-errors") return true;
  // Without sign-in, /session only returns "not signed in" (sign-in page for admins)
  return path === "/api/session" && !signedIn;
}
