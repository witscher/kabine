-- Cache per Worker instance (worker/lib/cache.ts, docs/dev/decisions.md "Read load"): data that rarely changes stays
-- in memory while its version number is the same. Triggers bump the versions on every change, also on changes made
-- directly in D1, so the cache is never stale. The start value is random, so a database set up anew never matches an
-- old cached state.
--   ref:    teams, age classes, seasons, duty types
--   roster: memberships, parent links, names and active state of persons
--   duties: what generating the helper duties of games depends on (games, teams, templates, required duties)
-- Teams only on columns the cached data or the duty generation reads: the schedule sync writes fixture_synced_at,
-- fixture_error and fixture_claimed_at every hour.
CREATE TABLE cache_versions (
  name    TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);
INSERT INTO cache_versions (name, version) VALUES
  ('ref', abs(random()) % 1000000000),
  ('roster', abs(random()) % 1000000000),
  ('duties', abs(random()) % 1000000000);

-- ref (and duties)
CREATE TRIGGER cache_ref_teams_ins AFTER INSERT ON teams BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_teams_del AFTER DELETE ON teams BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_teams_upd AFTER UPDATE OF name, age_class_code, level, decline_hours_training, decline_hours_game, max_squad,
  fixture_connector, fixture_source, parents_enabled, auto_squad, helper_plan, show_responses, kind, home_template_id, away_template_id, gender,
  game_all_players, child_account, child_respond, child_chat, child_help
  ON teams BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_age_ins AFTER INSERT ON age_classes BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_age_del AFTER DELETE ON age_classes BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_age_upd AFTER UPDATE ON age_classes BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_seasons_ins AFTER INSERT ON seasons BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_seasons_del AFTER DELETE ON seasons BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_seasons_upd AFTER UPDATE ON seasons BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_types_ins AFTER INSERT ON duty_types BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_types_del AFTER DELETE ON duty_types BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
CREATE TRIGGER cache_ref_types_upd AFTER UPDATE ON duty_types BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;

-- roster
CREATE TRIGGER cache_roster_tm_ins AFTER INSERT ON team_memberships BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;
CREATE TRIGGER cache_roster_tm_del AFTER DELETE ON team_memberships BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;
CREATE TRIGGER cache_roster_tm_upd AFTER UPDATE ON team_memberships BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;
CREATE TRIGGER cache_roster_g_ins AFTER INSERT ON guardianships BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;
CREATE TRIGGER cache_roster_g_del AFTER DELETE ON guardianships BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;
CREATE TRIGGER cache_roster_g_upd AFTER UPDATE ON guardianships BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;
CREATE TRIGGER cache_roster_p_del AFTER DELETE ON persons BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;
CREATE TRIGGER cache_roster_p_upd AFTER UPDATE OF first_name, last_name, is_active, is_former ON persons
  BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'roster'; END;

-- duties (besides teams, age classes, seasons and duty types above)
CREATE TRIGGER cache_duties_ev_ins AFTER INSERT ON events WHEN NEW.kind = 'game' BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_ev_upd AFTER UPDATE OF kind, starts_at, is_home, duties_anchor, duties_generated ON events
  BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_et_ins AFTER INSERT ON event_teams BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_et_del AFTER DELETE ON event_teams BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_tpl_ins AFTER INSERT ON duty_templates BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_tpl_del AFTER DELETE ON duty_templates BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_tpl_upd AFTER UPDATE ON duty_templates BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_item_ins AFTER INSERT ON duty_template_items BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_item_del AFTER DELETE ON duty_template_items BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_item_upd AFTER UPDATE ON duty_template_items BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_acd_ins AFTER INSERT ON age_class_duties BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER cache_duties_acd_del AFTER DELETE ON age_class_duties BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
