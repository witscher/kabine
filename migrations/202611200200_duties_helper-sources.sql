-- Helper duties (docs/dev/decisions.md, "Helpers from"):
-- * Duty types get three switches: assigned by the coach (nobody signs up themselves), "helpers wanted" on or off,
--   adults only (by birth year).
-- * Where the helpers of a duty come from belongs to the template line and the time block, not to the duty type:
--   helper_mode 'default' = "who helps" of the duty type (the event's team, as before), 'teams' = players of the teams
--   in helper_teams (JSON list of team ids), 'rotate' = one team of the list per game in turn (rotate_team_id, stored
--   and changeable). rotate_notified: the team whose chat was told already.
-- Existing rows keep 'default', so every club keeps its behaviour. The previous release ignores the new columns.
-- No cache trigger changes: the "ref" and "duties" triggers on duty_types and duty_template_items already fire on every
-- column, and nothing cached reads event_duties.

ALTER TABLE duty_types ADD COLUMN assign_only INTEGER NOT NULL DEFAULT 0 CHECK (assign_only IN (0, 1));
ALTER TABLE duty_types ADD COLUMN notify_open INTEGER NOT NULL DEFAULT 1 CHECK (notify_open IN (0, 1));
ALTER TABLE duty_types ADD COLUMN adults_only INTEGER NOT NULL DEFAULT 0 CHECK (adults_only IN (0, 1));

ALTER TABLE duty_template_items ADD COLUMN helper_mode TEXT NOT NULL DEFAULT 'default' CHECK (helper_mode IN ('default', 'teams', 'rotate'));
ALTER TABLE duty_template_items ADD COLUMN helper_teams TEXT;

ALTER TABLE event_duties ADD COLUMN helper_mode TEXT NOT NULL DEFAULT 'default' CHECK (helper_mode IN ('default', 'teams', 'rotate'));
ALTER TABLE event_duties ADD COLUMN helper_teams TEXT;
ALTER TABLE event_duties ADD COLUMN rotate_team_id INTEGER REFERENCES teams (id) ON DELETE SET NULL;
ALTER TABLE event_duties ADD COLUMN rotate_notified INTEGER;

-- Blocks with helpers from other teams ("help out" list, rotation): few rows, so the lists read only these
CREATE INDEX event_duties_helper_from ON event_duties (duty_type_id) WHERE helper_mode <> 'default';
