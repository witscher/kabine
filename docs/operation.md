# Running Kabine

What the people who run the app for the club do from time to time. Commands run in a checkout of the club's copy with `npm ci` done and `npx wrangler login` (or a `CLOUDFLARE_API_TOKEN`).

## Every season

The **season change** (*Administration → Season change*) prepares the new season: it shows a preview, assigns players to the teams of their new age group, deletes the events, training plans, chat histories and responses of the old season and removes people who left the club. Export the data first (next section).

Training plans, coaches and staff are set again after the change. Holidays and public holidays of the new school year are loaded during the change.

## Backup

- **Export:** *Administration → Export* downloads all club data as a JSON file (people, teams, events, responses, settings). Sessions, passkeys, push subscriptions, invitation links and generated keys are not part of it. Keep the file somewhere safe and access-controlled; it contains names of minors.
- **D1 Time Travel:** Cloudflare keeps a restorable history of the database (7 days on the free plan, 30 on the paid plan): `npx wrangler d1 time-travel info DB` shows a bookmark, `npx wrangler d1 time-travel restore DB --bookmark=<bookmark>` goes back. Restoring discards everything written afterwards.

## Maintenance mode

Before risky work on the data, switch on maintenance mode in *Administration → Updates and maintenance*. Only admins can use the app, everyone else sees a maintenance page, and the hourly cron run (reminders, automatic messages) pauses. It takes effect within about a minute. From a checkout:

```sh
npm run maintenance:on
npm run maintenance:status
npm run maintenance:off
```

The switch lives in KV (key `maintenance`), independent of the database.

## Updates

A pull request "Update Kabine to vX.Y.Z" appears in the club's copy when a release is out (`.github/workflows/update.yml`, weekly). It says whether the release changes the database and whether `wrangler.jsonc` needs new entries. You choose when to merge; Workers Builds then deploys with `npm run deploy` (`scripts/deploy.mjs`):

1. **No database changes:** build and upload. The app keeps running; open pages pick up the new version on their next start.
2. **With database changes:** the script first notes a **restore point** (D1 Time Travel bookmark, printed in the build log), then marks the update in the database. For about a minute everyone, admins included, sees "Kabine is being updated", and the cron run pauses. The migrations run, the new version is uploaded, the mark is removed and the app reloads by itself. If the build is cut off, the mark expires after 15 minutes.

*Administration → Updates and maintenance* shows the installed version and the last update: when, which database changes, and the restore point with the command to go back. Merge releases with database changes at a quiet time, not right before a game.

**Going back.** Migrations keep the previous release working (`migrations/README.md`), so rolling back only the Worker is usually enough: *Workers & Pages → this Worker → Deployments → Rollback*. That holds for one release back. After an update that skipped releases, an older Worker may no longer fit the database (a later release can remove what it still uses): roll back the Worker and restore the database to the restore point together. Also restore the database if the data itself is wrong:

```sh
npx wrangler d1 time-travel restore DB --bookmark=<restore point>
```

Restoring discards everything written after the restore point. Switch maintenance mode on before, and off when you have checked the app.

If you would rather check a release on your own first, switch maintenance mode on, merge, check the app as an admin and switch it off again.

**Skipping releases.** A copy can go from any release straight to the newest one. The pull request always brings the newest release, lists the database changes and shows the release notes of every version since the installed one; the deploy applies all pending migrations in order, with one pause and one restore point. An older update pull request that is still open is closed with a link to the new one, so nobody installs an older version by mistake.

**Workflow files.** GitHub does not let the automatic update change files in `.github/workflows`. If a release changes them, the pull request lists them with links: open each link, copy the content, edit the same file in your copy on GitHub and paste it. Do this before merging the update.

### Updating an older copy

Copies created before the first release (v0.2.0, October 2026) need three things once. After that, updates arrive as described above.

