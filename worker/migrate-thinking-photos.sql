-- Add media_urls JSON array for multi-photo Thinking posts (up to 4).
-- Run once on live DB:
--   npx wrangler d1 execute rommy-blog-db --file=migrate-thinking-photos.sql --remote
--
-- media_url remains the first/sole photo for OG and backcompat.
-- media_urls is a JSON array of URLs when 2–4 photos; null otherwise.

ALTER TABLE thinking_posts ADD COLUMN media_urls TEXT;
