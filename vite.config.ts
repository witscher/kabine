import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import { linguiMacro } from "./tools/lingui-macro";

// Identifier of this build. The app compares it with /version.json and so notices
// dass eine neue Version deployt wurde (siehe src/update.tsx).
const appVersion = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: "kabine-version-file",
    applyToEnvironment: (env) => env.name === "client",
    generateBundle(_options, bundle) {
      // All files of the app, so the service worker can load them in advance for offline use
      const assets = Object.keys(bundle)
        .filter((f) => /^assets\/.+\.(js|css|woff2)$/.test(f))
        .sort();
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: appVersion, assets }) });
    },
  };
}

// For the end-to-end tests and screenshots (KABINE_E2E=1) the app runs against its own
// local data with invented test data and fixed test secrets.
// The build goes to dist-e2e, so it is never deployed.
const e2e = process.env.KABINE_E2E === "1";

// Cloudflare Email Sending locally (Miniflare keeps the mails), so sign-in by e-mail code can be tried and tested.
// Not in wrangler.jsonc: for clubs it needs the Workers Paid plan (docs/install.md, E-mail).
const localMail = { send_email: [{ name: "EMAIL" }] };

export default defineConfig({
  // No splash animation in the E2E tests: every test starts with empty storage and would always see it
  define: { __APP_VERSION__: JSON.stringify(appVersion), __SPLASH__: JSON.stringify(!e2e) },
  plugins: [
    versionFile(),
    linguiMacro(),
    lingui(),
    preact({ prerender: { enabled: false } }),
    cloudflare(
      e2e
        ? {
            // The offline test starts a second server with a copy (KABINE_E2E_STATE)
            persistState: { path: process.env.KABINE_E2E_STATE ?? ".wrangler/e2e-state" },
            config: {
              ...localMail,
              // Only the values set here, not the secrets from .dev.vars
              secrets: { required: [] },
              vars: {
                APP_SECRET: "e2e-app-secret-0123456789abcdef",
                ADMIN_BOOTSTRAP_TOKEN: "e2e-einrichtung-0123456789",
                // E-mail sending is set up, so sign-in by e-mail code is offered (Miniflare keeps the mails locally)
                MAIL_FROM: "app@example.org",
              },
            },
          }
        : { config: localMail },
    ),
  ],
  build: e2e ? { outDir: "dist-e2e" } : {},
  server: { port: 5173, strictPort: true },
  preview: { port: e2e ? 4174 : 4173, strictPort: true },
});