1. **Add or replace the update workflow.** Copies made with the deploy button have none, and older ones cannot finish an update. In your copy on GitHub create or edit `.github/workflows/update.yml` with the content of the [current version](https://github.com/witscher/kabine/blob/main/.github/workflows/update.yml), and under *Settings → Actions → General → Workflow permissions* tick *Allow GitHub Actions to create and approve pull requests*. Then run it once: *Actions → Kabine updates → Run workflow*. A pull request "Update Kabine to v…" (or an issue with a link to it) appears within a minute.
2. **Check the deploy command.** In the Cloudflare dashboard: *Workers & Pages → your Worker → Settings → Build*, the deploy command must be `npm run deploy`.
3. **Switch maintenance mode on by hand for this one update.** The running old version does not know the automatic pause yet. In a checkout of your copy (with `npm ci` done and `npx wrangler login`):

   ```sh
   npm run maintenance:on
   ```

   Wait a minute, merge the pull request, wait until the build is done, then switch maintenance mode off under *Administration → Updates and maintenance* (or `npm run maintenance:off`). From then on the app pauses by itself when an update changes the database.

The pull request also says whether `wrangler.jsonc` needs new entries; compare it with the release before merging.

### Installed by hand from a clone

If you cloned `witscher/kabine` and deploy from your machine, keep your `wrangler.jsonc` (resource IDs, domain) and pull the release:

```sh
git stash            # your wrangler.jsonc changes, if not committed
git fetch --tags
git checkout v0.2.0  # the release you want
git stash pop        # resolve wrangler.jsonc by hand if the release changed it
npm ci
npm run deploy       # restore point, pause, migrations, upload
```

For the first update from a copy older than v0.2.0, switch maintenance mode on before `npm run deploy` (step 3 above).

## Logs

`npx wrangler tail` shows requests and errors live. With `observability` enabled in `wrangler.jsonc`, the dashboard keeps logs for a few days (*Workers & Pages → kabine → Observability*).

## Secrets

| Secret | Purpose | Changing it |
| --- | --- | --- |
| `ADMIN_BOOTSTRAP_TOKEN` | Setup link of the first admin, works once | Harmless after the setup; can be deleted |
| `APP_SECRET` | Signs invitation and e-mail links, encrypts the SMTP password and the SMS key | Open links stop working; enter SMTP password and SMS key again |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push notifications | Every device must switch notifications on again |

Without `APP_SECRET` and the VAPID keys set as secrets, the app uses keys it generated on first start (table `instance_secrets`). Secrets set with `npx wrangler secret put` take precedence; switching from generated to own keys has the effects in the table.

## Optional variables

The "Deploy to Cloudflare" button asks for none of these; the app works without them. Set them only if you need them, as plain-text variables of the Worker (*Workers & Pages → kabine → Settings → Variables and Secrets*), or in `wrangler.jsonc` under `vars`.

| Variable | Without it | Set it when |
| --- | --- | --- |
| `ORIGIN` | The app uses the address it was opened at (e.g. `https://app.your-club.org`) and remembers it for links in push messages and e-mails. | The app can be reached at more than one address and links should always point to one of them. |
| `RP_ID` | Passkeys are bound to the host name the app was opened at. | Same case as `ORIGIN`: set it to the host name of that address (`app.your-club.org`), never to a `workers.dev` address you will stop using. |
| `MAIL_FROM` | The sender address comes from the setup wizard (*Administration → E-mail*). | You want a default sender before the wizard has run. |

## Owner and admins

The first admin is the **owner**. Other admins cannot take away the owner's admin role or access. Keep at least two admins, so the club does not depend on one person. An admin who lost their device gets a personal link from another admin, or signs in with a code by e-mail when e-mail is set up.

### Nobody can get into Administration

If no admin can sign in any more (devices lost, the only admin left the club), whoever has access to the club's Cloudflare account creates an admin link from a checkout of the club's copy (with `npm ci` done and `npx wrangler login`):

```sh
npm run admin:link -- --first Alex --last Admin --email alex@your-club.org
```

It creates the admin, or makes the person with this admin address an admin again (also the owner, or someone who left), withdraws older personal links of that person and prints a link valid for 24 hours. Open it on the device that should get access and set up a passkey; if the person already had an access, its devices are signed out. The command writes to the database with Wrangler and stores only a hash of the link, like every invitation. Options: `--origin https://app.your-club.org` when the app's address is not known yet, `--env <name>` for an environment of `wrangler.jsonc`, `--config <file>` for another Wrangler configuration, `--local` for the local database.

## Uninstalling

Delete the Worker, the D1 database, the KV namespace and the queue in the Cloudflare dashboard, then the copy on GitHub. Devices keep a cached copy of the last loaded content until the app is removed from them or the browser data is cleared.
