-- Custom cover for The Unbearable Lightness of Being
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-unbearable-lightness-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/the-unbearable-lightness-of-being-milan-kundera.png'
WHERE title = 'The Unbearable Lightness of Being'
   OR url LIKE '%9780060932138%';
