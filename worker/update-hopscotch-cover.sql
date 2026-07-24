-- Custom cover for Hopscotch
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-hopscotch-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/hopscotch-julio-cortazar.png'
WHERE title = 'Hopscotch'
   OR url LIKE '%9780394752846%';
