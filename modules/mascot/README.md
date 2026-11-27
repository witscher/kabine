# Club mascot

Many clubs have a mascot children know. With this module admins upload its pictures, and the app shows them where the original club app shows its own mascot: faces next to a game's result for players under 14, and the mascot on the cards of the home game day. Ported from the original club app (`docs/dev/upstream-tasks.md`, 2026-11-26), where the pictures are fixed files in `src/images/`. Kabine has no club's pictures in code.

- **Slots** (`MASCOT_SLOTS` in `shared/module-api.ts`, rules in `shared/rules.ts`):
  - four faces for results, square: `win`, `draw`, `close` (lost by up to 4 goals), `clear` (lost by 5 or more). The result display in the event list will ask for them (upstream task "Results in the event list"); until then they are only stored.
  - `card`: the picture on the large home game day card, any shape.
  - `head`: the head on the small tiles of later home game days and on the page of the day, any shape.
- **Administration → Club mascot** (`/verwaltung/maskottchen`): one tile per slot with the picture on a checkerboard (to see transparency), upload or replace, remove.
- **Upload, checked like profile pictures:** PNG, WebP or SVG with a transparent or white background, at least 256 pixels on the longer side, faces square (2 % tolerance, then drawn square). The browser scales to 256 px (faces, head) or 512 px (card) on the longer side and writes WebP, or PNG where the browser cannot write WebP (Safari); an SVG is drawn into one of them, so no SVG is stored. More than a quarter of the outer two pixel rows neither transparent nor white counts as a coloured background and is refused. At most 200,000 bytes; a larger picture is scaled down step by step to 256 px. The server reads type and size from the bytes again (PNG, WebP), refuses everything else, and needs at least 256 px, square faces and at most 200,000 bytes. Blocked in the public demo (`worker/demo/routes.ts`).
- **For other code** (hook `mascot`, `docs/dev/modules.md`): `GET /api/club` carries the URLs of the filled slots as `mascot` while the module is on. The app asks `useMascotImage(slot)` (`src/modules.ts`), worker code `moduleMascot(db)` (`worker/modules.ts`). Both answer none while the module is off or the slot is empty; the pictures stay stored while it is off.

## Privacy

- **Stores:** no personal data. Up to six pictures (`mascot_images`: slot, type, version, upload time, picture), uploaded by an admin; who uploaded is not stored.
- **Who sees it:** everyone who opens the app, like the club logo (also the sign-in page). Served with the version in the URL and cached for a year.
- **Deleted:** when an admin removes or replaces a picture. Not in the export.

## Read load

One query per start of the app while the module is on: slot and version of at most six rows (the picture is the last column and not read). The pictures themselves are cached by the browser under their version.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest, privacy |
| `shared/rules.ts` | slots' rules, limits, type and size from the bytes (`imageInfo`) |
| `worker/routes.ts` | `GET`, `PUT`, `DELETE /api/mascot/images/:slot` |
| `worker/index.ts` | hook `mascot`, export |
| `app/index.tsx`, `app/admin.tsx`, `app/mascot.css` | Administration → Club mascot |
| `app/prepare.ts` | checking and scaling in the browser |
| `test/mascot.test.ts` | type and size from the bytes, upload and checks, the hook and the club profile, upgrade |
