// Service worker of Kabine: App offline nutzbar, Web Push.
//
// Offline: Die App-Dateien liegen vorab im Cache (Liste aus /version.json).
// API data always comes from the network first; the service worker keeps the
// last answer. Without network it serves that one with the header
// x-kabine-offline, and the app shows "You are offline".
const CACHE = "kabine-shell-v1";
const API_CACHE = "kabine-api";
const SHELL = ["/", "/icons/icon-192.png"];
/** How long to wait for the network before the stored answer is used. */
const NETWORK_TIMEOUT_MS = 6000;

// Never from the cache: sign-in, invitations, export and the connection check
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

/** Network with a time limit. The answer is still stored after the limit. */
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
    // Signed out: discard the data stored on this device
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

  // Built files have a hash in their name: from the cache, else load and keep.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      // ignoreVary: Vorab gespeicherte Dateien kamen ohne Origin-Header, Modul-Anfragen haben einen
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // A file of the old version no longer exists after a deployment.
            // Answer an honest 404 instead of the app page (fallback), and keep nothing.
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

  // Pages: network first, offline the last stored app shell.
  if (req.mode === "navigate") event.respondWith(shellNetworkFirst(req));
});

/**
 * Stores all files of the current version in advance, so that pages never
 * opened before work offline too, and removes files of old versions.
 * Only when asked by a page that is itself the current version.
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
  // Load in parallel; missing ones (e.g. offline) next time
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
  // Number on the app icon: unread mentions and open requests (sent along by the server)
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
