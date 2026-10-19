// A whole club from zero (npm run journey): a fresh installation without any data, set up through the app
// like a real club, in every role. Finds what the e2e tests with their prepared data cannot.
// Against a real installation: KABINE_JOURNEY_URL=https://… KABINE_JOURNEY_PASSWORD=… npm run journey
import { defineConfig, devices } from "@playwright/test";

const remote = process.env.KABINE_JOURNEY_URL;

export default defineConfig({
  testDir: "journey",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [["list"]],
  globalTeardown: remote ? undefined : "./e2e/teardown.ts",
  use: {
    baseURL: remote ?? "http://localhost:4174",
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  webServer: remote
    ? undefined
    : {
        command: "node scripts/e2e-reset.mjs --empty && KABINE_E2E=1 npx vite build && KABINE_E2E=1 npx vite preview",
        url: "http://localhost:4174/api/health",
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
