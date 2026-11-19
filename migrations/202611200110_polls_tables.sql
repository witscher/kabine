-- Polls module (modules/polls/README.md): choice, scheduling and orders.
-- team_id: a team or group; NULL = the whole club (admins only, all teams, no groups).
-- Who votes is in poll_voters, synced hourly while a poll runs: one unit per person or per family (unit_id, for
-- families one person of the family as the anchor) and the persons who may vote for that unit.
-- The season change deletes every poll (worker hook seasonChange); not in the export (exportExcluded).

CREATE TABLE polls (
  id             INTEGER PRIMARY KEY,
  team_id        INTEGER REFERENCES teams (id) ON DELETE CASCADE,
  created_by     INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('choice', 'schedule', 'order')),
  title          TEXT NOT NULL,
  description    TEXT,
  multiple       INTEGER NOT NULL DEFAULT 0 CHECK (multiple IN (0, 1)),
  anonymous      INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  results        TEXT NOT NULL DEFAULT 'always' CHECK (results IN ('always', 'after')),
  per_family     INTEGER NOT NULL DEFAULT 0 CHECK (per_family IN (0, 1)),
  who_players    INTEGER NOT NULL DEFAULT 0 CHECK (who_players IN (0, 1)),
  who_parents    INTEGER NOT NULL DEFAULT 0 CHECK (who_parents IN (0, 1)),
  who_coaches    INTEGER NOT NULL DEFAULT 0 CHECK (who_coaches IN (0, 1)),
  ends_at        TEXT NOT NULL,                 -- local time in the club's time zone 'YYYY-MM-DDTHH:MM'
  closed_at      TEXT,
  reminded_at    TEXT,
  -- Cache versions (worker/lib/cache.ts) the voters were last synced with: unchanged teams and parent links, no sync
  voters_synced  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind <> 'order' OR anonymous = 0)
);
CREATE INDEX polls_team ON polls (team_id);
CREATE INDEX polls_ends ON polls (ends_at);

CREATE TABLE poll_options (
  id          INTEGER PRIMARY KEY,
  poll_id     INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  sort        INTEGER NOT NULL,
  label       TEXT NOT NULL,
  -- scheduling: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'
  starts_at   TEXT,
  -- orders: price in cents and sizes as a JSON list (NULL: no sizes)
  price_cents INTEGER,
  sizes       TEXT
);
CREATE INDEX poll_options_poll ON poll_options (poll_id);

-- is_member: belongs to the unit (named in it); can_vote: may vote for it (e.g. parents for their child)
CREATE TABLE poll_voters (
  poll_id   INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  unit_id   INTEGER NOT NULL,
  person_id INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  is_member INTEGER NOT NULL CHECK (is_member IN (0, 1)),
  can_vote  INTEGER NOT NULL CHECK (can_vote IN (0, 1)),
  PRIMARY KEY (poll_id, unit_id, person_id)
);
CREATE INDEX poll_voters_person ON poll_voters (person_id, can_vote);

-- The vote of a unit (an empty order counts as voted too). Orders: order number for the bank reference, confirmed
-- amount (creator, admins) and the amount the family reported as paid.
CREATE TABLE poll_ballots (
  poll_id        INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  unit_id        INTEGER NOT NULL,
  voted_by       INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  updated_at     TEXT NOT NULL,
  order_no       INTEGER,
  paid_at        TEXT,
  paid_cents     INTEGER,
  reported_cents INTEGER,
  reported_at    TEXT,
  reported_by    INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  PRIMARY KEY (poll_id, unit_id)
);

-- value: choice 1; scheduling 2 yes, 1 maybe, 0 no; orders the quantity
CREATE TABLE poll_answers (
  poll_id   INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  unit_id   INTEGER NOT NULL,
  option_id INTEGER NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
  size      TEXT NOT NULL DEFAULT '',
  value     INTEGER NOT NULL,
  PRIMARY KEY (poll_id, unit_id, option_id, size)
);

-- Product photo per item of an order. Like profile pictures in D1 (not R2 or Cloudflare Images, which need extra
-- setup or a paid plan): shrunk on the device to at most 800 px, about 50 to 150 KB each. Gone with the item.
CREATE TABLE poll_option_images (
  option_id   INTEGER PRIMARY KEY REFERENCES poll_options (id) ON DELETE CASCADE,
  mime        TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg')),
  image       BLOB NOT NULL,
  version     INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES persons (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Orders someone chose to ignore: no card on the start page, no dot, no app icon count, no reminder for that person.
-- Per person, not per family: the other parent still sees the order.
CREATE TABLE poll_ignores (
  poll_id    INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, person_id)
);
