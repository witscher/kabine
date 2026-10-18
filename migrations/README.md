# Migrations

`0001_init.sql` is the consolidated initial schema. Until the first release it is edited directly.

After the first release every schema change is a **new file**, never an edit of an existing one, because clubs have already applied them:

```
YYYYMMDDHHMM_<area>_<what>.sql      e.g. 202611051430_carpools_seat-notes.sql
```

- The UTC timestamp keeps parallel pull requests from clashing on the same number; Wrangler applies the files in name order and remembers which ran.
- `<area>` is `core` or the module folder (`carpools`, `duties`, …); `<what>` is a short kebab-case description.
- Each migration must run safely for every club: on an empty database, on a large one, and with every module on or off. Add columns with defaults, backfill in the same file, never drop data a club may still need.
- `test/migrations-naming.test.ts` checks the names. Wrangler only reads `.sql` files, so this README is ignored when migrating.
