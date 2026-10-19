// Addresses the app can run at. Passkeys are bound to the host name, so the setup page warns on
// Cloudflare's test address before the first admin creates one there (src/pages/join.tsx).

/** Cloudflare's own test address of a Worker (`<worker>.<account>.workers.dev`). */
export function isWorkersDevHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "workers.dev" || h.endsWith(".workers.dev");
}
