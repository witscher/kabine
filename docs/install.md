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

In the Worker's settings under *Build*, check that the deploy command is `npm run deploy`. It applies the database migrations before uploading the new version. With a plain `npx wrangler deploy` the database stays on the old schema.

**Data in Europe:** the button does not let you choose where the database is stored. If your privacy policy promises the EU, create the database by hand first (`npx wrangler d1 create kabine --jurisdiction eu`, see "Installing by hand") and use that database for the Worker. The team chat already lives in the EU jurisdiction.

## 2. Add your domain

In the Cloudflare dashboard open *Workers & Pages → kabine → Settings → Domains & Routes* and add a custom domain, for example `app.your-club.org`. Cloudflare creates the DNS record and the certificate.

From now on, use only this address. Passkeys created under the `workers.dev` address do not work on the club domain.

## 3. First admin

Open `https://app.your-club.org/einrichtung#<your ADMIN_BOOTSTRAP_TOKEN>`. Enter your name and e-mail address and create a passkey (Face ID, fingerprint or the screen lock of your device). The setup link works once.

The setup wizard opens right after:

1. Language and region: the club's language, country and state (for school holidays and public holidays), time zone.
2. Club: name, short name, abbreviation, colours and logo.
3. Sport and season: brings age groups, playing times and helper duties of the sport.
4. Functions: helper duties, youth referees, carpools, handball4all, SMS.
5. E-mail: Cloudflare Email Sending or the club's SMTP server (see below).
6. First teams.
7. Privacy: link to the club's privacy policy and legal notice, contact for questions.

Everything can be changed later under *Administration*. "Continue later" leaves the wizard; it reopens under *Administration → Setup wizard*.

## 4. E-mail (optional, recommended)

Kabine sends e-mails for sign-in codes on new devices, access links and helper plan reminders. Without e-mail, people sign in with passkeys and the links coaches hand out.

- **Cloudflare Email Sending:** the domain must be set up for sending in Cloudflare (*Email → Email Sending*). Enter the sender address in the wizard, for example `no-reply@your-club.org`.
- **SMTP:** the club's mail server, with TLS on port 465 or STARTTLS on port 587. The password is stored encrypted.

The wizard sends a test mail.

## 5. Invite people

Coaches are assigned by an admin under *Administration → Teams → Coaches* and get a personal link. Coaches then add their players (one by one or as a list from a spreadsheet), create training plans and share the invitation links for players and parents in the team's group chat. The invitations tab shows who cannot be reached yet.

Push notifications work on Android and desktop browsers right away. On an iPhone, the app must be added to the home screen first (Safari → Share → *Add to Home Screen*); the app explains this to everyone.

## 6. Updates

Your copy contains the workflow `.github/workflows/update.yml`. Once a week it looks for a new Kabine release and opens a pull request. Merging it deploys the new version, including database migrations. Make sure GitHub Actions are enabled in your copy (*Settings → Actions*).

If a release changes the Cloudflare configuration (for example a new binding), the pull request says so. Compare `wrangler.jsonc` before merging.

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
