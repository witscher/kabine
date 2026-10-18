import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  globalTeardown: "./e2e/teardown.ts",
  use: {
    baseURL: "http://localhost:4174",
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-reset.mjs && KABINE_E2E=1 npx vite build && KABINE_E2E=1 npx vite preview",
    url: "http://localhost:4174/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
