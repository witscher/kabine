**Deutsch:** [README auf Deutsch](README.md)

# Kabine

Kabine is a free team app for amateur sports clubs: trainings and games with yes/no responses, squad nominations, team chat, push notifications, helper duties and carpools, for players, parents and coaches. It runs as an installable web app on phones and computers, and each club runs its own copy in its own Cloudflare account.

It started as the app of a handball club, where several hundred players, parents and coaches use it every day. Kabine is the same app for any club, in English and German.

<table>
  <tr>
    <td><img src="docs/screenshots/en/01-events.png" width="230" alt="Upcoming events of a player with the next training and her response"></td>
    <td><img src="docs/screenshots/en/03-coach-responses.png" width="230" alt="A coach sees who accepted and who declined, with reasons"></td>
    <td><img src="docs/screenshots/en/05-chat.png" width="230" alt="Team chat with coach, parent and player"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/en/04-squad.png" width="230" alt="Nominating the squad for a game"></td>
    <td><img src="docs/screenshots/en/07-helper-duties.png" width="230" alt="Helper duties for a home game"></td>
    <td><img src="docs/screenshots/en/06-carpool.png" width="230" alt="Carpool to an away game"></td>
  </tr>
</table>

All pictures show an invented demo club. More in [docs/screenshots](docs/screenshots/en).

## What it does

**Players** see their trainings, games and special events, accept or decline with a tap, and get a notification when something changes. Trainings count as accepted until someone declines, so nobody has to answer every week.

**Parents** respond for their children, read along in the team chat, take on helper duties and offer seats for away games. They decide what their child may do in the app.

**Coaches** set up training plans once a season. The app creates the trainings, skips school holidays and public holidays, and shows who comes. Coaches nominate squads for games, cancel or move trainings with one notification to everyone, invite players and parents by link and see who cannot be reached yet.

**Admins** set up the club with a wizard: language, region, sport, teams, modules, e-mail. They manage teams, coaches and people, and run the season change once a year.

Optional modules: helper duties for home games and events, youth referees, carpools, game schedules from handball4all (German handball), sign-in codes and reminders by SMS. Games can also be imported from a spreadsheet.

## An internal app for one club

Kabine is deliberately not a platform and not in the app stores.

- **One installation per club.** The data stays in the club's own Cloudflare account. There is no central server, no account across clubs, and the authors of Kabine have no access to any club's data.
- **No app store.** People open the club's address and add the app to their home screen. It works like an installed app, with notifications, also on iPhones. Without a store there are no store accounts, no age ratings and no review process between the club and its members, and every update reaches everyone at once.
- **Invitations only.** There is no public sign-up and no public content. Coaches share invitation links in their team's group, admins hand out personal links. Sign-in is by passkey (Face ID, fingerprint, screen lock), so there are no passwords to forget or leak.
- **Small on purpose.** Kabine covers what a team needs week by week. Membership fees, accounting and the club's website stay where they are.

## Privacy and youth protection

Most users are children and teenagers. Of players and parents Kabine stores only first name, last name and the players' year of birth. No address, no date of birth, no phone number unless someone enters one for text messages.

- E-mail address and phone number are **entirely optional** and only used for signing in. Other users, coaches included, never see them. Admins see only other admins' e-mail addresses (required for admins) and, in the full data export, the e-mail addresses of the accounts; phone numbers never.
- Reasons for declining are visible only to coaches and admins and are deleted 60 days after the event.
- Parents of minors decide what their child may do in the app (accept, decline, read and write in the chat) and approve profile pictures before others see them.
- Other parents and players see names shortened ("Kim M.") in helper duties and carpools.
- Team chats always include the coaches, who can mute members and remove messages. There are no private messages.
- No tracking, no advertising, no third-party scripts or fonts. The app loads nothing from other servers.
- Leaving the club removes access at once and all data at the next season change at the latest. Chats, events and responses are deleted every season.

**Cloudflare and where the data lives:** The app runs on Cloudflare's infrastructure (a processor; the club signs Cloudflare's data processing agreement in its own account). The D1 database should be **created explicitly in Europe** (`wrangler d1 create kabine --jurisdiction eu`); the team chat already lives in the EU jurisdiction. The app's code runs at Cloudflare locations near the users, while data is stored in the EU. The "Deploy to Cloudflare" dialog does not guarantee this: if you need it, create the database by hand first ([docs/install.md](docs/install.md)).

The full list of stored data, who sees it and when it is deleted, plus a template for the club's privacy policy: [docs/privacy.md](docs/privacy.md).

## Frequently asked questions

For club officials and data protection officers.

<details>
<summary><b>What is Kabine – and what is it not?</b></summary>

Kabine organises the everyday life of teams: trainings and games with yes/no responses, squads, team chat, helper duties and carpools.

Kabine is **not club management software**: no membership records with addresses and joining dates, no fees, no direct debits, no bookkeeping, no club website and no public results portal. Those programs stay where they are. Kabine deliberately stores only what a team needs week after week.

