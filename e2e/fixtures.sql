-- Testdaten für die Ende-zu-Ende-Tests. Alle Namen sind erfunden.
INSERT INTO seasons (id, name, starts_on, ends_on, is_current) VALUES (1, '2026/27', '2026-07-01', '2027-06-30', 1);
INSERT INTO age_classes (season_id, code, name, rank, is_youth, birth_year_min, birth_year_max, game_minutes, youth_referee) VALUES
  (1, 'wD', 'weibliche D-Jugend', 2, 1, 2014, 2015, 90, 1),
  (1, 'wC', 'weibliche C-Jugend', 3, 1, 2012, 2013, 90, 1);
-- No admin yet: the first test sets up Ada Admin like a fresh installation from the deploy button
INSERT INTO persons (id, first_name, last_name) VALUES (2, 'Theo', 'Trainer');
INSERT INTO persons (id, first_name, last_name, birth_year) VALUES
  (11, 'Ida', 'Probe', 2014),
  (12, 'Jana', 'Probe', 2015),
  (13, 'Kim', 'Probe', 2015);
INSERT INTO teams (id, name, age_class_code, gender) VALUES (1, 'wT', 'wD', 'f');
INSERT INTO team_memberships (person_id, team_id, role) VALUES (2, 1, 'coach'), (11, 1, 'player'), (12, 1, 'player'), (13, 1, 'player');
INSERT INTO locations (id, name, kind) VALUES (1, 'Testhalle', 'hall');
INSERT INTO training_plans (id, team_id, name, kind, valid_from, valid_to) VALUES (1, 1, 'Testplan', 'regular', '2020-01-01', '2099-12-31');
-- Jeden Tag Training, damit es immer einen nächsten Termin gibt
INSERT INTO training_rules (id, plan_id, weekday, starts_at, ends_at, location_id) VALUES
  (1, 1, 1, '23:30', '23:55', 1), (2, 1, 2, '23:30', '23:55', 1), (3, 1, 3, '23:30', '23:55', 1),
  (4, 1, 4, '23:30', '23:55', 1), (5, 1, 5, '23:30', '23:55', 1), (6, 1, 6, '23:30', '23:55', 1),
  (7, 1, 7, '23:30', '23:55', 1);
INSERT INTO rule_teams (rule_id, team_id) VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1), (7, 1);
-- Ein vergangener Termin für „fehlt unentschuldigt“
INSERT INTO events (id, kind, title, starts_at, ends_at, location_id) VALUES
  (9001, 'special', 'Vergangenes Turnier', strftime('%Y-%m-%dT10:00', 'now', '-3 days'), strftime('%Y-%m-%dT12:00', 'now', '-3 days'), 1);
INSERT INTO event_teams (event_id, team_id) VALUES (9001, 1);
