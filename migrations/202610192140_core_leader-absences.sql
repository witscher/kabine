-- Coaches, group leads, staff and organisers say "I'm not there" for an event (worker/domain/leaders.ts).
-- Leaders are not participants: no row means present. Only adds a table, so the previous release keeps working.
CREATE TABLE leader_absences (
  event_id      INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id     INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  -- Free text for the other leaders (coaches and admins see it, the team never does)
  note          TEXT,
  -- Participants and their parents were told (without the note)
  team_informed INTEGER NOT NULL DEFAULT 0 CHECK (team_informed IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, person_id)
);
CREATE INDEX leader_absences_person ON leader_absences (person_id);
