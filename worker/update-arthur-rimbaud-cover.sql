-- Custom cover for Arthur Rimbaud (Enid Starkie biography)
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-arthur-rimbaud-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/arthur-rimbaud-enid-starkie.png'
WHERE title = 'Arthur Rimbaud'
   OR url LIKE '%9780811201971%';
