-- Set Pedro Páramo cover (Grove Press / Douglas J. Weatherford translation, ISBN 9780802160935)
-- Run: wrangler d1 execute rommy-blog-db --file=update-pedro-paramo-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://images.booksense.com/images/935/160/9780802160935.jpg'
WHERE title = 'Pedro Paramo'
   OR url LIKE '%9780802160935%';

UPDATE reading
SET cover_url = 'https://images.booksense.com/images/935/160/9780802160935.jpg'
WHERE title LIKE 'Pedro P%ramo%'
   OR url LIKE '%9780802160935%';
