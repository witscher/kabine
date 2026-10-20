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

**Going back.** Migrations keep the previous release working (`migrations/README.md`), so rolling back only the Worker is usually enough: *Workers & Pages → this Worker → Deployments → Rollback*. Only if the data itself is wrong, restore the database to the restore point as well:

```sh
npx wrangler d1 time-travel restore DB --bookmark=<restore point>
```

Restoring discards everything written after the restore point. Switch maintenance mode on before, and off when you have checked the app.

If you would rather check a release on your own first, switch maintenance mode on, merge, check the app as an admin and switch it off again.

**Workflow files.** GitHub does not let the automatic update change files in `.github/workflows`. If a release changes them, the pull request lists them with links: open each link, copy the content, edit the same file in your copy on GitHub and paste it. Do this before merging the update.

### Updating an older copy

Copies created before the first release (v0.2.0, October 2026) need three things once. After that, updates arrive as described above.

1. **Replace the update workflow.** The workflow in older copies cannot finish an update. In your copy on GitHub open `.github/workflows/update.yml`, edit it and replace its content with the [current version](https://github.com/witscher/kabine/blob/main/.github/workflows/update.yml). If your copy has no such file, create it. Then run it once: *Actions → Kabine updates → Run workflow*. A pull request "Update Kabine to v…" appears within a minute.
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

## Uninstalling

Delete the Worker, the D1 database, the KV namespace and the queue in the Cloudflare dashboard, then the copy on GitHub. Devices keep a cached copy of the last loaded content until the app is removed from them or the browser data is cleared.
