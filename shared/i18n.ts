// Languages of the app. English is the source language in code; adding a language means a new
// catalog in locales/ and an entry here.

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

/** Names of the languages in their own language, for the language switch. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** First supported language of an Accept-Language header or navigator.languages. */
export function matchLocale(preferred: readonly string[] | string | null | undefined): Locale | null {
  const list = typeof preferred === "string" ? preferred.split(",").map((p) => p.split(";")[0]!.trim()) : (preferred ?? []);
  for (const tag of list) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}
