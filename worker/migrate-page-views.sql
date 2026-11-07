-- View counts for the permalink pages (Thinking notes and Writing posts).
-- One row per page, keyed by its canonical path (`/thinking/<slug>/`,
-- `/posts/<slug>/`); the Worker adds one per page load (worker/page-views.mjs)
-- and history before that was seeded from Google Analytics
-- (scripts/seed-page-views.mjs). Nothing about the visitor is stored.
-- Apply with: wrangler d1 execute rommy-blog-db --file=migrate-page-views.sql --remote

CREATE TABLE IF NOT EXISTS page_views (
  path TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
