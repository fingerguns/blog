-- rommy.blog D1 schema

CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_html TEXT NOT NULL,
  date TEXT NOT NULL,
  datetime TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_html TEXT NOT NULL,
  edited_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_versions_slug ON post_versions(slug);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ym TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  cover_url TEXT,
  author TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_favorite_genres (
  favorite_id INTEGER NOT NULL,
  genre_id INTEGER NOT NULL,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  PRIMARY KEY (favorite_id, rank),
  UNIQUE (favorite_id, genre_id),
  FOREIGN KEY (favorite_id) REFERENCES reading_favorites(id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES reading_genres(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS linklog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  datetime TEXT NOT NULL,
  tags TEXT
);

CREATE TABLE IF NOT EXISTS thinking_posts (
  slug TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_alt TEXT,
  media_type TEXT,
  media_urls TEXT,
  content_html TEXT,
  datetime TEXT NOT NULL,
  microblog_url TEXT,
  bluesky_uri TEXT,
  mastodon_uri TEXT,
  location_label TEXT,
  created_at TEXT NOT NULL
);

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

-- Failed admin password attempts (brute-force throttling)
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS anthropic_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  feature TEXT NOT NULL,
  context TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_anthropic_usage_created_at ON anthropic_usage(created_at);

CREATE TABLE IF NOT EXISTS oura_daily_activity (
  day TEXT PRIMARY KEY,
  steps INTEGER NOT NULL,
  activity_score INTEGER,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oura_daily_activity_day ON oura_daily_activity(day);
CREATE INDEX IF NOT EXISTS idx_anthropic_usage_feature ON anthropic_usage(feature);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  status TEXT NOT NULL,
  context TEXT,
  detail TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_runs_created_at ON job_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, created_at);

CREATE TABLE IF NOT EXISTS build_cache (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_build_cache_namespace ON build_cache(namespace);
