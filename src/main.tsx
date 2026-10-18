import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./styles.css";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render } from "preact";
import { App } from "./app";
import { cachedClub, loadClub } from "./club";
import { activateLocale, initialLocale } from "./i18n";
import { startOfflineWatch } from "./offline";
import { startUpdateChecks } from "./update";
import { applyViewFlags } from "./view-as";

applyViewFlags();
void loadClub();
await activateLocale(initialLocale(cachedClub()?.defaultLocale ?? null));

render(
  <I18nProvider i18n={i18n}>
    <App />
  </I18nProvider>,
  document.getElementById("app")!,
);
startUpdateChecks();
startOfflineWatch();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service Worker", err));
    // Alle Seiten der App für offline vorab speichern
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "precache", version: __APP_VERSION__ }));
  };
  // The language catalog is loaded first (await above), so the page may already be loaded
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}
