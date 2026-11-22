-- Reindeer Grand Prix: initial schema (D1 / SQLite).
-- Apply with: npx wrangler d1 migrations apply reindeer-gp [--remote]
-- Personal data is minimal: a hash of the sign-in email, a display name, and the team's college.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email_hash    TEXT UNIQUE,              -- SHA-256 of the lower-cased email; NULL once deleted
  display_name  TEXT NOT NULL,
  is_referee    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,           -- SHA-256 of the cookie token
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE api_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  scopes        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);

CREATE TABLE teams (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  college           TEXT NOT NULL,
  level             TEXT NOT NULL CHECK (level IN ('elf', 'reindeer', 'santa')),
  level_locked_at   TEXT,
  join_code         TEXT NOT NULL UNIQUE,
  hidden            INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE TABLE memberships (
  team_id    TEXT NOT NULL REFERENCES teams(id),
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id),   -- one team per person
  role       TEXT NOT NULL DEFAULT 'member',
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('submissions_open', 'true'),
  ('boards_frozen', 'false'),
  ('bot_submissions_per_day', '20'),
  ('human_submissions_per_day', '200'),
  ('param_cap', '5000');

CREATE TABLE bots (
  id             TEXT PRIMARY KEY,
  team_id        TEXT NOT NULL REFERENCES teams(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  r2_key         TEXT NOT NULL,
  params         INTEGER NOT NULL,
  inputs_json    TEXT NOT NULL,
  method         TEXT,
  trainer        TEXT,
  trainer_arch   INTEGER NOT NULL,          -- 1 if the in-browser trainer could have made it
  created_at     TEXT NOT NULL
);
CREATE INDEX bots_team ON bots(team_id, created_at);

-- Human runs uploaded from the browser (saved laps and Human-board attempts).
CREATE TABLE runs (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  track_id    TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  final_hash  TEXT NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 0,   -- 1 once the server re-simulated it and it matched
  valid       INTEGER,
  score       REAL,
  created_at  TEXT NOT NULL
);
CREATE INDEX runs_team_track ON runs(team_id, track_id, verified);
CREATE UNIQUE INDEX runs_dedupe ON runs(team_id, final_hash);

-- Work for the Evaluator: bot evaluations, human-board attempts, and saved-lap verification.
CREATE TABLE submissions (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL REFERENCES teams(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL CHECK (kind IN ('bot', 'human', 'verify')),
  bot_id          TEXT REFERENCES bots(id),
  run_id          TEXT REFERENCES runs(id),
  track_id        TEXT NOT NULL,
  board_key       TEXT,
  status          TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'rejected')),
  reject_reason   TEXT,
  evaluation_id   TEXT,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX submissions_queue ON submissions(status, created_at);
CREATE INDEX submissions_team ON submissions(team_id, created_at);

CREATE TABLE evaluations (
  id              TEXT PRIMARY KEY,
  submission_id   TEXT NOT NULL REFERENCES submissions(id),
  engine_version  TEXT NOT NULL,
  track_id        TEXT NOT NULL,
  track_version   TEXT NOT NULL,
  valid           INTEGER NOT NULL,
  score           REAL,
  ticks           INTEGER NOT NULL,
  penalties       INTEGER NOT NULL,
  collisions      INTEGER NOT NULL,
  replay_id       TEXT NOT NULL,
  beginner        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE TABLE replays (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('human', 'bot')),
  r2_key       TEXT NOT NULL,
  team_id      TEXT NOT NULL REFERENCES teams(id),
  track_id     TEXT NOT NULL,
  title        TEXT NOT NULL,
  score        REAL,
  final_hash   TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'hidden')),
  thumb_key    TEXT,
  keep         INTEGER NOT NULL DEFAULT 0,  -- 1 once it has been on a leaderboard (never pruned)
  created_at   TEXT NOT NULL
);
CREATE INDEX replays_team ON replays(team_id);

-- Each team's best valid result per board. Ties: the earlier submission keeps its place.
CREATE TABLE leaderboard_entries (
  board_key      TEXT NOT NULL,
  team_id        TEXT NOT NULL REFERENCES teams(id),
  evaluation_id  TEXT NOT NULL REFERENCES evaluations(id),
  replay_id      TEXT NOT NULL,
  score          REAL NOT NULL,
  ticks          INTEGER NOT NULL,
  penalties      INTEGER NOT NULL,
  beginner       INTEGER NOT NULL DEFAULT 0,
  submitted_at   TEXT NOT NULL,
  hidden         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_key, team_id)
);
CREATE INDEX entries_rank ON leaderboard_entries(board_key, hidden, score, submitted_at);

CREATE TABLE board_snapshots (
  board_key   TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Yesterday's ranks, for the up/down arrows (written by the daily cron).
CREATE TABLE rank_history (
  board_key  TEXT NOT NULL,
  team_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (board_key, team_id, day)
);

CREATE TABLE announcements (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT NOT NULL,
  action        TEXT NOT NULL,
  target        TEXT,
  details_json  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX audit_time ON audit_log(created_at);
