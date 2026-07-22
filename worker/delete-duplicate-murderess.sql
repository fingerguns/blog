-- Remove duplicate "The Murderess" reading entry (keep URL with ean param).
DELETE FROM reading
WHERE title = 'The Murderess'
  AND url = 'https://bookshop.org/p/books/the-murderess-alexandros-papadiamantis/0a74823ccb407609';
