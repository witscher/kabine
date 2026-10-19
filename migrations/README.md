# Migrations

`0001_init.sql` is the consolidated initial schema. It is **frozen**: clubs and the demo already run it, and Wrangler never applies a file twice, so an edit would reach new installations only. `test/migrations.test.ts` checks its content hash.

Every schema change is a **new file**, never an edit of an existing one:

```
YYYYMMDDHHMM_<area>_<what>.sql      e.g. 202611051430_carpools_seat-notes.sql
```

- The UTC timestamp keeps parallel pull requests from clashing on the same number; Wrangler applies the files in name order and remembers which ran.
- `<area>` is `core` or the module folder (`carpools`, `duties`, …); `<what>` is a short kebab-case description.

## Rules

**Safe for every club.** A migration runs on an empty database, on a large one, and with every module on or off. Add columns with defaults, backfill in the same file, never drop data a club may still need.

**The previous release keeps working on the new schema** (expand, then contract). The deploy applies the migrations before it uploads the new Worker, and an admin may roll the Worker back in the dashboard after an update. Both times the previous release's code runs on the new schema. So in one release only add: new tables, new columns with defaults, copies of data. Renaming or dropping a table or column, or a new `NOT NULL` without a default, waits for a later release, once no released code reads it. Write the clean-up down under *Later* below.

**With a test.** Every migration after `0001_init.sql` has an upgrade test: a database on the schema before it, with the data a club already has, then the migration, then the checks (`upgradeFrom` in `test/helpers.ts`). `test/migrations.test.ts` fails when a migration is not named in any test.

```ts
await upgradeFrom("202611051430_carpools_seat-notes.sql"); // older migrations only
await exec("INSERT INTO carpools …");                       // data as a club has it
await migrateRest();                                         // the new migration(s)
expect(await one("SELECT seat_note FROM carpools …")).toEqual(…);
```

## What happens on deploy

`npm run deploy` (`scripts/deploy.mjs`) checks for pending migrations. Without any it just uploads. With some it notes a restore point (D1 Time Travel bookmark), marks the update in the database so the app answers "being updated" to everyone for about a minute, applies the migrations, uploads the new Worker and removes the mark. *Administration → Updates and maintenance* shows the last update with its restore point. See `docs/operation.md`.

## Later

Clean-ups that wait for a later release (contract step):

- none yet

Wrangler only reads `.sql` files, so this README is ignored when migrating.
