-- A version number per save. Every write bumps it; a client that sends the version it read
-- only overwrites that version (compare-and-set), so a stale device merges instead of overwriting. Saves written before
-- this migration start at 0. Apply before deploying the Worker that reads it (npm run db:remote).
ALTER TABLE saves ADD COLUMN ver INTEGER NOT NULL DEFAULT 0;
