// Wartungsmodus (siehe worker/lib/maintenance.ts): Nicht-Admins sehen einen Hinweis,
// Admins ein rotes Banner. Der Zustand kommt aus /api/health und aus 503-Antworten der API.
import { useEffect, useState } from "preact/hooks";
import { useSession } from "./session";

let active = false;
const listeners = new Set<(on: boolean) => void>();

function set(on: boolean) {
  if (on === active) return;
  active = on;
  listeners.forEach((fn) => fn(on));
}

export async function checkMaintenance(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.ok) set(!!((await res.json()) as { maintenance?: boolean }).maintenance);
  } catch {
    // offline: Zustand unverändert
  }
  return active;
}

/** Aktiv? Prüft beim Start, beim Zurückkehren in die App und während der Wartung alle 20 Sekunden. */
export function useMaintenance(): boolean {
  const [on, setOn] = useState(active);
  useEffect(() => {
    listeners.add(setOn);
    void checkMaintenance();
    const onEvent = () => set(true);
    const onVisible = () => document.visibilityState === "visible" && void checkMaintenance();
    window.addEventListener("kabine:maintenance", onEvent);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      listeners.delete(setOn);
      window.removeEventListener("kabine:maintenance", onEvent);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => void checkMaintenance(), 20_000);
    return () => window.clearInterval(timer);
  }, [on]);
  return on;
}

/** Admins (auch im Trainer-Modus) kommen während der Wartung in die App. */
export function useIsAdmin(): boolean {
  const { me } = useSession();
  return !!me && (me.isAdmin || me.person.isAdmin || me.adminSwitch != null);
}

export function MaintenanceBanner() {
  const on = useMaintenance();
  const admin = useIsAdmin();
  if (!on || !admin) return null;
  return (
    <div class="maintenance-banner" role="alert">
      Wartungsmodus aktiv · Nur Admins können die App nutzen, Erinnerungen und Pushes aus dem Cron pausieren.
    </div>
  );
}

export function MaintenancePage() {
  const { refresh } = useSession();
  const on = useMaintenance();
  // Wartung vorbei: Sitzung neu laden, die App erscheint wieder
  useEffect(() => {
    if (!on) void refresh();
  }, [on]);
  return (
    <main class="page maintenance-page">
      <div class="content">
        <div class="empty">
          <img src="/icons/icon.svg" alt="" width="96" height="96" />
          <div class="title">Die App wird gerade gewartet</div>
          <p class="muted">Sie ist gleich wieder da. Die Seite lädt automatisch neu, sobald die Wartung vorbei ist.</p>
        </div>
      </div>
    </main>
  );
}
