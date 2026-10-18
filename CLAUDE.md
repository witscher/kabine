@AGENTS.md

# Maintainer notes

These apply to work in the maintainer's own checkout.

Read `docs/plan.md` before every task: decisions, milestones, open points. Decisions not covered there go into `docs/decisions.md` with a reason.

## Cloudflare

Test deployments and the public demo use the maintainer's account with resource names containing `kabine` and domains under `yope.de` or `kabine.dev` only. Never touch other resources in that account (other Workers, databases, KV namespaces, queues, zones and domains).

| Purpose | Command |
| --- | --- |
| Deploy a club installation (build, remote migrations, upload) | `npm run deploy` |
| Public demo on handball.kabine.dev (environment `demo`) | `npm run deploy:demo`, reset now: `DEMO_RESET_TOKEN=… npm run demo:reset` |
| Project website kabine.dev | `npm run site:deploy` (needs `site/legal.json`) |
| Maintenance mode | `npm run maintenance:on` / `maintenance:off` / `maintenance:status` |
