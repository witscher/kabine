-- Module "club mascot": one picture per slot (result faces, home game day card and tiles), uploaded by an admin.
-- Stored in D1 like profile pictures; slot names and types are checked in the module (modules/mascot/shared/rules.ts),
-- so new slots need no table rebuild. The picture comes last: reading slot and version does not touch it.
CREATE TABLE mascot_images (
  slot       TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  image      BLOB NOT NULL
);
