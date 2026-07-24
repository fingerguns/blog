-- Custom cover for The Old Man and the Sea
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-old-man-and-the-sea-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/the-old-man-and-the-sea-ernest-hemingway.png'
WHERE title = 'The Old Man and the Sea'
   OR url LIKE '%9781476787855%';
