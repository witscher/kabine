// Neue Versionen erkennen. Nach einem Deployment fehlen die nachgeladenen
// Dateien der alten Version, eine offene App würde sonst beim nächsten
// Seitenwechsel hängen bleiben. Die installierte App auf dem Home-Bildschirm
// läuft oft tagelang, ohne neu geladen zu werden.
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { lazy } from "preact-iso";
import { Icon } from "./icons";

const CURRENT = __APP_VERSION__;
const CHECK_EVERY_MS = 10 * 60 * 1000;
/** So lange im Hintergrund, dann lädt die App beim Zurückkehren ohne Nachfrage neu. */
const AUTO_RELOAD_AFTER_HIDDEN_MS = 30 * 1000;
const RELOAD_GUARD = "kabine-reloaded-for";

let available = false;
const listeners = new Set<(v: boolean) => void>();

function setAvailable() {
  if (available) return;
  available = true;
  for (const l of listeners) l(true);
}

async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<boolean> {
  if (!import.meta.env.PROD) return false;
  const latest = await latestVersion();
  if (latest && latest !== CURRENT) setAvailable();
  return available;
}

/** Neu laden, höchstens einmal pro neuer Version automatisch (gegen Schleifen). */
export function reloadApp(auto = false) {
  if (auto) {
    try {
      if (sessionStorage.getItem(RELOAD_GUARD) === CURRENT) return false;
      sessionStorage.setItem(RELOAD_GUARD, CURRENT);
    } catch {
      // Ohne Speicher lieber nicht automatisch
      return false;
    }
  }
  void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
  window.location.reload();
  return true;
}

let hiddenSince: number | null = null;

export function startUpdateChecks() {
  if (!import.meta.env.PROD) return;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      hiddenSince = Date.now();
      return;
    }
    const wasAway = hiddenSince != null && Date.now() - hiddenSince >= AUTO_RELOAD_AFTER_HIDDEN_MS;
    hiddenSince = null;
    // Wer die App aus dem Hintergrund holt, bekommt die neue Version ohne Rückfrage
    if ((await checkForUpdate()) && wasAway) reloadApp(true);
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void checkForUpdate();
  }, CHECK_EVERY_MS);
}

function UpdateRequired() {
  return (
    <main class="page no-tabs">
      <div class="content">
        <div class="empty">
          <div class="title">{available ? "Die App wurde aktualisiert" : "Seite konnte nicht geladen werden"}</div>
          <p>{available ? "Bitte einmal neu laden, dann geht es weiter." : "Prüfe deine Internetverbindung und lade die App neu."}</p>
          <button type="button" class="btn btn-primary" onClick={() => reloadApp()}>
            Neu laden
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Wie lazy() aus preact-iso, aber wenn die Datei der Seite nicht mehr
 * existiert (neue Version deployt), lädt die App neu oder bittet darum.
 */
export function lazyPage<P>(load: () => Promise<ComponentType<P>>) {
  return lazy(() =>
    load().catch(async (err: unknown) => {
      console.warn("Seite konnte nicht geladen werden", err);
      if ((await checkForUpdate()) && reloadApp(true)) return new Promise<never>(() => undefined);
      return UpdateRequired as unknown as ComponentType<P>;
    }),
  );
}

export function UpdateBanner() {
  const [show, setShow] = useState(available);
  useEffect(() => {
    listeners.add(setShow);
    return () => void listeners.delete(setShow);
  }, []);
  if (!show) return null;
  return (
    <div class="update-banner" role="status">
      <Icon name="refresh" size={18} />
      <span>Es gibt eine neue Version der App.</span>
      <button type="button" class="btn btn-sm btn-accent" onClick={() => reloadApp()}>
        Jetzt laden
      </button>
    </div>
  );
}
