// Starts the public demo over right now (otherwise it happens every night at 3:00 Berlin time).
// Usage: DEMO_RESET_TOKEN=... node scripts/demo-reset.mjs [https://handball.kabine.dev]
// The token is the Worker secret DEMO_RESET_TOKEN of the demo environment.
const base = process.argv[2] ?? "https://handball.kabine.dev";
const token = process.env.DEMO_RESET_TOKEN;
if (!token) {
  console.error("Set DEMO_RESET_TOKEN (the secret of the demo Worker).");
  process.exit(1);
}
const res = await fetch(new URL("/api/demo/reset", base), { method: "POST", headers: { authorization: `Bearer ${token}` } });
console.log(res.ok ? "Demo reset." : `Reset failed: ${res.status} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
