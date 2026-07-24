-- Custom cover for Last Exit to Brooklyn
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-last-exit-to-brooklyn-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/last-exit-to-brooklyn-hubert-selby-jr.png'
WHERE title = 'Last Exit to Brooklyn'
   OR url LIKE '%9780802131379%';
