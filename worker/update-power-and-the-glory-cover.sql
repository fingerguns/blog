-- Set The Power and the Glory cover (Penguin Classics, ISBN 9780143107552)
-- Run: wrangler d1 execute rommy-blog-db --file=update-power-and-the-glory-cover.sql --remote
-- Or: GitHub Actions → D1 execute SQL → update-power-and-the-glory-cover.sql

UPDATE reading_favorites
SET cover_url = 'https://images.booksense.com/images/552/107/9780143107552.jpg',
    author = COALESCE(NULLIF(TRIM(author), ''), 'Graham Greene')
WHERE title = 'The Power and the Glory'
   OR url LIKE '%9780143107552%';

UPDATE reading
SET cover_url = 'https://images.booksense.com/images/552/107/9780143107552.jpg',
    author = COALESCE(NULLIF(TRIM(author), ''), 'Graham Greene')
WHERE title = 'The Power and the Glory'
   OR url LIKE '%9780143107552%';
