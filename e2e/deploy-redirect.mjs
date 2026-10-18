// Verweis des Vite-Plugins auf den zuletzt gebauten Worker (für wrangler deploy).
export const DEPLOY_REDIRECT = ".wrangler/deploy/config.json";
export const DEPLOY_REDIRECT_BACKUP = ".wrangler/e2e-state/deploy-redirect.json";

/** Zeigt der Verweis auf den E2E-Build? */
export function isE2eRedirect(content) {
  return /dist-e2e\//.test(content);
}
