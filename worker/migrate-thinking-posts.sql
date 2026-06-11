-- Run against your live DB to add the thinking_posts table:
--   wrangler d1 execute rommy-blog-db --file=migrate-thinking-posts.sql --remote
-- Then run: node scripts/migrate-thinking-posts.mjs

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
