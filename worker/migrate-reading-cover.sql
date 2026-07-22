-- Add cover_url to reading. Populated by the admin's cover picker (from
-- Open Library / Apple Books / Google Books candidates) at add time, or via
-- the "change cover" tool for existing entries. Run once on live DB:
--   wrangler d1 execute rommy-blog-db --file=migrate-reading-cover.sql --remote

ALTER TABLE reading ADD COLUMN cover_url TEXT;
