import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./styles.css";
import { render } from "preact";
import { App } from "./app";
import { loadClub } from "./club";
import { startOfflineWatch } from "./offline";
import { startUpdateChecks } from "./update";
import { applyViewFlags } from "./view-as";

applyViewFlags();
void loadClub();

render(<App />, document.getElementById("app")!);
startUpdateChecks();
startOfflineWatch();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service Worker", err));
    // Alle Seiten der App für offline vorab speichern
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "precache", version: __APP_VERSION__ }));
  });
}
