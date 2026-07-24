-- Custom cover for Their Eyes Were Watching God (Charly Palmer edition art)
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=update-their-eyes-cover.sql --remote

UPDATE reading_favorites
SET cover_url = 'https://rommy.blog/media/reading/covers/their-eyes-were-watching-god-zora-neale-hurston.jpg'
WHERE title = 'Their Eyes Were Watching God'
   OR url LIKE '%9780060838676%';
