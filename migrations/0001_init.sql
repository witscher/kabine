-- Kabine: initial schema. Until the first release this file is edited directly;
-- after that, every change is a new migration.

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE seasons (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,              -- '2026/27'
  starts_on  TEXT NOT NULL,                     -- 'YYYY-MM-DD'
  ends_on    TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE age_classes (
  id             INTEGER PRIMARY KEY,
  season_id      INTEGER NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
  code           TEXT NOT NULL,                 -- 'wD', 'mA', 'gE', 'F', 'M'
  name           TEXT NOT NULL,                 -- 'weibliche D-Jugend'
  gender         TEXT NOT NULL CHECK (gender IN ('w', 'm', 'x')),
  rank           INTEGER NOT NULL,              -- aufsteigend von jung nach alt, Aktive am höchsten
  is_youth       INTEGER NOT NULL DEFAULT 1 CHECK (is_youth IN (0, 1)),
  birth_year_min INTEGER,                       -- ältester zulässiger Jahrgang, NULL = offen
  birth_year_max INTEGER,                       -- jüngster zulässiger Jahrgang, NULL = offen
  UNIQUE (season_id, code)
);
CREATE TABLE persons (
  id                INTEGER PRIMARY KEY,
  first_name        TEXT NOT NULL,
  last_name         TEXT,                       -- darf zunächst fehlen (Seed)
  birth_year        INTEGER CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  active_changed_at TEXT,
  active_changed_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  is_admin          INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  admin_email       TEXT UNIQUE,                -- nur für Admins, sonst keine Kontaktdaten
  is_former         INTEGER NOT NULL DEFAULT 0 CHECK (is_former IN (0, 1)),
  left_at           TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (admin_email IS NULL OR is_admin = 1)
);
CREATE TABLE accounts (
  id               INTEGER PRIMARY KEY,
  person_id        INTEGER NOT NULL UNIQUE REFERENCES persons (id) ON DELETE CASCADE,
  webauthn_user_id TEXT NOT NULL UNIQUE,        -- zufälliges User-Handle (base64url)
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  disabled_at      TEXT
, email TEXT, email_verified_at TEXT, coach_mode INTEGER NOT NULL DEFAULT 0 CHECK (coach_mode IN (0, 1)), last_seen_on TEXT);
CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,                -- Credential-ID (base64url)
  account_id   INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  public_key   BLOB NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,                            -- JSON-Array
  device_type  TEXT,
  backed_up    INTEGER NOT NULL DEFAULT 0,
  label        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                -- SHA-256 des Session-Tokens (hex)
  account_id   INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,                   -- Login-Zeitpunkt, Basis der absoluten Obergrenze
  expires_at   TEXT NOT NULL,
  extended_at  TEXT NOT NULL,
  device_label TEXT
);
CREATE TABLE guardianships (
  guardian_id INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  child_id    INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (guardian_id, child_id),
  CHECK (guardian_id <> child_id)
);
CREATE TABLE child_permissions (
  child_id              INTEGER PRIMARY KEY REFERENCES persons (id) ON DELETE CASCADE,
  may_accept            INTEGER NOT NULL DEFAULT 1 CHECK (may_accept IN (0, 1)),
  may_decline           INTEGER NOT NULL DEFAULT 1 CHECK (may_decline IN (0, 1)),
  may_read_chat         INTEGER NOT NULL DEFAULT 1 CHECK (may_read_chat IN (0, 1)),
  may_write_chat        INTEGER NOT NULL DEFAULT 1 CHECK (may_write_chat IN (0, 1)),
  may_answer_help       INTEGER NOT NULL DEFAULT 1 CHECK (may_answer_help IN (0, 1)),
  updated_at            TEXT
);
CREATE TABLE child_permission_log (
  id         INTEGER PRIMARY KEY,
  child_id   INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
  permission TEXT NOT NULL,
  value      INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE teams (
  id                     INTEGER PRIMARY KEY,
  name                   TEXT NOT NULL UNIQUE,  -- 'wD', 'wC1'
  age_class_code         TEXT NOT NULL,         -- verweist auf age_classes.code der laufenden Saison
  level                  INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1), -- 1 = 1. Mannschaft
  decline_hours_training INTEGER NOT NULL DEFAULT 6 CHECK (decline_hours_training BETWEEN 0 AND 168),
  decline_hours_game     INTEGER NOT NULL DEFAULT 6 CHECK (decline_hours_game BETWEEN 0 AND 168),
  max_squad              INTEGER NOT NULL DEFAULT 14 CHECK (max_squad BETWEEN 1 AND 40),
  h4a_org_id             INTEGER,
  h4a_league_id          INTEGER,
  h4a_team_id            INTEGER,
  h4a_imported_at        TEXT,
  h4a_import_error       TEXT,
  h4a_claimed_at         TEXT,                  -- Abruf läuft gerade auf einem Trainergerät
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, parents_enabled INTEGER NOT NULL DEFAULT 1 CHECK (parents_enabled IN (0, 1)), auto_squad INTEGER NOT NULL DEFAULT 0 CHECK (auto_squad IN (0, 1)), helper_plan INTEGER NOT NULL DEFAULT 0 CHECK (helper_plan IN (0, 1)), show_responses INTEGER NOT NULL DEFAULT 0 CHECK (show_responses IN (0, 1)), kind TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('team', 'group')), auto_members TEXT CHECK (auto_members IS NULL OR auto_members = 'referees'), home_template_id INTEGER REFERENCES duty_templates (id) ON DELETE SET NULL, away_template_id INTEGER REFERENCES duty_templates (id) ON DELETE SET NULL);
CREATE TABLE team_memberships (
  person_id        INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  team_id          INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('player', 'coach', 'helper')),
  helper_trainings INTEGER NOT NULL DEFAULT 0 CHECK (helper_trainings IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (person_id, team_id, role)
);
CREATE TABLE core_squad (
  team_id   INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, person_id)
);
CREATE TABLE locations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  map_url    TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('hall', 'custom', 'external')),
  h4a_gym_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE training_plans (
  id            INTEGER PRIMARY KEY,
  team_id       INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('regular', 'holiday')),
  valid_from    TEXT NOT NULL,                  -- 'YYYY-MM-DD'
  valid_to      TEXT NOT NULL,
  decline_hours INTEGER CHECK (decline_hours IS NULL OR decline_hours BETWEEN 0 AND 168),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), holiday_period_id INTEGER REFERENCES holiday_periods (id) ON DELETE SET NULL,
  CHECK (valid_from <= valid_to)
);
CREATE TABLE training_rules (
  id          INTEGER PRIMARY KEY,
  plan_id     INTEGER NOT NULL REFERENCES training_plans (id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1 = Montag
  starts_at   TEXT NOT NULL,                    -- 'HH:MM'
  ends_at     TEXT NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations (id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (starts_at < ends_at)
);
CREATE TABLE rule_teams (
  rule_id INTEGER NOT NULL REFERENCES training_rules (id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, team_id)
);
CREATE TABLE events (
  id                 INTEGER PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('training', 'game', 'special')),
  title              TEXT,
  starts_at          TEXT NOT NULL,             -- lokale Zeit Europe/Berlin
  ends_at            TEXT,
  location_id        INTEGER REFERENCES locations (id) ON DELETE SET NULL,
  notes              TEXT,
  rule_id            INTEGER REFERENCES training_rules (id) ON DELETE SET NULL,
  rule_date          TEXT,                      -- ursprüngliches Datum aus der Regel
  is_detached        INTEGER NOT NULL DEFAULT 0 CHECK (is_detached IN (0, 1)), -- manuell geändert
  club_wide          INTEGER NOT NULL DEFAULT 0 CHECK (club_wide IN (0, 1)),
  decline_hours      INTEGER CHECK (decline_hours IS NULL OR decline_hours BETWEEN 0 AND 168),
  cancelled_at       TEXT,
  cancelled_by       INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  cancel_reason      TEXT,
  reminder_sent_at   TEXT,
  -- Spiele (Import handball4all)
  h4a_game_id        TEXT UNIQUE,
  h4a_game_no        TEXT,
  home_team          TEXT,
  guest_team         TEXT,
  is_home            INTEGER CHECK (is_home IS NULL OR is_home IN (0, 1)),
  home_goals         INTEGER,
  guest_goals        INTEGER,
  -- Manuelle Ergänzungen der Trainer, vom Import nie überschrieben
  meeting_point      TEXT,
  meeting_time       TEXT,                      -- 'HH:MM'
  coach_notes        TEXT,
  squad_published_at TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, squad_manual INTEGER NOT NULL DEFAULT 0 CHECK (squad_manual IN (0, 1)), game_reminder_sent_at TEXT, duty_hidden INTEGER NOT NULL DEFAULT 0 CHECK (duty_hidden IN (0, 1)), attendance_recorded_at TEXT, duties_anchor TEXT, duties_generated INTEGER NOT NULL DEFAULT 0 CHECK (duties_generated BETWEEN 0 AND 3), created_by INTEGER REFERENCES persons (id) ON DELETE SET NULL);
CREATE TABLE event_teams (
  event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  team_id  INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, team_id)
);
CREATE TABLE responses (
  event_id     INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id    INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('yes', 'no')),
  reason       TEXT,
  is_late      INTEGER NOT NULL DEFAULT 0 CHECK (is_late IN (0, 1)),
  by_account   INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
  by_person    INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  responded_at TEXT NOT NULL,
  PRIMARY KEY (event_id, person_id)
);
CREATE TABLE nominations (
  event_id   INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  is_helper  INTEGER NOT NULL DEFAULT 0 CHECK (is_helper IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, person_id)
);
CREATE TABLE help_requests (
  id           INTEGER PRIMARY KEY,
  event_id     INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id    INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  team_id      INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE, -- anfragende Mannschaft
  requested_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn')),
  answered_by  INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
  answered_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (event_id, person_id)
);
CREATE TABLE standing_absences (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  rule_id    INTEGER NOT NULL REFERENCES training_rules (id) ON DELETE CASCADE,
  valid_from TEXT,
  valid_to   TEXT,
  reason     TEXT,
  created_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (person_id, rule_id)
);
CREATE TABLE invites (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('player', 'parent', 'personal')),
  nonce           TEXT NOT NULL UNIQUE,
  token_hash      TEXT NOT NULL UNIQUE,
  team_id         INTEGER REFERENCES teams (id) ON DELETE CASCADE,
  person_id       INTEGER REFERENCES persons (id) ON DELETE CASCADE,
  revoke_existing INTEGER NOT NULL DEFAULT 0 CHECK (revoke_existing IN (0, 1)),
  created_by      INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  used_at         TEXT,
  CHECK ((kind IN ('player', 'parent') AND team_id IS NOT NULL) OR (kind = 'personal' AND person_id IS NOT NULL))
);
CREATE TABLE push_subscriptions (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  device_label TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);
CREATE TABLE chat_optouts (
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  team_id    INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (account_id, team_id)
);
CREATE TABLE chat_mutes (
  team_id    INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  muted_by   INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (team_id, person_id)
);
CREATE TABLE chat_state (
  team_id         INTEGER PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  last_message_id INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT
);
CREATE TABLE chat_reads (
  account_id   INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  team_id      INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, team_id)
);
CREATE TABLE email_codes (
  id          INTEGER PRIMARY KEY,
  request_id  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('login', 'verify', 'join')),
  email       TEXT NOT NULL,
  account_id  INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
  context     TEXT,
  token_hash  TEXT NOT NULL UNIQUE,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE TABLE avatars (
  person_id   INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('approved', 'pending')),
  mime        TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg')),
  image       BLOB NOT NULL,
  version     INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (person_id, status)
);
CREATE TABLE chat_mentions (
  team_id    INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (team_id, message_id, person_id)
);
CREATE TABLE duty_notifications (
  kind    TEXT NOT NULL,
  ref     TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, ref)
);
CREATE TABLE calendar_tokens (
  account_id INTEGER PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, training INTEGER NOT NULL DEFAULT 1 CHECK (training IN (0, 1)), games INTEGER NOT NULL DEFAULT 1 CHECK (games IN (0, 1)), duties INTEGER NOT NULL DEFAULT 1 CHECK (duties IN (0, 1)));
