# Installing Kabine

Kabine runs in your club's own Cloudflare account. Nobody else hosts your data, and the free plan is enough for a typical club with a few hundred members. This guide takes about 30 minutes.

## What you need

- A **Cloudflare account** for the club (free). Create it with a club e-mail address, not a private one, so it survives a change of board.
- A **GitHub account**. The deploy button puts a copy of Kabine there, and updates arrive as pull requests in that copy.
- Ideally a **domain in Cloudflare**, for example `app.your-club.org`. Passkeys are bound to the address of the app, so choose the final address before you invite people. A `*.workers.dev` address works for trying Kabine out.

## 1. Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/witscher/kabine)

The button creates a copy of the repository in your GitHub account and the Cloudflare resources the app needs: the Worker, a D1 database, a KV namespace, a queue for push notifications and two Durable Objects (team chat, live helper plan).

It asks for one secret, `ADMIN_BOOTSTRAP_TOKEN`. Choose a password of at least 16 characters and keep it until the first admin has signed in. Everything else the app creates itself on first start: the key for signed links and the key pair for push notifications. They are stored in the database and never leave it with the data export. If you prefer to manage them yourself, set `APP_SECRET`, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as secrets of the Worker (`npm run secrets:generate` creates a set).

The copy does not include the update workflow; step 6 adds it.

In the Worker's settings under *Build*, check that the deploy command is `npm run deploy`. It applies the database migrations before uploading the new version. With a plain `npx wrangler deploy` the database stays on the old schema.

**Data in Europe:** the button does not let you choose where the database is stored. If your privacy policy promises the EU, create the database by hand first (`npx wrangler d1 create kabine --jurisdiction eu`, see "Installing by hand") and use that database for the Worker. The team chat already lives in the EU jurisdiction.

## 2. Add your domain

Do this before anyone signs in. In the Cloudflare dashboard open *Workers & Pages → kabine → Settings → Domains & Routes → Add → Custom domain* and enter a subdomain of the club, for example `app.your-club.org`. Cloudflare creates the DNS record and the certificate.

The club's domain has to be managed in the same Cloudflare account (its DNS at Cloudflare). If it is managed elsewhere, ask whoever runs the club's domain to move its DNS to Cloudflare (free), or register a new domain for the app in Cloudflare.

From now on, use only this address. Passkeys created under the `workers.dev` address do not work on the club domain; the setup page warns when it is opened there.

## 3. First admin

Open `https://app.your-club.org`. A new installation goes straight to its setup: enter the setup password you chose when deploying (`ADMIN_BOOTSTRAP_TOKEN`), then your name and e-mail address, and create a passkey (Face ID, fingerprint or the screen lock of your device). The password works once. (The direct link `https://app.your-club.org/einrichtung#<password>` does the same without typing.)

The build log of the deploy ends with these steps as well.

The setup wizard opens right after:

1. Language and region: the club's language, country and state (for school holidays and public holidays), time zone.
2. Club: name, short name, abbreviation, colours and logo.
3. Sport and season: brings age groups, playing times and helper duties of the sport.
4. Functions: helper duties, youth referees, carpools, handball4all, SMS.
5. E-mail: Cloudflare Email Sending or the club's SMTP server (see below).
6. First teams: by hand, or imported from the club's lists. Excel files (.xlsx, also several sheets), CSV or a pasted table; only first name, last name, birth year, team and role are read, in the browser. The same person in several lists becomes one; birth years that disagree and similar names come up as questions. Teams, coaches and players are created only after everything is checked and corrected. With the beta module *AI list import* switched on in step 4, buttons let an AI model in the club's Cloudflare account read unusual column headers and unclear names (see `modules/ai-import/README.md`).
7. First people: coaches and further admins, each with a personal link.
8. Privacy: link to the club's privacy policy and legal notice, contact for questions.

Everything can be changed later under *Administration*. "Continue later" leaves the wizard; it reopens under *Administration → Setup wizard*.

## 4. E-mail (optional, recommended)

Kabine sends e-mails for sign-in codes on new devices, access links and helper plan reminders. Without e-mail, people sign in with passkeys and the links coaches hand out; the sign-in page only offers "Code by e-mail" once sending is set up.

- **Cloudflare Email Sending:** the domain must be set up for sending in Cloudflare (*Email → Email Sending*). Enter the sender address in the wizard, for example `no-reply@your-club.org`.
- **SMTP:** the club's mail server, with TLS on port 465 or STARTTLS on port 587. The password is stored encrypted.

The wizard sends a test mail.

## 5. Invite people

Coaches are assigned by an admin under *Administration → Teams → Coaches* and get a personal link. Coaches then add their players (one by one or as a list from a spreadsheet), create training plans and share the invitation links for players and parents in the team's group chat. The invitations tab shows who cannot be reached yet.

Push notifications work on Android and desktop browsers right away. On an iPhone, the app must be added to the home screen first (Safari → Share → *Add to Home Screen*); the app explains this to everyone.

## 6. Updates

New Kabine versions arrive as a pull request in your copy on GitHub; you decide when to install them. The deploy button does not copy the update workflow (GitHub does not let it create workflow files), so add it once, right after the installation:

1. In your copy on GitHub: *Add file → Create new file*, name it `.github/workflows/update.yml`, paste the content of [the update workflow](https://github.com/witscher/kabine/blob/main/.github/workflows/update.yml) and commit it.
2. *Settings → Actions → General*: under *Workflow permissions* tick **Allow GitHub Actions to create and approve pull requests** and save.
3. *Actions → Kabine updates → Run workflow*: it looks for a release right away. If your copy is already on the latest release, it does nothing.

From then on the workflow looks for a new release every Monday and opens a pull request "Update Kabine to vX.Y.Z". It says whether the release changes the database or the Cloudflare configuration (`wrangler.jsonc`). Merging it deploys the new version; if the release changes the database, the app shows "being updated" for about a minute and the deploy notes a restore point first (`docs/operation.md`, Updates). If GitHub still does not let the workflow open the pull request, it opens an issue with a link to open it yourself.

A copy from before October 2026 needs a few steps once: `docs/operation.md`, Updating an older copy.

## Installing by hand

Without the button, with Node.js 22 or newer and a Cloudflare API token:

```sh
git clone https://github.com/witscher/kabine && cd kabine
npm ci
npx wrangler d1 create kabine --jurisdiction eu   # keeps the data in the EU; put the database_id into wrangler.jsonc
npx wrangler kv namespace create KV    # put the id into wrangler.jsonc
npx wrangler queues create kabine-push
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN
npm run deploy
```

Then continue with step 2.

## Costs and limits

The free plan of Cloudflare Workers covers a club with several hundred members: requests, D1 reads and writes, KV, Durable Objects and queues all have daily allowances. Kabine is built to stay well below them (see `docs/dev/design.md`, Database read load). Check the current limits on Cloudflare's pricing pages. If a limit is reached, the app answers with errors until the next day; the paid plan (5 USD per month at the time of writing) removes that risk.

SMS cost money per message with the provider (seven.io). The module is off by default.
