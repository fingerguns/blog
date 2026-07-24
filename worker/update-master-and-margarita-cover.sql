-- Custom cover for The Master and Margarita (Penguin Classics Deluxe Edition)
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-master-and-margarita-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/the-master-and-margarita-mikhail-bulgakov.jpg'
WHERE title = 'The Master and Margarita'
   OR url LIKE '%9780143108276%';
