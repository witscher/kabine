# Running Kabine

What the people who run the app for the club do from time to time. Commands run in a checkout of the club's copy with `npm ci` done and `npx wrangler login` (or a `CLOUDFLARE_API_TOKEN`).

## Every season

The **season change** (*Administration → Season change*) prepares the new season: it shows a preview, assigns players to the teams of their new age group, deletes the events, training plans, chat histories and responses of the old season and removes people who left the club. Export the data first (next section).

Training plans, coaches and staff are set again after the change. Holidays and public holidays of the new school year are loaded during the change.

## Backup

- **Export:** *Administration → Export* downloads all club data as a JSON file (people, teams, events, responses, settings). Sessions, passkeys, push subscriptions, invitation links and generated keys are not part of it. Keep the file somewhere safe and access-controlled; it contains names of minors.
- **D1 Time Travel:** Cloudflare keeps a restorable history of the database (7 days on the free plan, 30 on the paid plan): `npx wrangler d1 time-travel info DB` shows a bookmark, `npx wrangler d1 time-travel restore DB --bookmark=<bookmark>` goes back. Restoring discards everything written afterwards.

## Maintenance mode

Before risky work on the data, switch on maintenance mode. Only admins can use the app, the hourly cron run pauses.

```sh
npm run maintenance:on      # takes effect within about a minute
npm run maintenance:status
npm run maintenance:off
```

The switch lives in KV (key `maintenance`), independent of the database.

## Updates

A pull request "Update Kabine to vX.Y.Z" appears in the club's copy when a release is out (`.github/workflows/update.yml`, weekly). Read the notes, check whether `wrangler.jsonc` needs new entries, merge. Workers Builds deploys the new version with `npm run deploy`, which applies the database migrations first.

For a release with database migrations, maintenance mode during the merge avoids people writing into a half-migrated database. Note the current version (*Workers & Pages → kabine → Deployments*) and a Time Travel bookmark before, so you can go back: roll back the Worker version in the dashboard and restore the bookmark.

## Logs

`npx wrangler tail` shows requests and errors live. With `observability` enabled in `wrangler.jsonc`, the dashboard keeps logs for a few days (*Workers & Pages → kabine → Observability*).

## Secrets

| Secret | Purpose | Changing it |
| --- | --- | --- |
| `ADMIN_BOOTSTRAP_TOKEN` | Setup link of the first admin, works once | Harmless after the setup; can be deleted |
| `APP_SECRET` | Signs invitation and e-mail links, encrypts the SMTP password and the SMS key | Open links stop working; enter SMTP password and SMS key again |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push notifications | Every device must switch notifications on again |

Without `APP_SECRET` and the VAPID keys set as secrets, the app uses keys it generated on first start (table `instance_secrets`). Secrets set with `npx wrangler secret put` take precedence; switching from generated to own keys has the effects in the table.

## Owner and admins

The first admin is the **owner**. Other admins cannot take away the owner's admin role or access. Keep at least two admins, so the club does not depend on one person. An admin who lost their device gets a personal link from another admin, or signs in with a code by e-mail when e-mail is set up.

## Uninstalling

Delete the Worker, the D1 database, the KV namespace and the queue in the Cloudflare dashboard, then the copy on GitHub. Devices keep a cached copy of the last loaded content until the app is removed from them or the browser data is cleared.
