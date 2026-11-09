-- Whole team at games (docs/dev/design.md, Whole team at games): every active player of the team takes part in its
-- games and declines if they cannot come; the nomination only decides who plays. Per team, off by default (as before:
-- only nominated players take part). Additive: the previous release ignores the column.
ALTER TABLE teams ADD COLUMN game_all_players INTEGER NOT NULL DEFAULT 0 CHECK (game_all_players IN (0, 1));
