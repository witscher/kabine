-- Qualifications instead of a youth referee role (docs/dev/design.md, Qualifications): a duty type that needs prior
-- knowledge says who approves it, the person in the profile ('self', skill_consents as before) or an admin ('admin',
-- skill_grants per person, also for children without an account). The youth referee role becomes the admin
-- qualification of the youth referee duty type; links, the automatic group and the duties every home game of an age
-- group gets follow qualifications. Additive: the previous release keeps reading referees, referee_links,
-- teams.auto_members and age_classes.youth_referee, which are dropped in a later release (migrations/README.md).

ALTER TABLE duty_types ADD COLUMN skill_grant TEXT NOT NULL DEFAULT 'self' CHECK (skill_grant IN ('self', 'admin'));

CREATE TABLE skill_grants (
  person_id    INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  duty_type_id INTEGER NOT NULL REFERENCES duty_types (id) ON DELETE CASCADE,
  granted_by   INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  granted_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (person_id, duty_type_id)
);
CREATE INDEX skill_grants_type ON skill_grants (duty_type_id);

-- Links that grant a qualification (hashed, 30 days)
CREATE TABLE skill_grant_links (
  id           INTEGER PRIMARY KEY,
  duty_type_id INTEGER NOT NULL REFERENCES duty_types (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_by   INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);

-- Duty types every home game of an age group gets, regardless of the team's helper plan
CREATE TABLE age_class_duties (
  age_class_id INTEGER NOT NULL REFERENCES age_classes (id) ON DELETE CASCADE,
  duty_type_id INTEGER NOT NULL REFERENCES duty_types (id) ON DELETE CASCADE,
  PRIMARY KEY (age_class_id, duty_type_id)
);

-- Group whose members are everyone with this qualification
ALTER TABLE teams ADD COLUMN auto_skill INTEGER REFERENCES duty_types (id) ON DELETE SET NULL;

-- The youth referee role becomes the admin qualification of the youth referee duty type
UPDATE duty_types SET skill_grant = 'admin' WHERE who_referees = 1;
INSERT OR IGNORE INTO skill_grants (person_id, duty_type_id, granted_by, granted_at)
  SELECT r.person_id, dt.id, r.added_by, r.created_at FROM referees r JOIN duty_types dt ON dt.who_referees = 1 AND dt.event_id IS NULL;
INSERT INTO skill_grant_links (duty_type_id, token_hash, created_by, created_at, expires_at, revoked_at)
  SELECT dt.id, l.token_hash, l.created_by, l.created_at, l.expires_at, l.revoked_at
    FROM referee_links l JOIN duty_types dt ON dt.id = (SELECT min(id) FROM duty_types WHERE who_referees = 1 AND event_id IS NULL);
-- Only where the youth referee module was on (default on); a club that had switched it off keeps the duty type archived
INSERT OR IGNORE INTO age_class_duties (age_class_id, duty_type_id)
  SELECT ac.id, dt.id FROM age_classes ac JOIN duty_types dt ON dt.who_referees = 1 AND dt.event_id IS NULL AND dt.archived = 0
   WHERE ac.youth_referee = 1
     AND COALESCE((SELECT json_extract(value, '$.modules.youthReferees') FROM app_meta WHERE key = 'club'), 1) = 1;
UPDATE duty_types SET archived = 1
 WHERE who_referees = 1 AND event_id IS NULL
   AND COALESCE((SELECT json_extract(value, '$.modules.youthReferees') FROM app_meta WHERE key = 'club'), 1) = 0;
UPDATE teams SET auto_skill = (SELECT min(id) FROM duty_types WHERE who_referees = 1 AND event_id IS NULL) WHERE auto_members = 'referees';