</details>

<details>
<summary><b>What does Kabine cost?</b></summary>

The software is free (AGPL-3.0): no licence, no subscription, no ads, forever.

For a typical club with a few hundred members, Cloudflare's free plan is enough to run it. If you want more headroom, the paid plan costs 5 US dollars a month at the time of writing. Costs per message only arise if the club switches on the SMS module. A domain of your own is optional.

</details>

<details>
<summary><b>Why Cloudflare and not a German or local host?</b></summary>

Cost and availability. A server of your own at a hosting company costs money every month and has to be set up, updated, backed up and monitored, in a club usually by a volunteer. On Cloudflare, Kabine runs without a server of its own on the free plan. The platform applies security updates itself, copes on Sunday evening when everyone responds at once, and keeps a history of the database that lets you undo a mistake.

On data protection: the club is the controller, Cloudflare the processor. The club concludes Cloudflare's data processing agreement in its own account; it includes the EU standard contractual clauses, and Cloudflare is certified under the EU-US Data Privacy Framework. The database should be created explicitly in the EU (`--jurisdiction eu`); the team chat already lives in the EU jurisdiction. Cloudflare handles requests at locations near the users, for users in Germany usually in Europe.

Kabine does not run on a server of your own: it is built for the Cloudflare platform (Workers, D1, Durable Objects).

</details>

<details>
<summary><b>Who has access to our data?</b></summary>

Only the club. Every installation lives in the club's own Cloudflare account. There is no central Kabine server, and the developers of Kabine have no access to any club's data. Inside the app, everyone sees only what their role needs: decline reasons, for example, only coaches and admins.

</details>

<details>
<summary><b>Is Kabine GDPR compliant?</b></summary>

Kabine is built for data minimisation: of players and parents only first name, last name and year of birth, no tracking, deletion periods built in. Whether the processing in the club is lawful remains the club's responsibility. For that there is a complete list of the stored data (who sees what, when it is deleted) and a template for the privacy policy: [privacy and data inventory](docs/privacy.md).

</details>

<details>
<summary><b>Do children need their own phone or an e-mail address?</b></summary>

No. Parents respond for their children. Children with a device of their own get access by link, without an e-mail address and without a phone number. Parents decide what their child may do in the app and approve profile pictures.

</details>

<details>
<summary><b>How much work is running it?</b></summary>

Installing takes about 30 minutes. After that there is no server to look after: updates arrive as pull requests in the club's copy and are taken over with one click, the season change runs once a year with a wizard, and the data export saves everything to a file. Coaches manage their teams themselves.

</details>

<details>
<summary><b>What happens if we stop?</b></summary>

The club exports its data and deletes the Worker, database, KV store and queue in its own Cloudflare account. Then the data is gone. There is no provider to cancel or to ask for deletion.

</details>

<details>
<summary><b>Which sports does Kabine suit?</b></summary>

Kabine started in a handball club and brings age groups, playing times, helper duties and the game schedules from handball4all for handball. Football and other sports have basic settings. More sports and fixture systems can be contributed on GitHub.

</details>

<details>
<summary><b>Is there support?</b></summary>

Kabine is free software without commercial support. Questions, bugs and ideas go into the issues on GitHub. You can try everything in the demo first.

</details>

## Installation

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/witscher/kabine)

You need a Cloudflare account (the free plan is enough for a typical club), a GitHub account and ideally the club's domain. The button creates your copy and all resources; you choose one password for the first admin. Step by step, including e-mail and updates: [docs/install.md](docs/install.md). Running the app (backups, season change, maintenance, updates): [docs/operation.md](docs/operation.md).

## Languages

English and German. Translations are gettext `.po` files in `locales/` that anyone can correct. Adding a language: [docs/translation.md](docs/translation.md).

## Development

Node.js 22 or newer.

```sh
npm ci
npm run secrets:generate -- --dev   # local secrets in .dev.vars
npm run db:reset:local              # local database with the invented demo club
npm run dev                         # http://localhost:5173
npm run check                       # typecheck and tests
npm run e2e                         # end-to-end tests (Playwright)
npm run screenshots                 # the pictures above, in English and German
```

The first admin is set up at `/einrichtung#<ADMIN_BOOTSTRAP_TOKEN>` (see `.dev.vars`).

Built with Cloudflare Workers, D1, Durable Objects and Queues, Hono, Preact and Lingui. Design decisions: [docs/design.md](docs/design.md) and [docs/decisions.md](docs/decisions.md). Security rules with a test each: [docs/security.md](docs/security.md).

## Contributing

Pull requests are welcome: translations, sports, connectors to fixture systems, SMS providers and new modules. Where things live and how to add a module: [docs/modules.md](docs/modules.md); rules and process: [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

AGPL-3.0-only, see [LICENSE](LICENSE). You may run, change and share Kabine. If you run a changed version for others, you must offer them its source code.
