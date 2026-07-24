-- Custom cover for Big Sur
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-big-sur-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/big-sur-jack-kerouac.png'
WHERE title = 'Big Sur'
   OR url LIKE '%9780140168129%';
