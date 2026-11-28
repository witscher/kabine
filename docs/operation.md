# Running Kabine

What the people who run the app for the club do from time to time. Commands run in a checkout of the club's copy with `npm ci` done and `npx wrangler login` (or a `CLOUDFLARE_API_TOKEN`).

## Every season

The **season change** (*Administration → Season change*) prepares the new season: it shows a preview, assigns players to the teams of their new age group, deletes the events, training plans, chat histories and responses of the old season and removes people who left the club. Export the data first (next section).

Training plans, coaches and staff are set again after the change. Holidays and public holidays of the new school year are loaded during the change.

## Backup

- **Import:** *Administration → Import / restore* takes teams, coaches and players from the club's lists (Excel .xlsx, CSV or a pasted table). The lists are read in the admin's browser and not uploaded; only first name, last name, birth year, team and role are taken, after a review. Existing teams and people are found again, so nothing is created twice.
- **Restore:** the same page takes back an export of Kabine (the JSON file below), for example when moving to a new installation. The admin ticks what to take over: club settings, season and holidays, teams, people, team assignments, training plans, events, chats. Everything is merged, nothing is deleted or overwritten: what exists already is kept and skipped, so running it twice changes nothing. Ticking everything on a new installation restores the club in full; admin roles come along only then. Passkeys and sign-ins are not part of an export, so everyone signs in again (e-mail code, or a personal link). Chats are restored only into teams whose chat is still empty. Export the current data first; within 30 days the database can also be rolled back with D1 Time Travel (see *Updates*).
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

New Kabine versions reach a club in three ways:

