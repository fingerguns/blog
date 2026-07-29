-- Genre tags for Must Reads (reading_favorites).
-- Run once:
--   wrangler d1 execute rommy-blog-db --file=migrate-reading-genres.sql --remote

CREATE TABLE IF NOT EXISTS reading_genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_favorite_genres (
  favorite_id INTEGER NOT NULL,
  genre_id INTEGER NOT NULL,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  PRIMARY KEY (favorite_id, rank),
  UNIQUE (favorite_id, genre_id),
  FOREIGN KEY (favorite_id) REFERENCES reading_favorites(id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES reading_genres(id) ON DELETE CASCADE
);
