-- Protocol for admins: who did what to whom and when, for actions with a large effect (account removed,
-- personal link, leaving the club, admin rights, members, schedules, cancelled events, season change,
-- export). Names are a snapshot, so entries about deleted people stay readable; no foreign keys for the same
-- reason. Emptied by the season change, not in the export. See docs/dev/design.md, Protocol.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  person_id   INTEGER,
  person_name TEXT,
  team_id     INTEGER,
  team_name   TEXT,
  event_id    INTEGER,
  detail      TEXT CHECK (detail IS NULL OR length(detail) <= 300)
);
