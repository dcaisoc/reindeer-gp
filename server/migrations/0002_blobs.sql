-- Small files (bots, replays, thumbnails) stored in the database, so the
-- system runs without R2 (which may ask for a payment card). Base64 text keeps
-- the format identical on D1 and SQLite. If storage grows, bind an R2 bucket
-- as BLOBS and new files go there instead.
CREATE TABLE blobs (
  key           TEXT PRIMARY KEY,
  data_b64      TEXT NOT NULL,
  content_type  TEXT,
  created_at    TEXT NOT NULL
);
