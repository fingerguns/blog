-- Change log for live publishing: one row per content add, edit, or delete.
-- The build stamps MAX(id) on every page it writes (the "watermark"); the
-- live overlay (worker/live-overlay.mjs) applies whatever changed after it,
-- so a post shows up before the Pages rebuild that will contain it lands.
-- Rows are only needed until the next successful deploy; the cron prunes
-- anything older than 7 days.
-- Apply with (from worker/): npx wrangler d1 execute rommy-blog-db --remote --file=migrate-content-changes.sql

CREATE TABLE IF NOT EXISTS content_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_changes_created_at ON content_changes(created_at);
