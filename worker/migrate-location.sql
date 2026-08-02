-- Location tracking (Overland ingest) + Thinking post neighborhood labels.
-- Run once: wrangler d1 execute rommy-blog-db --remote --file=migrate-location.sql

CREATE TABLE IF NOT EXISTS location_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  horizontal_accuracy REAL,
  altitude REAL,
  speed REAL,
  course REAL,
  battery_level REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_location_points_recorded_at ON location_points(recorded_at);
CREATE INDEX IF NOT EXISTS idx_location_points_device_recorded ON location_points(device_id, recorded_at);

CREATE TABLE IF NOT EXISTS geocode_cache (
  cache_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE thinking_posts ADD COLUMN location_label TEXT;
