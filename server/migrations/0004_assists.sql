-- M5: laps driven with an accessibility assist (slow mode, auto-throttle) are labelled on Human boards.
ALTER TABLE leaderboard_entries ADD COLUMN assisted INTEGER NOT NULL DEFAULT 0;
-- Nightly re-verification of top results: when each entry was last re-simulated and whether it matched.
ALTER TABLE leaderboard_entries ADD COLUMN verified_at TEXT;
CREATE TABLE integrity_checks (
  id          TEXT PRIMARY KEY,
  checked     INTEGER NOT NULL,
  mismatches  INTEGER NOT NULL,
  details     TEXT NOT NULL,           -- JSON list of problems
  created_at  TEXT NOT NULL
);
