CREATE TABLE IF NOT EXISTS watching (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ym TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  watched_at TEXT NOT NULL,
  rating REAL,
  added_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watching_sort ON watching(watched_at DESC, id DESC);
