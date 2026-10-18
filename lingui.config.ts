import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";

// English is the source language in code, German the first translation. Catalogs are edited by people
// in locales/*.po; machine translations carry the translator comment "ai" (see docs/dev/translation.md).
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de"],
  fallbackLocales: { default: "en" },
  catalogs: [{ path: "<rootDir>/locales/{locale}", include: ["<rootDir>/src", "<rootDir>/worker", "<rootDir>/shared", "<rootDir>/modules"], exclude: ["**/node_modules/**", "**/worker-configuration.d.ts"] }],
  format: formatter({ lineNumbers: false }),
  orderBy: "messageId",
});