CREATE TABLE referees (
  person_id  INTEGER PRIMARY KEY REFERENCES persons (id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE referee_links (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE notification_channels (
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  topic      TEXT NOT NULL CHECK (topic IN ('duty_remind_3d', 'duty_remind_1d', 'duty_open', 'duty_coach_open', 'duty_referee_open')),
  push       INTEGER NOT NULL CHECK (push IN (0, 1)),
  mail       INTEGER NOT NULL CHECK (mail IN (0, 1)),
  PRIMARY KEY (account_id, topic)
);
CREATE TABLE holiday_periods (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  starts_on  TEXT NOT NULL,
  ends_on    TEXT NOT NULL,
  imported   INTEGER NOT NULL DEFAULT 0 CHECK (imported IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (starts_on <= ends_on)
);
CREATE TABLE unexcused_absences (
  event_id   INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  marked_by  INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  marked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, person_id)
);
CREATE TABLE attendance (
  event_id  INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  team_id   INTEGER REFERENCES teams (id) ON DELETE SET NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('training', 'game', 'special')),
  -- present: zugesagt (auch stillschweigend) und nicht als unentschuldigt markiert
  -- open: keine Rückmeldung (z. B. Aushilfe ohne Antwort)
  status    TEXT NOT NULL CHECK (status IN ('present', 'open', 'declined', 'standing', 'inactive', 'unexcused')),
  is_helper INTEGER NOT NULL DEFAULT 0 CHECK (is_helper IN (0, 1)),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), is_late INTEGER NOT NULL DEFAULT 0 CHECK (is_late IN (0, 1)),
  PRIMARY KEY (event_id, person_id)
);
CREATE TABLE season_stats (
  season_id INTEGER NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  metric    TEXT NOT NULL CHECK (metric IN (
    'training_total', 'training_present', 'training_unexcused', 'training_late',
    'game_total', 'game_present', 'game_unexcused', 'game_late',
    'duties', 'referee_duties'
  )),
  value     INTEGER NOT NULL,
  PRIMARY KEY (season_id, person_id, team_name, metric)
);
CREATE TABLE duty_types (
  id           INTEGER PRIMARY KEY,
  code         TEXT UNIQUE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  mode         TEXT NOT NULL DEFAULT 'onsite' CHECK (mode IN ('onsite', 'task')),
  who_parents  INTEGER NOT NULL DEFAULT 1 CHECK (who_parents IN (0, 1)),
  who_players  INTEGER NOT NULL DEFAULT 0 CHECK (who_players IN (0, 1)),
  who_coaches  INTEGER NOT NULL DEFAULT 0 CHECK (who_coaches IN (0, 1)),
  who_referees INTEGER NOT NULL DEFAULT 0 CHECK (who_referees IN (0, 1)),
  note_allowed INTEGER NOT NULL DEFAULT 0 CHECK (note_allowed IN (0, 1)),
  needs_skill  INTEGER NOT NULL DEFAULT 0 CHECK (needs_skill IN (0, 1)),
  event_id     INTEGER REFERENCES events (id) ON DELETE CASCADE,
  sort         INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, who_members INTEGER NOT NULL DEFAULT 0 CHECK (who_members IN (0, 1)));
CREATE TABLE duty_templates (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  default_for TEXT UNIQUE CHECK (default_for IS NULL OR default_for IN ('home', 'away')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE duty_template_items (
  id           INTEGER PRIMARY KEY,
  template_id  INTEGER NOT NULL REFERENCES duty_templates (id) ON DELETE CASCADE,
  duty_type_id INTEGER NOT NULL REFERENCES duty_types (id) ON DELETE CASCADE,
  slots        INTEGER NOT NULL DEFAULT 1 CHECK (slots BETWEEN 1 AND 20),
  before_min   INTEGER NOT NULL DEFAULT 0 CHECK (before_min BETWEEN 0 AND 600),
  after_min    INTEGER NOT NULL DEFAULT 0 CHECK (after_min BETWEEN 0 AND 600),
  task_when    TEXT NOT NULL DEFAULT 'after' CHECK (task_when IN ('before', 'after')),
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE event_duties (
  id           INTEGER PRIMARY KEY,
  event_id     INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  duty_type_id INTEGER NOT NULL REFERENCES duty_types (id) ON DELETE CASCADE,
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  slots        INTEGER NOT NULL DEFAULT 1 CHECK (slots BETWEEN 0 AND 20),
  sort         INTEGER NOT NULL DEFAULT 0,
  CHECK (ends_at >= starts_at)
);
CREATE TABLE duties (
  id            INTEGER PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  event_duty_id INTEGER NOT NULL REFERENCES event_duties (id) ON DELETE CASCADE,
  duty_type_id  INTEGER NOT NULL REFERENCES duty_types (id) ON DELETE CASCADE,
  person_id     INTEGER REFERENCES persons (id) ON DELETE CASCADE,
  child_id      INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  manual_name   TEXT CHECK (manual_name IS NULL OR length(manual_name) BETWEEN 1 AND 60),
  note          TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_by    INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((person_id IS NULL) <> (manual_name IS NULL))
);
CREATE TABLE skill_consents (
  account_id   INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  duty_type_id INTEGER NOT NULL REFERENCES duty_types (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (account_id, duty_type_id)
);
CREATE TABLE event_organizers (
  event_id   INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, person_id)
);
CREATE TABLE club_members (
  person_id  INTEGER PRIMARY KEY REFERENCES persons (id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE carpool_offers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  -- Fahrer: immer eine angelegte Person, auch ohne Zugang (Trainer trägt ein)
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  seats      INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 8),
  created_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (event_id, person_id)
);
CREATE TABLE carpool_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  -- Begleitpersonen (Elternteile), ohne Namen; Platzbedarf = 1 + companions
  companions INTEGER NOT NULL DEFAULT 0 CHECK (companions BETWEEN 0 AND 2),
  -- Gebucht bei diesem Angebot; NULL = sucht noch
  offer_id   INTEGER REFERENCES carpool_offers (id) ON DELETE SET NULL,
  booked_at  TEXT,
  created_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (event_id, player_id)
);
CREATE TABLE notification_settings (
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  topic      TEXT NOT NULL CHECK (topic IN ('events', 'reminders', 'squad', 'responses', 'chat', 'mentions', 'coach', 'carpool')),
  enabled    INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (account_id, person_id, topic)
);
DELETE FROM sqlite_sequence;
CREATE UNIQUE INDEX seasons_single_current ON seasons (is_current) WHERE is_current = 1;
CREATE INDEX passkeys_account ON passkeys (account_id);
CREATE INDEX sessions_account ON sessions (account_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
CREATE INDEX guardianships_child ON guardianships (child_id);
CREATE INDEX child_permission_log_child ON child_permission_log (child_id, changed_at);
CREATE INDEX team_memberships_team ON team_memberships (team_id, role);
CREATE INDEX training_plans_team ON training_plans (team_id);
CREATE INDEX training_rules_plan ON training_rules (plan_id);
CREATE INDEX rule_teams_team ON rule_teams (team_id);
CREATE UNIQUE INDEX events_rule_occurrence ON events (rule_id, rule_date) WHERE rule_id IS NOT NULL;
CREATE INDEX events_starts ON events (starts_at);
CREATE INDEX responses_person ON responses (person_id);
CREATE INDEX nominations_person ON nominations (person_id);
CREATE INDEX help_requests_person ON help_requests (person_id, status);
CREATE INDEX standing_absences_rule ON standing_absences (rule_id);
CREATE INDEX invites_team ON invites (team_id, kind);
CREATE INDEX push_subscriptions_account ON push_subscriptions (account_id);
CREATE INDEX accounts_email ON accounts (email);
CREATE INDEX email_codes_email ON email_codes (email, purpose);
CREATE INDEX chat_mentions_person ON chat_mentions (person_id);
CREATE INDEX holiday_periods_start ON holiday_periods (starts_on);
CREATE INDEX unexcused_absences_person ON unexcused_absences (person_id);
CREATE INDEX attendance_person ON attendance (person_id);
CREATE INDEX event_duties_event ON event_duties (event_id);
CREATE INDEX duties_event ON duties (event_id);
CREATE INDEX duties_block ON duties (event_duty_id);
CREATE UNIQUE INDEX duties_unique_person ON duties (event_duty_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX event_organizers_person ON event_organizers (person_id);
CREATE INDEX carpool_requests_offer ON carpool_requests (offer_id);
CREATE INDEX events_kind_starts ON events (kind, starts_at);
CREATE INDEX events_created_by ON events (created_by);
CREATE INDEX events_club_wide ON events (club_wide, starts_at);
CREATE INDEX duties_person_event ON duties (person_id, event_id);
CREATE INDEX duties_child ON duties (child_id);
CREATE INDEX event_teams_team ON event_teams (team_id, event_id);
-- Default duty types and templates (the setup wizard and admins adjust them)
INSERT INTO duty_types (id, code, name, mode, who_parents, who_referees, note_allowed, needs_skill, sort) VALUES
  (1, 'kuchen', 'Kuchen & Theke', 'onsite', 1, 0, 1, 0, 1),
  (2, 'zeitnehmer', 'Zeitnehmer', 'onsite', 1, 0, 0, 1, 2),
  (3, 'sekretaer', 'Sekretär', 'onsite', 1, 0, 0, 1, 3),
  (4, 'trikots', 'Trikots waschen', 'task', 1, 0, 0, 0, 4),
  (5, 'referee', 'KiHaSL/JuHaSL', 'onsite', 0, 1, 0, 0, 5);
INSERT INTO duty_templates (id, name, default_for) VALUES (1, 'Heimspiel', 'home'), (2, 'Auswärtsspiel', 'away');
INSERT INTO duty_template_items (template_id, duty_type_id, slots, before_min, after_min, task_when, sort) VALUES
  (1, 1, 2, 20, 20, 'after', 1),
  (1, 2, 1, 15, 0, 'after', 2),
  (1, 4, 1, 0, 0, 'after', 3),
  (2, 3, 1, 15, 0, 'after', 1),
  (2, 4, 1, 0, 0, 'after', 2);
