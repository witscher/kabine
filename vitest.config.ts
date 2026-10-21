import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";
import { linguiMacro } from "./tools/lingui-macro";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      linguiMacro(),
      lingui(),
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // Tests never reach Cloudflare (Workers AI of the AI list import is faked in its tests)
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_SECRET: "test-app-secret-0123456789abcdef",
            ADMIN_BOOTSTRAP_TOKEN: "test-bootstrap-token",
            RP_ID: "localhost",
            ORIGIN: "http://localhost:5173",
            FEEDBACK_TO: "feedback@example.org",
            // Test keys only, generated for the test suite
            VAPID_PUBLIC_KEY: "BK5YYnN9_KPgF2ZGtWl04J69XA5z_ZLOp5nivWDJMmkvSmhYz7QLJxxH7QtvJM8wRFANS7xeSOcpMuw_mXjapdc",
            VAPID_PRIVATE_KEY: "P3WsI3wYU8bDW_g4pDCf6opTUU5aGEAxVPfYY3I1Kfg",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts", "modules/*/test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
