-- Point French Perfume and The Diesel at Goodreads (not on Bookshop.org)
-- Run: wrangler d1 execute rommy-blog-db --file=update-goodreads-favorite-links.sql --remote

UPDATE reading_favorites
SET
  url = 'https://www.goodreads.com/book/show/29425657-french-perfume',
  cover_url = 'https://cdn11.bigcommerce.com/s-jo8zgdp0jo/images/stencil/1280x1280/products/193217/99984/image_file__12175.1743814281.jpg?c=1'
WHERE title = 'French Perfume'
   OR url LIKE '%9780983868385%';

UPDATE reading_favorites
SET
  url = 'https://www.goodreads.com/book/show/15019746-the-diesel',
  cover_url = 'https://pictures.abebooks.com/isbn/9780983868316-us.jpg'
WHERE title = 'The Diesel'
   OR url LIKE '%9780983868316%';
