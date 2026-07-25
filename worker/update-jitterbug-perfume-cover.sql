-- Custom cover for Jitterbug Perfume
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-jitterbug-perfume-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/jitterbug-perfume-tom-robbins.png'
WHERE title = 'Jitterbug Perfume'
   OR url LIKE '%9780553348989%';
