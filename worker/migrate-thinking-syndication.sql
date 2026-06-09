ALTER TABLE thinking ADD COLUMN slug TEXT;

CREATE TABLE IF NOT EXISTS thinking_syndication (
  slug TEXT PRIMARY KEY,
  microblog_url TEXT,
  bluesky_uri TEXT,
  created_at TEXT NOT NULL
);
