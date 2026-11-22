-- M4: weekly twists, dry runs, baselines, badges.

-- A twist file (track + engine config) uploaded by a referee, and its schedule.
-- It is live when override = 'live', or when override is NULL and
-- live_from <= now < live_until (live_until NULL = no end).
CREATE TABLE twists (
  id             TEXT PRIMARY KEY,
  version        TEXT NOT NULL,
  base_track     TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  r2_key         TEXT NOT NULL,             -- the full twist file
  live_from      TEXT,
  live_until     TEXT,
  override       TEXT CHECK (override IN ('live', 'off')),
  went_live_at   TEXT,                       -- first moment it was live; from then on it is public
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Referee-only rehearsal: every team's latest bot raced on a twist that isn't live.
CREATE TABLE dry_runs (
  id            TEXT PRIMARY KEY,
  twist_id      TEXT NOT NULL,
  twist_version TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  results_json  TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX dry_runs_queue ON dry_runs(status, created_at);

-- The baseline bot's result on every public track and twist ("course"), computed once per version.
CREATE TABLE baselines (
  course_id   TEXT NOT NULL,
  version     TEXT NOT NULL,
  valid       INTEGER NOT NULL,
  score       REAL,
  ticks       INTEGER NOT NULL,
  penalties   INTEGER NOT NULL,
  PRIMARY KEY (course_id, version)
);

-- Badges, awarded automatically. evidence is a replay id or board key.
CREATE TABLE badge_awards (
  team_id     TEXT NOT NULL REFERENCES teams(id),
  badge_id    TEXT NOT NULL,
  awarded_at  TEXT NOT NULL,
  evidence    TEXT,
  PRIMARY KEY (team_id, badge_id)
);
CREATE INDEX badge_time ON badge_awards(awarded_at);

-- Evaluations remember the twist they ran on, for the digest and history.
ALTER TABLE evaluations ADD COLUMN twist_id TEXT;
