-- Add media_type to thinking_posts (image | audio). Run once on live DB:
--   wrangler d1 execute rommy-blog-db --file=migrate-thinking-audio.sql --remote

ALTER TABLE thinking_posts ADD COLUMN media_type TEXT;

UPDATE thinking_posts
SET media_type = 'image'
WHERE media_url IS NOT NULL AND media_url != '' AND media_type IS NULL;
