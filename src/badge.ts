// Zahl am App-Icon (Badging API): ungelesene @-Erwähnungen und offene
// Aushilfe-Anfragen. Der Service Worker setzt sie bei jeder Push, die App
// rechnet sie beim Öffnen und nach dem Lesen neu. Auf iOS nur in der
// installierten App mit erlaubten Mitteilungen, sonst passiert nichts.
import { api } from "./api";

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

let timer: number | undefined;

export function setBadge(count: number) {
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // nicht unterstützt
  }
}

/** Zahl neu abfragen (leicht verzögert, damit mehrere Anlässe nur eine Anfrage auslösen). */
export function refreshBadge(delayMs = 400) {
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    try {
      setBadge((await api.get<{ count: number }>("/badge")).count);
    } catch {
      // offline oder abgemeldet: Zahl so lassen
    }
  }, delayMs);
}
