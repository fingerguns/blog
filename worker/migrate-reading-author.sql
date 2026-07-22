-- Add author to reading. Optional; used to disambiguate cover search
-- (title+author combined query) when a plain title search is too generic
-- (e.g. "Hill") or collides with an unrelated book of the same title. Run
-- once on live DB:
--   wrangler d1 execute rommy-blog-db --file=migrate-reading-author.sql --remote

ALTER TABLE reading ADD COLUMN author TEXT;
