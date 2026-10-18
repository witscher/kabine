// Language switch (profile and sign-in page): saves the choice on the account if signed in,
// remembers it on the device and reloads the app in the new language.
import { t } from "@lingui/core/macro";
import { useId } from "preact/hooks";
import { LOCALE_NAMES, LOCALES, type Locale, isLocale } from "../shared/i18n";
import { api } from "./api";
import { currentLocale, switchLocale } from "./i18n";

export function LanguageSwitch() {
  const id = useId();
  const current = currentLocale();
  const change = async (value: string) => {
    if (!isLocale(value) || value === current) return;
    const locale: Locale = value;
    try {
      await api.put("/me/locale", { locale });
    } catch {
      // offline or signed out: the choice still applies on this device
    }
    switchLocale(locale);
  };
  return (
    <div class="field">
      <label class="field-label" for={id}>
        {t`Language`}
      </label>
      <select id={id} class="select" value={current} onChange={(e) => void change((e.target as HTMLSelectElement).value)}>
        {LOCALES.map((l) => (
          <option value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
