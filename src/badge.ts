// Number on the app icon (Badging API): unread @-mentions and open requests
// to help out. The service worker sets it on every push, the app recalculates
// it when opened and after reading. On iOS only in the installed app with
// notifications allowed, otherwise nothing happens.
import { api } from "./api";

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

let timer: number | undefined;

export function setBadge(count: number) {
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // not supported
  }
}

/** Fetch the number again (slightly delayed, so several triggers cause only one request). */
export function refreshBadge(delayMs = 400) {
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    try {
      setBadge((await api.get<{ count: number }>("/badge")).count);
    } catch {
      // offline or signed out: keep the number
    }
  }, delayMs);
}
