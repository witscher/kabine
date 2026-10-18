// Detect new versions. After a deployment the lazily loaded files of the old
// version are gone, an open app would otherwise hang on the next page change.
// The installed app on the home screen often runs for days without being
// reloaded.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { lazy } from "preact-iso";
import { Icon } from "./icons";

const CURRENT = __APP_VERSION__;
const CHECK_EVERY_MS = 10 * 60 * 1000;
/** After this long in the background, the app reloads on return without asking. */
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

/** Reload, automatically at most once per new version (against loops). */
export function reloadApp(auto = false) {
  if (auto) {
    try {
      if (sessionStorage.getItem(RELOAD_GUARD) === CURRENT) return false;
      sessionStorage.setItem(RELOAD_GUARD, CURRENT);
    } catch {
      // Without storage better not automatically
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
    // Whoever brings the app back from the background gets the new version without asking
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
          <div class="title">{available ? t`The app has been updated` : t`The page could not be loaded`}</div>
          <p>{available ? t`Please reload once, then you can continue.` : t`Check your internet connection and reload the app.`}</p>
          <button type="button" class="btn btn-primary" onClick={() => reloadApp()}>
            <Trans>Reload</Trans>
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Like lazy() from preact-iso, but when the page's file no longer exists
 * (new version deployed), the app reloads or asks to.
 */
export function lazyPage<P>(load: () => Promise<ComponentType<P>>) {
  return lazy(() =>
    load().catch(async (err: unknown) => {
      console.warn("Page could not be loaded", err);
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
      <span>
        <Trans>There is a new version of the app.</Trans>
      </span>
      <button type="button" class="btn btn-sm btn-accent" onClick={() => reloadApp()}>
        <Trans>Load now</Trans>
      </button>
    </div>
  );
}
