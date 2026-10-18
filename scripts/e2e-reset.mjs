// Frischer lokaler Datenbestand für die Ende-zu-Ende-Tests (erfundene Testdaten).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DEPLOY_REDIRECT, DEPLOY_REDIRECT_BACKUP, isE2eRedirect } from "../e2e/deploy-redirect.mjs";

rmSync(".wrangler/e2e-state", { recursive: true, force: true });
rmSync(".wrangler/e2e-state-offline", { recursive: true, force: true });
mkdirSync(".wrangler/e2e-state", { recursive: true });

// Der Vite-Build merkt sich in .wrangler/deploy/config.json, welcher Build
// deployt wird. Der E2E-Build (mit Test-Secrets) überschreibt diesen Verweis,
// deshalb wird er hier gesichert und von e2e/teardown.ts zurückgeschrieben.
const current = existsSync(DEPLOY_REDIRECT) ? readFileSync(DEPLOY_REDIRECT, "utf8") : null;
const previous = current && !isE2eRedirect(current) ? current : null;
writeFileSync(DEPLOY_REDIRECT_BACKUP, JSON.stringify({ previous }));

const run = (cmd) => execSync(cmd, { stdio: "pipe", env: { ...process.env, CI: "1" } });
run("npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e-state");
run("npx wrangler d1 execute DB --local --persist-to .wrangler/e2e-state --file e2e/fixtures.sql");
console.log("E2E-Datenbestand bereit.");
