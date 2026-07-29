-- Custom cover for James Baldwin: A Biography
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-james-baldwin-biography-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/james-baldwin-a-biography-david-leeming.png'
WHERE title = 'James Baldwin: A Biography'
   OR url LIKE '%9781628724387%';
