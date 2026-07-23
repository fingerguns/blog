-- Set The Diesel cover (Antibookclub edition, ISBN 9780983868316)
-- Run: wrangler d1 execute rommy-blog-db --file=update-the-diesel-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://pictures.abebooks.com/isbn/9780983868316-us.jpg'
WHERE title = 'The Diesel'
   OR url LIKE '%9780983868316%';

UPDATE reading
SET cover_url = 'https://pictures.abebooks.com/isbn/9780983868316-us.jpg'
WHERE title = 'The Diesel'
   OR url LIKE '%9780983868316%';
