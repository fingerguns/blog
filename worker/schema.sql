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
  datetime TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_anthropic_usage_feature ON anthropic_usage(feature);
