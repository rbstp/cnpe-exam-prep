-- Progress sync store. One row per GitHub user, one JSON blob per row.
--
--     wrangler d1 execute cnpe-progress --remote --file=schema.sql
--
-- rev is an optimistic-concurrency counter: a PUT carrying a stale rev is
-- rejected with 409 and the current copy, and the client merges and retries.
-- Counters take a per-field max and ticks resolve against a base the client
-- keeps, so no order of writes loses work a browser did not itself undo.
CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT PRIMARY KEY,           -- GitHub numeric user id, stable across renames
  login      TEXT NOT NULL,              -- last-seen login, for the account line only
  rev        INTEGER NOT NULL DEFAULT 1,
  blob       TEXT NOT NULL,              -- the cnpe:v2 store, JSON
  updated_at TEXT NOT NULL               -- ISO 8601
);
