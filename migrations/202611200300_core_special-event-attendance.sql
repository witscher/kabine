-- How people respond to a special event (docs/dev/decisions.md, "Special events: attendance modes"). At most one of the
-- three is on (the API refuses two, 400 attendance_conflict); all off is the usual yes/no per person.
--   no_attendance:       nobody responds; no reminders, no counts, no attendance. Helper duties stay.
--   optional_attendance: everyone is optional, whoever wants to join says yes; no reminders.
--   family_attendance:   each family says how many people come (event_family_responses), instead of yes/no per person.
-- Existing events: all off. Additive: the previous release ignores the columns and the table.
ALTER TABLE events ADD COLUMN no_attendance INTEGER NOT NULL DEFAULT 0 CHECK (no_attendance IN (0, 1));
ALTER TABLE events ADD COLUMN optional_attendance INTEGER NOT NULL DEFAULT 0 CHECK (optional_attendance IN (0, 1));
ALTER TABLE events ADD COLUMN family_attendance INTEGER NOT NULL DEFAULT 0 CHECK (family_attendance IN (0, 1));

-- One number per family and event (0: not coming). Families are the participants and their parents, joined through the
-- parent links; anchor_id is the smallest person id of the family when it was saved. On reading, the number belongs to
-- the family that person is in now (with two, the newer one wins).
CREATE TABLE event_family_responses (
  event_id   INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  anchor_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  count      INTEGER NOT NULL CHECK (count BETWEEN 0 AND 30),
  updated_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, anchor_id)
);
