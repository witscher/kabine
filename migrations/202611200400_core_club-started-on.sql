-- Help → What's new lists the releases since the club started with the app (club profile `startedOn`,
-- shared/club.ts). New installations set it when the setup wizard is completed; existing ones take the
-- day of their first access, which is when the first admin set the installation up.
UPDATE app_meta
   SET value = json_set(value, '$.startedOn', (SELECT substr(min(created_at), 1, 10) FROM accounts))
 WHERE key = 'club'
   AND json_extract(value, '$.startedOn') IS NULL
   AND EXISTS (SELECT 1 FROM accounts);
