// Language of the app: chosen by the person (stored on the device and on the account), else the
// browser language if the app has it, else the club default. Changing it reloads the app, so texts computed once
// (outside components) are always in the right language.
import { i18n } from "@lingui/core";
import { type Locale, isLocale, matchLocale } from "../shared/i18n";

const STORAGE_KEY = "kabine-locale";

const catalogs: Record<Locale, () => Promise<{ messages: Record<string, unknown> }>> = {
  en: () => import("../locales/en.po"),
  de: () => import("../locales/de.po"),
};

function stored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Language for the start of the app: the person's choice, else the browser language if the app has it,
 * else the club default (cached club profile).
 */
export function initialLocale(clubDefault: Locale | null): Locale {
  return stored() ?? matchLocale(typeof navigator === "undefined" ? [] : navigator.languages) ?? clubDefault ?? "en";
}

export async function activateLocale(locale: Locale): Promise<void> {
  const { messages } = await catalogs[locale]();
  i18n.loadAndActivate({ locale, messages: messages as never });
  document.documentElement.lang = locale;
}

export function currentLocale(): Locale {
  return isLocale(i18n.locale) ? i18n.locale : "en";
}

/** Remembers the choice on this device and reloads (the account setting is saved by the caller). */
export function switchLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // private mode: only for this visit
  }
  location.reload();
}

/** The account's language after login wins over the device, if it differs. */
export function adoptAccountLocale(locale: Locale | null): void {
  if (!locale || locale === stored()) return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    return;
  }
  if (locale !== currentLocale()) location.reload();
}
