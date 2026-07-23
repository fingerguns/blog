-- Curated "Books Everyone Should Read" list (admin-managed).
-- Run once:
--   wrangler d1 execute rommy-blog-db --file=migrate-reading-favorites.sql --remote
--
-- Then seed existing titles (if table is empty):
--   node scripts/seed-reading-favorites.mjs --remote

CREATE TABLE IF NOT EXISTS reading_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  cover_url TEXT,
  author TEXT,
  added_at TEXT NOT NULL
);
