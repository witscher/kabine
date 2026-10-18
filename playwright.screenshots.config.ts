// README screenshots of the invented demo club, one run per language (npm run screenshots).
import { defineConfig, devices } from "@playwright/test";

const locale = process.env.KABINE_SHOTS_LOCALE === "en" ? "en" : "de";

export default defineConfig({
  testDir: "screenshots",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  globalTeardown: "./e2e/teardown.ts",
  use: {
    baseURL: "http://localhost:4174",
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: locale === "en" ? "en-GB" : "de-DE",
    timezoneId: "Europe/Berlin",
  },
  webServer: {
    command:
      "node scripts/screenshots-reset.mjs && KABINE_E2E=1 npx vite build && KABINE_E2E=1 KABINE_E2E_STATE=.wrangler/shots-state npx vite preview",
    url: "http://localhost:4174/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
