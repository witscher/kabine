-- Home game day module (modules/gameday/README.md): on a day when many teams of the club play at home, the people
-- involved get a push the day before, a card on home and a page of the day.

-- Days whose push went out, so it goes out once per day (claimed with INSERT OR IGNORE before sending). Only a date, no
-- personal data. Markers older than a week are deleted by the hourly run; not in the export.
CREATE TABLE gameday_sent (
  day     TEXT PRIMARY KEY,                                        -- 'YYYY-MM-DD', the home game day
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The days come from the cache per Worker instance (worker/lib/cache.ts), version "duties", which already follows games,
-- their start, home/away, teams and team kinds. The day rule also depends on cancellations, the card names the hall:
-- these changes bump the version too, so a cancelled game never counts from a stale cache.
CREATE TRIGGER gameday_cache_ev_upd AFTER UPDATE OF cancelled_at, location_id ON events WHEN NEW.kind = 'game'
  BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;
CREATE TRIGGER gameday_cache_loc_upd AFTER UPDATE OF name ON locations
  BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'duties'; END;

-- The settings (app_meta key "gameday") are cached with version "ref", bumped on every change, also made directly in D1.
CREATE TRIGGER gameday_cache_settings_ins AFTER INSERT ON app_meta WHEN NEW.key = 'gameday'
  BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'ref'; END;
CREATE TRIGGER gameday_cache_settings_upd AFTER UPDATE ON app_meta WHEN NEW.key = 'gameday' OR OLD.key = 'gameday'
  BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'ref'; END;
CREATE TRIGGER gameday_cache_settings_del AFTER DELETE ON app_meta WHEN OLD.key = 'gameday'
  BEGIN UPDATE cache_versions SET version = version + 1 WHERE name = 'ref'; END;
