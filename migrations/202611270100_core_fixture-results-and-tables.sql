-- Game schedules that sync by themselves (docs/dev/connectors.md): after a game without a result the coach's device
-- syncs again, at most twice per game; and the league table from the same fetch.

-- Tries to fetch the result of a game by itself (worker/domain/fixtures.ts, resultDueGames)
ALTER TABLE events ADD COLUMN result_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN result_tried_at TEXT;

-- League table of a team as of its last sync (public data of the source; connector: the module it came from)
CREATE TABLE league_tables (
  team_id     INTEGER PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  connector   TEXT NOT NULL,
  league_name TEXT,
  rows        TEXT NOT NULL,
  comment     TEXT,
  fetched_at  TEXT NOT NULL
);
