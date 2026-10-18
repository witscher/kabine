import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import { linguiMacro } from "./tools/lingui-macro";

// Kennung dieses Builds. Die App vergleicht sie mit /version.json und merkt so,
// dass eine neue Version deployt wurde (siehe src/update.tsx).
const appVersion = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: "kabine-version-file",
    applyToEnvironment: (env) => env.name === "client",
    generateBundle(_options, bundle) {
      // Alle Dateien der App, damit der Service Worker sie für offline vorab lädt
      const assets = Object.keys(bundle)
        .filter((f) => /^assets\/.+\.(js|css|woff2)$/.test(f))
        .sort();
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: appVersion, assets }) });
    },
  };
}

// Für die Ende-zu-Ende-Tests (KABINE_E2E=1) läuft die App gegen einen eigenen
// lokalen Datenbestand mit erfundenen Testdaten und festen Test-Secrets.
// Der Build landet getrennt in dist-e2e, damit er nie deployt wird.
const e2e = process.env.KABINE_E2E === "1";

export default defineConfig({
  // Startanimation in den E2E-Tests aus: jeder Test startet mit leerem Speicher und sähe sie sonst immer
  define: { __APP_VERSION__: JSON.stringify(appVersion), __SPLASH__: JSON.stringify(!e2e) },
  plugins: [
    versionFile(),
    linguiMacro(),
    lingui(),
    preact({ prerender: { enabled: false } }),
    cloudflare(
      e2e
        ? {
            // Der Offline-Test startet einen zweiten Server mit einer Kopie (KABINE_E2E_STATE)
            persistState: { path: process.env.KABINE_E2E_STATE ?? ".wrangler/e2e-state" },
            config: {
              // Nur die hier gesetzten Werte, nicht die Secrets aus .dev.vars
              secrets: { required: [] },
              vars: {
                APP_SECRET: "e2e-app-secret-0123456789abcdef",
                ADMIN_BOOTSTRAP_TOKEN: "e2e-einrichtung-0123456789",
              },
            },
          }
        : {},
    ),
  ],
  build: e2e ? { outDir: "dist-e2e" } : {},
  server: { port: 5173, strictPort: true },
  preview: { port: e2e ? 4174 : 4173, strictPort: true },
});
