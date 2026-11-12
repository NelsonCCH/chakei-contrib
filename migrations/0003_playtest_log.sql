-- The playtest preview's timing log (src/playtest/log.ts -> POST /api/ptlog, worker/index.ts). One row per batch
-- the page sends (up to 400 compact JSON events in `body`); (dev, b) is unique, so a batch sent twice (a beacon at
-- pagehide, then the retry) is kept once. dev: a random device id, no personal data. Written only by a Worker with
-- PLAYTEST="1" (a playtest preview); a Worker without it never writes it. Applied with the other migrations
-- (npm run db:local / npm run db:remote); the table stays empty unless PLAYTEST="1".
-- Read it with scripts/playtest-log.mjs.
CREATE TABLE IF NOT EXISTS playtest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dev TEXT NOT NULL,
  b INTEGER NOT NULL,
  at INTEGER NOT NULL,           -- server time the batch arrived (ms)
  ver TEXT NOT NULL,             -- the page's build version (app.js?v=)
  n INTEGER NOT NULL,            -- events in body
  lost INTEGER NOT NULL,         -- events the device dropped before this batch (its buffer overflowed offline)
  body TEXT NOT NULL,            -- JSON array of events (src/playtest/log.ts PtRow)
  UNIQUE (dev, b)
);
