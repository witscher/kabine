// Stellt nach dem Lauf den Deploy-Verweis von vor dem E2E-Build wieder her,
// damit `wrangler deploy` nie den E2E-Build mit seinen Test-Secrets erwischt.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DEPLOY_REDIRECT, DEPLOY_REDIRECT_BACKUP, isE2eRedirect } from "./deploy-redirect.mjs";

export default function teardown(): void {
  if (!existsSync(DEPLOY_REDIRECT_BACKUP)) return;
  const { previous } = JSON.parse(readFileSync(DEPLOY_REDIRECT_BACKUP, "utf8")) as { previous: string | null };
  if (previous) writeFileSync(DEPLOY_REDIRECT, previous);
  else if (existsSync(DEPLOY_REDIRECT) && isE2eRedirect(readFileSync(DEPLOY_REDIRECT, "utf8"))) rmSync(DEPLOY_REDIRECT);
  rmSync(DEPLOY_REDIRECT_BACKUP);
}
