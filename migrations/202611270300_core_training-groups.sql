-- Training group (docs/dev/decisions.md, "Training groups"): the special events of a group such as the goalkeeper
-- training count as trainings in the event overview (chip "Training" instead of "Other"). Off for existing groups.
ALTER TABLE teams ADD COLUMN training_group INTEGER NOT NULL DEFAULT 0 CHECK (training_group IN (0, 1));

-- The cached team info (cachedTeamInfo) reads the column, so a change of it bumps the cache version
DROP TRIGGER cache_ref_teams_upd;
CREATE TRIGGER cache_ref_teams_upd AFTER UPDATE OF name, age_class_code, level, decline_hours_training, decline_hours_game, max_squad,
  fixture_connector, fixture_source, parents_enabled, auto_squad, helper_plan, show_responses, kind, home_template_id, away_template_id, gender,
  game_all_players, child_account, child_respond, child_chat, child_help, training_group
  ON teams BEGIN UPDATE cache_versions SET version = version + 1 WHERE name IN ('ref', 'duties'); END;
