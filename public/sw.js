// Service worker of Kabine: App offline nutzbar, Web Push.
//
// Offline: Die App-Dateien liegen vorab im Cache (Liste aus /version.json).
// Daten der API holt der Service Worker immer zuerst aus dem Netz und merkt
// sich die letzte Antwort. Ohne Netz liefert er diese mit dem Kennzeichen
// x-kabine-offline aus, die App zeigt dann "Du bist gerade offline".
const CACHE = "kabine-shell-v1";
const API_CACHE = "kabine-api";
const SHELL = ["/", "/icons/icon-192.png"];
/** So lange warten wir auf das Netz, bevor der gespeicherte Stand kommt. */
const NETWORK_TIMEOUT_MS = 6000;

// Nie aus dem Cache: Anmeldung, Einladungen, Export und die Verbindungsprüfung
const API_NO_CACHE = [/^\/api\/auth\//, /^\/api\/join/, /^\/api\/email/, /^\/api\/admin\/export/, /^\/api\/health$/, /^\/api\/client-errors/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isHtml(res) {
  return (res.headers.get("content-type") || "").includes("text/html");
}

/** Netz mit Zeitlimit. Die Antwort wird auch nach Ablauf noch gespeichert. */
function fetchWithTimeout(req, onResponse) {
  const network = fetch(req).then((res) => {
    onResponse(res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  return { network, raced: Promise.race([network.catch(() => null), timeout]) };
}

function markOffline(hit) {
  const headers = new Headers(hit.headers);
  headers.set("x-kabine-offline", "1");
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

async function apiNetworkFirst(req) {
  const cache = await caches.open(API_CACHE);
  const { network, raced } = fetchWithTimeout(req, (res) => {
    if (res.ok) void cache.put(req, res);
    // Abgemeldet: gespeicherte Daten dieses Geräts verwerfen
    else if (res.status === 401) void caches.delete(API_CACHE);
  });
  const res = await raced;
  if (res) return res;
  const hit = await cache.match(req);
  if (hit) return markOffline(hit);
  return network;
}

async function shellNetworkFirst(req) {
  const cache = await caches.open(CACHE);
  const { network, raced } = fetchWithTimeout(req, (res) => {
    if (res.ok && isHtml(res)) void cache.put("/", res);
  });
  const res = await raced;
  if (res) return res;
  return (await cache.match("/")) || network;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (API_NO_CACHE.some((r) => r.test(url.pathname)) || req.headers.get("upgrade")) return;
    event.respondWith(apiNetworkFirst(req));
    return;
  }

  // Gebaute Dateien haben einen Hash im Namen: aus dem Cache, sonst laden und merken.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      // ignoreVary: Vorab gespeicherte Dateien kamen ohne Origin-Header, Modul-Anfragen haben einen
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // Eine Datei der alten Version gibt es nach einem Deployment nicht mehr.
            // Statt der App-Seite (Fallback) ehrlich 404 liefern und nichts merken.
            if (isHtml(res)) return new Response(null, { status: 404 });
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Seiten: Netz zuerst, offline die zuletzt gespeicherte App-Hülle.
  if (req.mode === "navigate") event.respondWith(shellNetworkFirst(req));
});

/**
 * Alle Dateien der aktuellen Version vorab speichern, damit auch noch nie
 * geöffnete Seiten offline gehen, und Dateien alter Versionen entfernen.
 * Nur auf Anstoß einer Seite, die selbst die aktuelle Version ist.
 */
async function precache(version) {
  const res = await fetch("/version.json", { cache: "no-store" });
  if (!res.ok || isHtml(res)) return;
  const info = await res.json();
  if (info.version !== version || !Array.isArray(info.assets)) return;
  const cache = await caches.open(CACHE);
  const wanted = new Set(info.assets.map((a) => new URL(`/${a}`, location.origin).href));
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.startsWith("/assets/") && !wanted.has(req.url)) await cache.delete(req);
  }
  const missing = [];
  for (const href of wanted) if (!(await cache.match(href, { ignoreVary: true }))) missing.push(href);
  // Parallel laden, fehlende (z. B. offline) beim nächsten Mal
  await Promise.all(
    missing.map((href) =>
      fetch(href)
        .then((file) => (file.ok && !isHtml(file) ? cache.put(href, file) : undefined))
        .catch(() => undefined),
    ),
  );
  try {
    const shell = await fetch("/", { cache: "no-store" });
    if (shell.ok && isHtml(shell)) await cache.put("/", shell);
  } catch {
    // egal
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "precache" && typeof data.version === "string") event.waitUntil(precache(data.version).catch(() => {}));
  if (data.type === "clear-data") event.waitUntil(caches.delete(API_CACHE));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Kabine", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Kabine";
  // Zahl am App-Icon: ungelesene Erwähnungen und offene Anfragen (vom Server mitgeschickt)
  if (typeof data.badge === "number" && self.navigator.setAppBadge) {
    const badge = data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge();
    event.waitUntil(badge.catch(() => {}));
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
      lang: "de",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(location.origin) && "focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    fetch("/api/push/config", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((cfg) => {
        if (!cfg.publicKey) return;
        const pad = "=".repeat((4 - (cfg.publicKey.length % 4)) % 4);
        const raw = atob((cfg.publicKey + pad).replace(/-/g, "+").replace(/_/g, "/"));
        const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      })
      .then((sub) =>
        sub
          ? fetch("/api/push/subscriptions", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(sub.toJSON()),
            })
          : undefined,
      )
      .catch(() => {}),
  );
});
