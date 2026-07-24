-- Custom cover for An Episode in the Life of a Landscape Painter
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-landscape-painter-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/an-episode-in-the-life-of-a-landscape-painter-cesar-aira.png'
WHERE title = 'An Episode in the Life of a Landscape Painter'
   OR url LIKE '%9780811216302%';
