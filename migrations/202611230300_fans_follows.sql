-- Fans module (modules/fans/README.md): every account may follow other teams of the club and sees their games (game
-- data only, no names, no squad). Per account, not per person: a parent and a child with their own access follow
-- independently. Nobody else sees whom someone follows.
-- Follows survive the season change (the teams stay, people are reassigned); a deleted team or account takes them
-- along. In the export and the restore (category memberships / people), as a club's backup.

CREATE TABLE fan_follows (
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  team_id    INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (account_id, team_id)
);
-- Push to the fans of a game starts from its teams
CREATE INDEX fan_follows_team ON fan_follows (team_id);

-- "Home games only": one row per account that switched it on; without a row all games. For the list, the push and
-- the calendar, not for the view of all games of the club.
CREATE TABLE fan_home_only (
  account_id INTEGER PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Personal calendar: "Games as a fan", one row per account that ticked it. Off by default, also for calendar links
-- made before, so nobody suddenly finds other teams' games in their calendar. Not in the export (like the calendar
-- links themselves).
CREATE TABLE fan_calendar (
  account_id INTEGER PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
