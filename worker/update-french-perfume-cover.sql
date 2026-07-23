-- Set French Perfume cover (Antibookclub edition, ISBN 9780983868385)
-- Run: wrangler d1 execute rommy-blog-db --file=update-french-perfume-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://cdn11.bigcommerce.com/s-jo8zgdp0jo/images/stencil/1280x1280/products/193217/99984/image_file__12175.1743814281.jpg?c=1'
WHERE title = 'French Perfume'
   OR url LIKE '%9780983868385%';

UPDATE reading
SET cover_url = 'https://cdn11.bigcommerce.com/s-jo8zgdp0jo/images/stencil/1280x1280/products/193217/99984/image_file__12175.1743814281.jpg?c=1'
WHERE title = 'French Perfume'
   OR url LIKE '%9780983868385%';
