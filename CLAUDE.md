@AGENTS.md

# Maintainer notes

These apply to work in the maintainer's own checkout.

Read `docs/dev/roadmap.md` before every task: decisions, milestones, open points. Changes from the original club app that still need porting are listed in `docs/dev/upstream-tasks.md`. Decisions not covered there go into `docs/dev/decisions.md` with a reason.

## Cloudflare

Test deployments and the public demo use the maintainer's account with resource names containing `kabine` and domains under `yope.de` or `kabine.dev` only. Never touch other resources in that account (other Workers, databases, KV namespaces, queues, zones and domains).

| Purpose | Command |
| --- | --- |
| Deploy a club installation (build, remote migrations, upload) | `npm run deploy` |
| Public demo on handball.kabine.dev (environment `demo`) | `npm run deploy:demo`, reset now: `DEMO_RESET_TOKEN=… npm run demo:reset` |
| Project website kabine.dev | `npm run site:deploy` (needs `site/legal.json`) |
| Maintenance mode | `npm run maintenance:on` / `maintenance:off` / `maintenance:status` |

## Legal pages (kabine.dev, demo, club installations)

- kabine.dev and handball.kabine.dev: operator is David Heidt, c/o Online-Impressum 12385, Europaring 90, 53757 Sankt Augustin, Germany. Use exactly this name and address; never a private home address, not in code, config, commits, screenshots or docs. The values live in site/legal.json, which stays gitignored; site/legal.example.json contains placeholders only.
- Legal notice per § 5 DDG and § 18 (1) MStV: name, address, email, and a second fast contact channel. Include the statement that Kabine is a private, non-commercial open-source project, not an official Cloudflare product, and not affiliated with, sponsored or endorsed by Cloudflare, Inc. No VAT ID, trade register, dispute resolution or disclaimer boilerplate.
- The privacy policy for kabine.dev and the demo describes exactly what really happens: hosting on Cloudflare (processor, EU-U.S. Data Privacy Framework), Cloudflare's injected bot protection script and cookies (__cf_bm, cf_clearance if a challenge is shown), and for the demo everything it stores in the browser (cookies, localStorage, IndexedDB, service worker cache, push subscriptions) and on the server (D1, KV, Durable Objects, Queues, Workers Logs). For each: purpose, legal basis (Art. 6(1)(f) GDPR, § 25(2) no. 2 TDDDG for strictly necessary device access), storage period, and when the demo is reset. Also: rights under Art. 15–21 GDPR, the right to complain to a supervisory authority, and the right to object (Art. 21) as a separate, highlighted paragraph. German is authoritative; English is a translation.
- Every page of kabine.dev and of the demo links to both pages in one click. Use plain links in the HTML, not rendered only by JavaScript.
- Club installations: legal notice and privacy links are configured per installation (e.g. by the club admin or an environment variable). The app shows them on every screen, including the login and invitation pages, and ships with no default operator data. If they are not configured, the admin area shows a clear warning. The install and operation docs tell clubs they are the controller and must provide both pages. Do not hardcode any links to kabine.dev or davebuilds.net as a club's legal pages.
- No analytics, tracking, ads or third-party resources (fonts, scripts, images, iframes) on kabine.dev, the demo or in the app. Serve everything from the own domain. If a third-party resource seems unavoidable, stop and ask.
- Never log personal data (form contents, chat messages, names, email addresses, phone numbers, codes) and never put it in URLs or query strings, because request logs record them.
- When a change adds, removes or changes any storage, logging or data flow, update the matching privacy text in the same change, or tell the user explicitly what is still missing.

## Releases

Development happens only in this checkout. With every release (tag `vX.Y.Z` pushed to GitHub), deploy the demo from here in the same step, from the tagged commit: `npm run deploy:demo`, then reset it with the token from `.secrets.demo.json` (`DEMO_RESET_TOKEN=… npm run demo:reset`), and check https://handball.kabine.dev once. The workflow "Deploy demo" on GitHub has no Cloudflare secrets on purpose and deploys nothing, even when it shows green.
