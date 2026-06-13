-- Consolidate thinking_syndication into thinking_posts; remove redundant tables.
-- Run once on remote D1:
--   wrangler d1 execute rommy-blog-db --file=migrate-thinking-consolidate.sql --remote

ALTER TABLE thinking_posts ADD COLUMN bluesky_uri TEXT;

UPDATE thinking_posts
SET microblog_url = COALESCE(
  microblog_url,
  (SELECT microblog_url FROM thinking_syndication WHERE thinking_syndication.slug = thinking_posts.slug)
)
WHERE EXISTS (SELECT 1 FROM thinking_syndication LIMIT 1);

UPDATE thinking_posts
SET bluesky_uri = (
  SELECT bluesky_uri FROM thinking_syndication WHERE thinking_syndication.slug = thinking_posts.slug
)
WHERE EXISTS (SELECT 1 FROM thinking_syndication LIMIT 1);

DROP TABLE IF EXISTS thinking_syndication;
DROP TABLE IF EXISTS thinking;
