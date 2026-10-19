-- Attendance after an event: coaches record present, excused or unexcused per participant (shared/attendance.ts).
-- Replaces unexcused_absences: every mark there is copied as "unexcused" with who marked it and when. The old
-- table is no longer written but stays until a later release, so the previous release keeps working
-- (migrations/README.md, Later).
CREATE TABLE attendance_marks (
  event_id  INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  status    TEXT NOT NULL CHECK (status IN ('present', 'excused', 'unexcused')),
  marked_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  marked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, person_id)
);
CREATE INDEX attendance_marks_person ON attendance_marks (person_id);
INSERT OR IGNORE INTO attendance_marks (event_id, person_id, status, marked_by, marked_at)
  SELECT event_id, person_id, 'unexcused', marked_by, marked_at FROM unexcused_absences;
