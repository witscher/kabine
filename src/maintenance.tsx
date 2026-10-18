// Maintenance mode (see worker/lib/maintenance.ts): non-admins see a notice,
// admins a red banner. The state comes from /api/health and from 503 responses of the API.
import { Trans } from "@lingui/react/macro";
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
    // offline: state unchanged
  }
  return active;
}

/** Active? Checks at start, when returning to the app and every 20 seconds during maintenance. */
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

/** Admins (also in coach mode) get into the app during maintenance. */
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
      <Trans>Maintenance mode active · Only admins can use the app, reminders and pushes from the cron are paused.</Trans>
    </div>
  );
}

export function MaintenancePage() {
  const { refresh } = useSession();
  const on = useMaintenance();
  // Maintenance over: reload the session, the app appears again
  useEffect(() => {
    if (!on) void refresh();
  }, [on]);
  return (
    <main class="page maintenance-page">
      <div class="content">
        <div class="empty">
          <img src="/icons/icon.svg" alt="" width="96" height="96" />
          <div class="title">
            <Trans>The app is currently under maintenance</Trans>
          </div>
          <p class="muted">
            <Trans>It will be back shortly. The page reloads automatically as soon as maintenance is over.</Trans>
          </p>
        </div>
      </div>
    </main>
  );
}
