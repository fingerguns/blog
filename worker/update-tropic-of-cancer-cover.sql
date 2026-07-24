-- Custom cover for Tropic of Cancer
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-tropic-of-cancer-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/tropic-of-cancer-henry-miller.png'
WHERE title = 'Tropic of Cancer'
   OR url LIKE '%9780802131782%';
