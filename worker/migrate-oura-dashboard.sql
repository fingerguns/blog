-- Oura dashboard (admin Health tab): Oura's daily documents and sleep sessions,
-- stored as returned (minus the bulky per-minute arrays the dashboard never
-- draws) and shaped on read by scripts/lib/oura-metrics.mjs. Private: only the
-- password-checked `oura-dashboard` action reads these; the static build never
-- does. oura_daily_activity (steps for /now/) is unchanged.
-- Run once: wrangler d1 execute rommy-blog-db --remote --file=migrate-oura-dashboard.sql

-- One row per kind per day. kind: activity | sleep | readiness | stress | spo2
-- (Oura's daily_activity, daily_sleep, daily_readiness, daily_stress, daily_spo2).
CREATE TABLE IF NOT EXISTS oura_daily (
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  data TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (kind, day)
);

CREATE INDEX IF NOT EXISTS idx_oura_daily_day ON oura_daily(day);

-- Oura's sleep sessions: several a day (the night's long_sleep, naps, rest),
-- filed under the day the session ends.
CREATE TABLE IF NOT EXISTS oura_sleep_sessions (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  type TEXT,
  data TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oura_sleep_sessions_day ON oura_sleep_sessions(day);
