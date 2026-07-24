-- Custom cover for The Baron in the Trees
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-baron-in-the-trees-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/the-baron-in-the-trees-italo-calvino.png'
WHERE title = 'The Baron in the Trees'
   OR url LIKE '%9780544959118%';
