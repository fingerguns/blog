-- Oura Ring daily step counts (synced from API v2 daily_activity).
-- Run once: wrangler d1 execute rommy-blog-db --remote --file=migrate-oura.sql

CREATE TABLE IF NOT EXISTS oura_daily_activity (
  day TEXT PRIMARY KEY,
  steps INTEGER NOT NULL,
  activity_score INTEGER,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oura_daily_activity_day ON oura_daily_activity(day);
