// Pointer of the Vite plugin to the last built Worker (for wrangler deploy).
export const DEPLOY_REDIRECT = ".wrangler/deploy/config.json";
export const DEPLOY_REDIRECT_BACKUP = ".wrangler/e2e-state/deploy-redirect.json";

/** Does the pointer point to the E2E build? */
export function isE2eRedirect(content) {
  return /dist-e2e\//.test(content);
}
