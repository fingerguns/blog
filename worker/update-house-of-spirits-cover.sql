-- Use the Latest reading cover for The House of the Spirits in Must Reads
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-house-of-spirits-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/the-house-of-the-spirits-isabel-allende.png'
WHERE title = 'The House of the Spirits'
   OR url LIKE '%9781501117015%';
