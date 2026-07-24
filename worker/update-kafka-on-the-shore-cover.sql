-- Custom cover for Kafka on the Shore
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-kafka-on-the-shore-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/kafka-on-the-shore-haruki-murakami.png'
WHERE title = 'Kafka on the Shore'
   OR url LIKE '%9781400079278%';