- **In the app:** once a day the installation asks kabine.dev for the newest version. When there is a newer one, admins see a hint at the top of *Administration*, the section *New versions* under *Administration → Updates and maintenance*, and get one push ([Update notices](#update-notices)).
- **On GitHub:** once a week (Monday morning) the workflow `.github/workflows/update.yml` in the club's copy opens a pull request "Update Kabine to vX.Y.Z" with the newest release. The copy needs this workflow once (`docs/install.md`, step 6).
- **The install:** merging the pull request deploys the version through Workers Builds (`npm run deploy`, `scripts/deploy.mjs`). Nothing is installed without it; you choose when.

## Installing an update

1. **Open the pull request.** *Administration → Updates and maintenance → Install update* opens it in your club's copy on GitHub (or this guide, if the app does not know the copy). On GitHub itself: your copy → *Pull requests* → "Update Kabine to vX.Y.Z". The app can know about a version up to a week before the pull request appears; to get it right away, [run the workflow by hand](#no-update-pull-request).
2. **Read what the pull request says.** At the top:
   - *No database changes: the app keeps running during the deploy.* Merge whenever you like.
   - **Database changes:** the release changes the database (the migration files are listed). The app pauses for about a minute during the deploy, so merge at a quiet time.
   - **Check wrangler.jsonc:** the release changes the Cloudflare configuration, for example a new binding. Compare your `wrangler.jsonc` with the release's (the pull request keeps yours, with your resource IDs and domain) and add the new entries in your copy **before** merging (edit the file on GitHub, *Commit changes*).
   - **Update the workflows by hand, after the deploy:** GitHub does not let the automatic update change files in `.github/workflows`. The listed files are replaced by hand **after** merging (step 6).
   - Below: the release notes of every version since the installed one.

   A failed check "Workers Builds" on the pull request itself comes from builds for preview branches; switch them off as in `docs/install.md` (step 1). The deploy after merging is not affected.
3. **Merge at a quiet time.** *Merge pull request → Confirm merge*. Not right before a game or while many people respond, above all when the database changes.
4. **The maintenance minute.** Workers Builds starts the deploy within a minute or two; it takes a few minutes in all.
   - *No database changes:* build and upload. The app keeps running; open pages pick up the new version on their next start.
   - *With database changes:* the script first notes a **restore point** (D1 Time Travel bookmark, printed in the build log), then marks the update in the database. For about a minute everyone, admins included, sees "Kabine is being updated", and the cron run pauses. The migrations run, the new version is uploaded, the mark is removed and the app reloads by itself. If the build is cut off, the mark expires after 15 minutes.
5. **Check the version.** After a few minutes *Administration → Updates and maintenance* shows the new version under *Installed version*, and under *Last update* when, which database changes and the restore point with the command to go back; the hint at the top of *Administration* is gone. Still the old version after 15 minutes? Look at the build in the Cloudflare dashboard (*Workers & Pages → your Worker → Deployments*, the build log of the merge). A build that failed before the migrations changed nothing: start it again there. If it failed after them, the previous version keeps working with the new database; start it again, or [go back](#going-back-after-an-update).
6. **Workflow files, if the pull request listed any.** Open each link, copy the content, edit the same file in your copy on GitHub and paste it. Do this only after step 5: every commit to the copy starts a deploy, a workflow edit just before merging deploys the old version, and the build of the merge right after it may not deploy at all. If that happened anyway, the installed version is still the old one: commit any small change to the copy (or run the deploy again in the Cloudflare dashboard) to deploy the update.

If you would rather check a release on your own first, switch maintenance mode on, merge, check the app as an admin and switch it off again.

## Update notices

**What the app checks.** Once a day, from 10 o'clock in the club's time zone, the installation fetches `https://kabine.dev/releases.json` on the server (the hourly cron run; never from a browser): the newest version with its date, a link to its release notes and whether it is a security release. The request is an ordinary HTTPS request with the User-Agent `Kabine/<installed version>`; Cloudflare adds the header `CF-Worker` with the installation's domain to every request a Worker makes. No cookie, no ID and nothing about the club's people is sent, and kabine.dev does not log these requests; it only counts per day how many installations check and with which version, without storing domains or addresses. If kabine.dev cannot be reached, the app tries again the next day.

**What admins see.** When kabine.dev has a newer version than the installed one:

- a hint at the top of *Administration*, which each admin can close for this version on their device,
- a dot at *Updates and maintenance*, and there the section *New versions*: version and date, *Release notes*, *Install update* and the steps above,
- one push to every admin (in their language), once per new version. An admin who switched off *Work as admin* gets none.

**Security releases** are marked as such in their release notes. The app shows "Security update" in red, and its hint cannot be closed until the update is installed. Install those soon.

**"Install update"** opens the update pull request of your club's copy when the app knows the copy: the deploy in Workers Builds finds it from the checkout (the build log says `GitHub copy: owner/name`) and records it with the update. Until the first deploy after this feature, or if the deploy did not find it, the app takes the source code link under *Administration → Club* if it points to a copy on GitHub (everyone sees that link under *Help*, so enter it only for a public copy). Otherwise the button opens this guide. The app has no access to GitHub itself; it only links there.

**Switching it off.** *Administration → Updates and maintenance → Look for new versions*: off, the installation fetches nothing, and there is no hint and no push; update pull requests still arrive on GitHub. Only the push: *Profile → Notifications → New Kabine versions (admins)*, per admin.

## No update pull request

**Run the workflow by hand.** In your copy on GitHub: *Actions → Kabine updates → Run workflow*. Within a minute a pull request "Update Kabine to v…" appears, or the run shows why not. If the copy is already on the newest release, it does nothing.

If nothing appears:

- **No workflow "Kabine updates" under *Actions*:** the copy does not have the update workflow yet. Add it as in `docs/install.md` (step 6).
- **Actions are switched off:** *Settings → Actions → General → Actions permissions*: allow actions. In a public copy GitHub also pauses scheduled workflows after 60 days without activity in the repository; *Actions → Kabine updates → Enable workflow* switches it on again.
- **An issue "Kabine vX.Y.Z is ready to install" instead of a pull request:** GitHub did not let the workflow open the pull request. Open it with the link in the issue, check it and merge it. For next time: *Settings → Actions → General → Workflow permissions* → tick *Allow GitHub Actions to create and approve pull requests* and save.
- **The run failed:** open it under *Actions*; the last red step says why. "Open the pull request by hand" with a link means the same as the issue above.
- **The pull request for this version was closed without merging:** the workflow does not open it again. Reopen it on GitHub (*Pull requests → Closed*), or wait for the next version.

## Skipping versions

A copy can go from any release straight to the newest one. The pull request always brings the newest release, lists the database changes and shows the release notes of every version since the installed one; the deploy applies all pending migrations in order, with one pause and one restore point. An older update pull request that is still open is closed with a link to the new one, so nobody installs an older version by mistake. To leave out a version on purpose, simply do not merge its pull request; the next release brings it along anyway.

## Going back after an update

Migrations keep the previous release working (`migrations/README.md`), so rolling back only the Worker is usually enough: *Workers & Pages → this Worker → Deployments → Rollback*. That holds for one release back. After an update that skipped releases, an older Worker may no longer fit the database (a later release can remove what it still uses): roll back the Worker and restore the database to the restore point together. Also restore the database if the data itself is wrong:

```sh
npx wrangler d1 time-travel restore DB --bookmark=<restore point>
```

The restore point is in the build log and under *Administration → Updates and maintenance → Last update* (with a button to copy the command). D1 Time Travel keeps 7 days on the free plan and 30 on the paid plan. Restoring discards everything written after the restore point. Switch maintenance mode on before, and off when you have checked the app. The rolled-back Worker shows the old version again under *Installed version*; install a later release once the problem is fixed.

## Updating an older copy

Copies created before the first release (v0.2.0, October 2026) need three things once. After that, updates arrive as described above.

1. **Add or replace the update workflow.** Copies made with the deploy button have none, and older ones cannot finish an update. In your copy on GitHub create or edit `.github/workflows/update.yml` with the content of the [current version](https://github.com/witscher/kabine/blob/main/.github/workflows/update.yml), and under *Settings → Actions → General → Workflow permissions* tick *Allow GitHub Actions to create and approve pull requests*. Then run it once: *Actions → Kabine updates → Run workflow*. A pull request "Update Kabine to v…" (or an issue with a link to it) appears within a minute.
2. **Check the build settings.** In the Cloudflare dashboard: *Workers & Pages → your Worker → Settings → Build*, the deploy command must be `npm run deploy`; on the tab *Previews Base*, switch off *Builds for Preview branches*.
3. **Switch maintenance mode on by hand for this one update.** The running old version does not know the automatic pause yet. In a checkout of your copy (with `npm ci` done and `npx wrangler login`):

   ```sh
   npm run maintenance:on
   ```

   Wait a minute, merge the pull request, wait until the build is done, then switch maintenance mode off under *Administration → Updates and maintenance* (or `npm run maintenance:off`). From then on the app pauses by itself when an update changes the database.

The pull request also says whether `wrangler.jsonc` needs new entries; compare it with the release before merging.

## Installed by hand from a clone

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

**Error e-mail.** People never see the text of an unexpected server error, only a general message; when Cloudflare reports overload (for example D1's "too much load", a limit that applies to the whole Cloudflare account), they read that things are busy and to try again in a few minutes. Kabine counts these errors per day in KV (at most 20, kept 14 days) and from the third error of a day sends one e-mail to the **owner** of the installation (*Administration → Club*), to the confirmed e-mail address of their access, with time, place and the start of each message. Add a confirmed e-mail address to the owner's profile to get it; without one, or without e-mail sending set up, nothing is sent. The full messages stay in the logs.

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

## Legal notice and privacy policy

The club is the provider of the app and the controller for its data. Its legal notice and privacy policy are linked under *Administration → Club* and appear under every screen and every e-mail of the app; admins see a warning while one is missing. Update the privacy policy when the club switches on a module that stores something new (SMS, helper duties, carpools, a fixture connector) or changes its mail or SMS provider: the app's privacy page lists what each switched-on module stores.

## Invitations

Nobody gets into the app without an invitation link. There are three kinds:

- **Team links** (*Team → Invitations*): one player link and one parent link per team, valid for 14 days, for the team's private group chat or as a QR code at training. Whoever holds such a link can pick a name of the team, so share it only where the team is among itself. A new link withdraws the previous one; the season change withdraws all of them. Once more than 5 players (or more than 5 parents of the team's players) have an access, the team counts as set up: creating a new team link then shows a hint to send the few still missing a personal link or a parent link for their child instead. The team link can still be created.
- **Parent link for one child** (*Team → Squad → the player → Parents*, for admins also *Administration → People → the person*): a link for the parents of this child, valid for 7 days. It links only this child; each parent sets up their own access with it, up to two parents per child (admins can link more under *Administration → People*). It can be created by the child's coaches and by admins while the team has parents and the child has fewer than two parents linked. Use it for parents who are not in the group chat, or once the team is set up, instead of sharing the team's parent link again. A new link for the same child withdraws the previous one.
- **Personal links** (the person's sheet): a one-time link for one person's own access, valid for 7 days, also to set up a new passkey after a lost device (see *Owner and admins*).

Only a hash of every link is stored.

## Roles and trust

A club rests on trust, above all in its coaches, and Kabine reflects that. Coaches are trusted with their teams, admins with the whole club: coaches add players and stand-ins, plan trainings with other teams and record who was there without asking an admin. Choose coaches and admins accordingly, and take the role away when someone leaves the job.

What Kabine closes in any case: anything a person without a login or any signed-in user (often a child) could misuse, anything a taken-over account could use to take over someone else's access, and steps that happen easily by mistake with a large effect, such as a wrong schedule link or club-wide changes that cannot be undone. Sign-in codes by e-mail or SMS allow five tries each and at most five codes per address and hour, ten per day.

## Owner and admins

The first admin is the **owner**. Other admins cannot take away the owner's admin role or access. Keep at least two admins, so the club does not depend on one person. An admin who lost their device gets a personal link from another admin, or signs in with a code by e-mail when e-mail is set up. A personal link on an existing access sets up a new passkey and signs out the previous devices; the e-mail address of the access stays. If that address may not be the person's own, an admin switches on *Also remove the e-mail address for sign-in* in the person's sheet (*Administration → People*) before creating the link: using the link then removes it, and the person can enter a new one. *Administration → Protocol* shows when such a link was used.

### Break-glass: emergency admin access

Break-glass operations bypass the normal ways into the app (invitations by an admin, the protection of the owner). Use them only in an emergency: they need someone with access to the club's Cloudflare account, run from a checkout of the club's copy (with `npm ci` done and `npx wrangler login`), and the board should know about every use.

| Situation | Command |
| --- | --- |
| No admin can sign in any more (devices lost, the only admin left the club) | `npm run admin:link -- --first Alex --last Admin --email alex@your-club.org` |
| The owner is gone or no longer trusted | the same with `--owner` |
| Admin accesses are or may be compromised | the same with `--revoke-all-admins` |

What each does:

- **Always:** creates the admin, or makes the person with this admin address an admin again (also the owner, or someone who left), withdraws older personal links of that person and prints a link valid for 24 hours. Opening it sets up a passkey; if the person already had an access, its devices are signed out. Only a hash of the link is stored, like for every invitation. The output lists the other admins with the date they were last seen: check that each one still belongs there.
- **`--owner`:** the person also becomes the owner of the installation. Afterwards they can remove the previous owner's admin role or access in the app, which other admins cannot.
- **`--revoke-all-admins`:** every other admin loses the admin role and admin address, is signed out on all devices, and their open personal links are withdrawn. They keep their other roles (coach, parent, player). Implies `--owner`. The command asks you to type `REVOKE` first (or pass `--yes`).

Options: `--origin https://app.your-club.org` when the app's address is not known yet, `--env <name>` for an environment of `wrangler.jsonc`, `--config <file>` for another Wrangler configuration, `--local` for the local database.

**Traceable.** Every use is recorded in the database and shown to all admins under *Administration → Updates and maintenance → Emergency admin access* (the last 20: time, address, owner change, whose admin role was taken). It cannot be removed in the app. Cloudflare's audit log of the account shows who changed what there.

**Afterwards:**

1. Open the link right away on the device that should get access.
2. *Administration → Persons*: check every admin and remove the role of anyone who does not belong. Make sure there are at least two trusted admins again.
3. After compromised accesses also: check who has access to the Cloudflare account and which API tokens exist, change the secrets (see Secrets below), look at the Worker's recent deployments, and disable the accounts of compromised people in the app.
4. Tell the board. If personal data may have been seen by unauthorised people, the club as controller has to assess it and, where required, report it to the data protection authority within 72 hours (Art. 33 GDPR).

## Uninstalling

Delete the Worker, the D1 database, the KV namespace and the queue in the Cloudflare dashboard, then the copy on GitHub. Devices keep a cached copy of the last loaded content until the app is removed from them or the browser data is cleared.
