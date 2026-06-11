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

CREATE TABLE IF NOT EXISTS linklog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  datetime TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS thinking (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  text TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_alt TEXT,
  updated_at TEXT NOT NULL,
  slug TEXT
);

CREATE TABLE IF NOT EXISTS thinking_posts (
  slug TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_alt TEXT,
  content_html TEXT,
  datetime TEXT NOT NULL,
  microblog_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS thinking_syndication (
  slug TEXT PRIMARY KEY,
  microblog_url TEXT,
  bluesky_uri TEXT,
  created_at TEXT NOT NULL
);

-- Failed admin password attempts (brute-force throttling)
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
