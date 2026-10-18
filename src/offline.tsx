// Offline use: without network the service worker delivers the last loaded
// state (marker x-kabine-offline). Here the app remembers whether it is currently
// offline, shows a notice and reloads everything as soon as the network is back.
import { Trans } from "@lingui/react/macro";
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
    // Reload everything currently shown (see app.tsx)
    window.dispatchEvent(new CustomEvent("kabine:online"));
  }
}


/** Called by the API client after every response. */
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
    // still offline
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

/** Discard stored data of this device, e.g. on sign-out. */
export async function clearOfflineData() {
  try {
    await caches.delete(OFFLINE_DATA_CACHE);
  } catch {
    // nothing to do without the Cache API
  }
}

/** Remember small amounts of data (e.g. the chat history) for offline use. */
export async function saveOffline(key: string, data: unknown) {
  try {
    const cache = await caches.open(OFFLINE_DATA_CACHE);
    await cache.put(`/offline/${key}`, new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }));
  } catch {
    // not a problem
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
      <span>
        <Trans>You are offline. You are seeing the last loaded state.</Trans>
      </span>
    </div>
  );
}
