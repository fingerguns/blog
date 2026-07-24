-- Custom cover for Giovanni's Room
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-giovannis-room-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/giovannis-room-james-baldwin.png'
WHERE title = 'Giovanni''s Room'
   OR url LIKE '%9780345806567%';
