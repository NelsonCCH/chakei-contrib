-- chakei backend tables (replaces the Firestore collections users / daily / stats).
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,          -- 'g:<google sub>' or 'dev:<hash>' (dev login, staging only)
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saves (
  uid TEXT PRIMARY KEY,
  shop TEXT NOT NULL,            -- the game's SHOP object as JSON
  updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_scores (
  day TEXT NOT NULL,             -- the game's todayStr(): 'YYYY-M-D'
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  revenue INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  station TEXT NOT NULL,
  slot TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (day, uid)
);
CREATE INDEX IF NOT EXISTS daily_rank ON daily_scores (day, revenue DESC);

CREATE TABLE IF NOT EXISTS stats (
  day TEXT NOT NULL,
  k TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, k)
);
