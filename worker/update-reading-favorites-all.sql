-- Sync reading_favorites links and covers (Pedro Páramo, French Perfume, The Diesel)
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-reading-favorites-all.sql --remote

UPDATE reading_favorites
SET
  url = 'https://bookshop.org/a/126485/9780802160935',
  cover_url = 'https://images.booksense.com/images/935/160/9780802160935.jpg'
WHERE title = 'Pedro Paramo'
   OR url LIKE '%9780802160935%';

UPDATE reading_favorites
SET
  url = 'https://www.goodreads.com/book/show/29425657-french-perfume',
  cover_url = 'https://cdn11.bigcommerce.com/s-jo8zgdp0jo/images/stencil/1280x1280/products/193217/99984/image_file__12175.1743814281.jpg?c=1',
  author = 'Amir Tag Elsir'
WHERE title = 'French Perfume'
   OR url LIKE '%9780983868385%';

UPDATE reading_favorites
SET
  url = 'https://www.goodreads.com/book/show/15019746-the-diesel',
  cover_url = 'https://pictures.abebooks.com/isbn/9780983868316-us.jpg',
  author = 'Thani Al-Suwaidi'
WHERE title = 'The Diesel'
   OR url LIKE '%9780983868316%';

-- Latest list: Pedro Páramo cover if present
UPDATE reading
SET cover_url = 'https://images.booksense.com/images/935/160/9780802160935.jpg'
WHERE title LIKE 'Pedro P%ramo%'
   OR url LIKE '%9780802160935%';
