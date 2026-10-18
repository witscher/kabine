// Offline-Betrieb: Der Service Worker liefert ohne Netz den zuletzt geladenen
// Stand (Kennzeichen x-kabine-offline). Hier merkt sich die App, ob sie gerade
// offline ist, zeigt einen Hinweis und lädt alles neu, sobald das Netz zurück ist.
import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icons";

const OFFLINE_DATA_CACHE = "kabine-api";
const PROBE_EVERY_MS = 15_000;

let offline = typeof navigator !== "undefined" && navigator.onLine === false;
const listeners = new Set<(v: boolean) => void>();
let probe: number | undefined;

function set(value: boolean) {
  if (offline === value) return;
  offline = value;
  for (const l of listeners) l(value);
  if (value) startProbe();
  else {
    stopProbe();
    // Alles neu laden, was gerade angezeigt wird (siehe app.tsx)
    window.dispatchEvent(new CustomEvent("kabine:online"));
  }
}


/** Vom API-Client nach jeder Antwort aufgerufen. */
export function noteResponse(res: Response) {
  set(res.headers.get("x-kabine-offline") === "1");
}

export function noteNetworkError() {
  set(true);
}

async function checkOnline() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.ok) set(false);
  } catch {
    // weiter offline
  }
}

function startProbe() {
  if (probe != null) return;
  probe = window.setInterval(() => void checkOnline(), PROBE_EVERY_MS);
}

function stopProbe() {
  if (probe == null) return;
  window.clearInterval(probe);
  probe = undefined;
}

export function startOfflineWatch() {
  window.addEventListener("online", () => void checkOnline());
  window.addEventListener("offline", () => set(true));
  if (offline) startProbe();
}

/** Gespeicherte Daten dieses Geräts verwerfen, z. B. beim Abmelden. */
export async function clearOfflineData() {
  try {
    await caches.delete(OFFLINE_DATA_CACHE);
  } catch {
    // ohne Cache API nichts zu tun
  }
}

/** Kleine Datenmengen (z. B. den Chatverlauf) für offline merken. */
export async function saveOffline(key: string, data: unknown) {
  try {
    const cache = await caches.open(OFFLINE_DATA_CACHE);
    await cache.put(`/offline/${key}`, new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }));
  } catch {
    // nicht schlimm
  }
}

export async function loadOffline<T>(key: string): Promise<T | null> {
  try {
    const cache = await caches.open(OFFLINE_DATA_CACHE);
    const hit = await cache.match(`/offline/${key}`);
    return hit ? ((await hit.json()) as T) : null;
  } catch {
    return null;
  }
}

export function useOffline(): boolean {
  const [value, setValue] = useState(offline);
  useEffect(() => {
    listeners.add(setValue);
    setValue(offline);
    return () => void listeners.delete(setValue);
  }, []);
  return value;
}

export function OfflineBanner() {
  const value = useOffline();
  if (!value) return null;
  return (
    <div class="offline-banner" role="status">
      <Icon name="info" size={18} />
      <span>Du bist gerade offline. Du siehst den zuletzt geladenen Stand.</span>
    </div>
  );
}
