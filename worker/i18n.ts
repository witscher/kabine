// Language on the server. Every request runs in the language of the person (account setting, else
// the app's language sent by the client, else the club default); messages to others are rendered
// in each recipient's language with withLocale(). Lingui macros in worker code (t`…`, plural())
// call the i18n object below instead of the global one (lingui.worker.config.ts).
import { AsyncLocalStorage } from "node:async_hooks";
import { type I18n, setupI18n } from "@lingui/core";
import { messages as de } from "../locales/de.po";
import { messages as en } from "../locales/en.po";
import { type Locale, isLocale } from "../shared/i18n";

const instances: Record<Locale, I18n> = {
  en: setupI18n({ locale: "en", messages: { en } }),
  de: setupI18n({ locale: "de", messages: { de } }),
};

const store = new AsyncLocalStorage<Locale>();
// One installation serves one club: its default language applies outside a request (cron, queue)
let clubDefault: Locale = "en";

export function setClubDefaultLocale(locale: Locale): void {
  clubDefault = locale;
}

export function currentLocale(): Locale {
  return store.getStore() ?? clubDefault;
}

/** Runs fn in the given language (a request, or a message to one recipient). */
export function withLocale<T>(locale: Locale | string | null | undefined, fn: () => T): T {
  return store.run(isLocale(locale) ? locale : clubDefault, fn);
}

/** Target of the Lingui macros in worker code: translates in the current language. */
export const i18n = {
  _: ((...args: Parameters<I18n["_"]>) => instances[currentLocale()]._(...args)) as I18n["_"],
  get locale() {
    return currentLocale();
  },
};
