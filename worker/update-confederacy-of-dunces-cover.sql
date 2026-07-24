-- Custom cover for A Confederacy of Dunces
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-confederacy-of-dunces-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/a-confederacy-of-dunces-john-kennedy-toole.png'
WHERE title = 'A Confederacy of Dunces'
   OR url LIKE '%9780802130204%';
