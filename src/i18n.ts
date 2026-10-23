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

/** The language of a ?lang= link opened in this visit: it is a choice like the one in the profile. */
let linkLocale: Locale | null = null;

/**
 * A link with ?lang=de or ?lang=en (the demo links on the website and in the README) sets the language on this
 * device. The parameter is removed from the address, so a reload does not apply it again.
 */
function fromLink(): Locale | null {
  try {
    const url = new URL(location.href);
    const v = url.searchParams.get("lang");
    if (!isLocale(v)) return null;
    url.searchParams.delete("lang");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    localStorage.setItem(STORAGE_KEY, v);
    linkLocale = v;
    return v;
  } catch {
    return null;
  }
}

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
  return fromLink() ?? stored() ?? matchLocale(typeof navigator === "undefined" ? [] : navigator.languages) ?? clubDefault ?? "en";
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

/**
 * The account's language after login wins over the device, if it differs. Not after a ?lang= link: that is the
 * newer choice, so it goes to the account instead (saveChoice), and there is nothing to reload into. Before, the
 * account's language reloaded the app, the link in the address set its own again, and so on without end.
 */
export function adoptAccountLocale(locale: Locale | null, saveChoice: (locale: Locale) => void): void {
  if (linkLocale) {
    if (locale !== linkLocale) saveChoice(linkLocale);
    return;
  }
  if (!locale || locale === stored()) return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    return;
  }
  if (locale !== currentLocale()) location.reload();
}
