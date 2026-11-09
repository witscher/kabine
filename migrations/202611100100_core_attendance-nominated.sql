-- Statistics (docs/dev/design.md, Statistics): the attendance record says for games whether someone was nominated
-- (an appearance is nominated and present). Until now only nominated players took part in games ("whole team at
-- games" did not exist before this release), so every earlier game row was nominated.
ALTER TABLE attendance ADD COLUMN nominated INTEGER NOT NULL DEFAULT 0 CHECK (nominated IN (0, 1));
UPDATE attendance SET nominated = 1 WHERE kind = 'game';

-- A team's statistics: the record by team and kind
CREATE INDEX attendance_team ON attendance (team_id, kind);
