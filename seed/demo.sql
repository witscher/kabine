-- Demo data for local development and the public demo. All names are invented.
--
-- Not for a real installation: there the setup wizard creates season, age classes and teams.
-- Running it twice changes nothing (marker 'demo_v1' in app_meta).
--
-- Local: npm run db:reset:local (migrations and this file)

INSERT INTO seasons (id, name, starts_on, ends_on, is_current)
SELECT 1, '2026/27', '2026-07-01', '2027-06-30', 1
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO age_classes (season_id, code, name, gender, rank, is_youth, birth_year_min, birth_year_max)
SELECT * FROM (VALUES
  (1, 'Minis', 'Minis', 'x', 1, 1, 2018, 2020),
  (1, 'gE', 'gemischte E-Jugend', 'x', 2, 1, 2016, 2017),
  (1, 'wD', 'weibliche D-Jugend', 'w', 3, 1, 2014, 2015),
  (1, 'mD', 'männliche D-Jugend', 'm', 3, 1, 2014, 2015),
  (1, 'wC', 'weibliche C-Jugend', 'w', 4, 1, 2012, 2013),
  (1, 'mC', 'männliche C-Jugend', 'm', 4, 1, 2012, 2013),
  (1, 'wB', 'weibliche B-Jugend', 'w', 5, 1, 2010, 2011),
  (1, 'mB', 'männliche B-Jugend', 'm', 5, 1, 2010, 2011),
  (1, 'wA', 'weibliche A-Jugend', 'w', 6, 1, 2008, 2009),
  (1, 'mA', 'männliche A-Jugend', 'm', 6, 1, 2008, 2009),
  (1, 'F', 'Frauen', 'w', 7, 0, NULL, 2007),
  (1, 'M', 'Männer', 'm', 7, 0, NULL, 2007)
) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO locations (id, name, address, kind)
SELECT * FROM (VALUES
  (1, 'Sporthalle Musterstadt', 'Hallenweg 1, 12345 Musterstadt', 'hall'),
  (2, 'Schulturnhalle Am Park', 'Parkstraße 5, 12345 Musterstadt', 'hall')
) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO teams (id, name, age_class_code, level)
SELECT * FROM (VALUES
  (1, 'wD', 'wD', 1),
  (2, 'mC', 'mC', 1),
  (3, 'Damen 1', 'F', 1)
) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO persons (id, first_name, last_name, birth_year)
SELECT * FROM (VALUES
  -- coaches
  (101, 'Clara', 'Coach', 1988),
  (102, 'Tom', 'Trainer', 1979),
  (103, 'Hanna', 'Hilfreich', 1995),
  -- wD
  (201, 'Mia', 'Muster', 2014),
  (202, 'Lea', 'Beispiel', 2014),
  (203, 'Emma', 'Ballwurf', 2015),
  (204, 'Sofia', 'Sprung', 2015),
  (205, 'Lina', 'Linkshand', 2014),
  (206, 'Ida', 'Isarweg', 2015),
  (207, 'Paula', 'Pass', 2014),
  (208, 'Nele', 'Netz', 2015),
  -- mC
  (301, 'Ben', 'Block', 2012),
  (302, 'Paul', 'Prell', 2013),
  (303, 'Finn', 'Flügel', 2012),
  (304, 'Leon', 'Lauf', 2013),
  (305, 'Noah', 'Nachwurf', 2012),
  (306, 'Elias', 'Eckwurf', 2013),
  (307, 'Jonas', 'Joker', 2012),
  -- Damen 1
  (401, 'Julia', 'Kreis', 1998),
  (402, 'Sarah', 'Rückraum', 2000),
  (403, 'Laura', 'Tor', 1996),
  (404, 'Anna', 'Abwehr', 2001),
  (405, 'Marie', 'Mitte', 1999),
  (406, 'Kim', 'Konter', 2003),
  -- parents
  (501, 'Petra', 'Muster', NULL),
  (502, 'Stefan', 'Block', NULL)
) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO team_memberships (person_id, team_id, role)
SELECT * FROM (VALUES
  (101, 1, 'coach'), (103, 1, 'coach'), (102, 2, 'coach'), (101, 3, 'coach'),
  (201, 1, 'player'), (202, 1, 'player'), (203, 1, 'player'), (204, 1, 'player'),
  (205, 1, 'player'), (206, 1, 'player'), (207, 1, 'player'), (208, 1, 'player'),
  (301, 2, 'player'), (302, 2, 'player'), (303, 2, 'player'), (304, 2, 'player'),
  (305, 2, 'player'), (306, 2, 'player'), (307, 2, 'player'),
  (401, 3, 'player'), (402, 3, 'player'), (403, 3, 'player'), (404, 3, 'player'),
  (405, 3, 'player'), (406, 3, 'player')
) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO guardianships (guardian_id, child_id)
SELECT * FROM (VALUES (501, 201), (502, 301)) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO training_plans (id, team_id, name, kind, valid_from, valid_to)
SELECT * FROM (VALUES
  (1, 1, 'Trainingsplan 2026/27', 'regular', '2026-07-01', '2027-06-30'),
  (2, 2, 'Trainingsplan 2026/27', 'regular', '2026-07-01', '2027-06-30'),
  (3, 3, 'Trainingsplan 2026/27', 'regular', '2026-07-01', '2027-06-30')
) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO training_rules (id, plan_id, weekday, starts_at, ends_at, location_id)
SELECT * FROM (VALUES
  (1, 1, 2, '17:00', '18:30', 1),
  (2, 1, 4, '17:00', '18:30', 2),
  (3, 2, 1, '17:30', '19:00', 1),
  (4, 2, 3, '17:30', '19:00', 1),
  (5, 3, 2, '19:30', '21:00', 1),
  (6, 3, 5, '19:00', '20:30', 1)
) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO rule_teams (rule_id, team_id)
SELECT * FROM (VALUES (1, 1), (2, 1), (3, 2), (4, 2), (5, 3), (6, 3)) AS v
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT INTO app_meta (key, value)
SELECT 'club', '{"name":"SV Musterstadt 1900 Handball","shortName":"SV Musterstadt","abbr":"SVM","colors":{"primary":"#123a63","accent":"#f2c230"},"logoVersion":null,"privacyUrl":null,"privacyText":null,"contact":null,"setupDone":true,"ownerPersonId":null}'
WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'demo_v1');

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('demo_v1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
