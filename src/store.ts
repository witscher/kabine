// Kleiner Daten-Cache mit Abonnements: Seiten laden über useQuery, nach
// Änderungen werden betroffene Schlüssel per invalidate() neu geladen.
import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";
import { api, ApiError } from "./api";

interface Entry {
  data?: unknown;
  error?: ApiError;
  promise?: Promise<void>;
  loadedAt?: number;
  stale: boolean;
}

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  for (const fn of listeners.get(key) ?? []) fn();
}

function load(key: string, fetcher: () => Promise<unknown>): Promise<void> {
  const entry = cache.get(key) ?? { stale: true };
  if (entry.promise) return entry.promise;
  entry.promise = fetcher()
    .then((data) => {
      entry.data = data;
      entry.error = undefined;
      entry.loadedAt = Date.now();
      entry.stale = false;
    })
    .catch((err: unknown) => {
      entry.error = err instanceof ApiError ? err : new ApiError(0, "error", String(err));
      entry.stale = false;
    })
    .finally(() => {
      entry.promise = undefined;
      notify(key);
    });
  cache.set(key, entry);
  notify(key);
  return entry.promise;
}

const fetchers = new Map<string, () => Promise<unknown>>();

export function useQuery<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const pathRef = useRef(path);
  pathRef.current = path;
  const rendered = useRef<{ data?: unknown; error?: ApiError }>({});

  useEffect(() => {
    if (!path) return;
    const fn = () => force(0);
    if (!listeners.has(path)) listeners.set(path, new Set());
    listeners.get(path)!.add(fn);
    const fetcher = () => api.get<T>(path);
    fetchers.set(path, fetcher);
    const entry = cache.get(path);
    // Zwischen dem Zeichnen und dieser Anmeldung kann die Antwort schon da sein.
    // Die Benachrichtigung ging dann ins Leere: einmal neu zeichnen.
    if (entry && (entry.data !== rendered.current.data || entry.error !== rendered.current.error)) fn();
    const tooOld = entry?.loadedAt && opts.refreshMs ? Date.now() - entry.loadedAt > opts.refreshMs : false;
    if (!entry || entry.stale || tooOld) void load(path, fetcher);
    return () => {
      listeners.get(path)?.delete(fn);
    };
  }, [path]);

  const entry = path ? cache.get(path) : undefined;
  rendered.current = { data: entry?.data, error: entry?.error };
  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (p) await load(p, fetchers.get(p) ?? (() => api.get(p)));
  }, []);
  const mutate = useCallback((data: T) => {
    const p = pathRef.current;
    if (!p) return;
    const e = cache.get(p) ?? { stale: false };
    e.data = data;
    cache.set(p, e);
    notify(p);
  }, []);

  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!path && (!entry || (!!entry.promise && entry.data === undefined)),
    refreshing: !!entry?.promise,
    reload,
    mutate,
  };
}

/** Markiert alle Schlüssel mit diesem Präfix als veraltet und lädt sichtbare neu. */
export function invalidate(...prefixes: string[]) {
  for (const [key, entry] of cache) {
    if (!prefixes.some((p) => key.startsWith(p))) continue;
    entry.stale = true;
    if ((listeners.get(key)?.size ?? 0) > 0) void load(key, fetchers.get(key) ?? (() => api.get(key)));
  }
}

/** Alles neu laden: Sichtbares sofort (Promise wartet darauf), der Rest beim nächsten Öffnen. */
export function refreshVisible(): Promise<void> {
  const loads: Promise<void>[] = [];
  for (const [key, entry] of cache) {
    entry.stale = true;
    if ((listeners.get(key)?.size ?? 0) > 0) loads.push(load(key, fetchers.get(key) ?? (() => api.get(key))));
  }
  return Promise.all(loads).then(() => undefined);
}

export function clearCache() {
  cache.clear();
}
