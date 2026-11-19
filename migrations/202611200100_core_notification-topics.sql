-- Notification topics are checked in code (CORE_NOTIFICATION_TOPICS and the modules' notificationTopics, worker/routes/parents.ts),
-- so a module can bring its own topic (polls) without a core migration each time. The table is rebuilt without the CHECK
-- on topic; columns and rows stay as they are, so the previous release keeps working.
CREATE TABLE notification_settings_new (
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  topic      TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 40),
  enabled    INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (account_id, person_id, topic)
);
INSERT INTO notification_settings_new (account_id, person_id, topic, enabled)
  SELECT account_id, person_id, topic, enabled FROM notification_settings;
DROP TABLE notification_settings;
ALTER TABLE notification_settings_new RENAME TO notification_settings;
