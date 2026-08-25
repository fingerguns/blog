-- Build-time caches (book covers, Spotify art, video posters, link unfurls).
-- Previously data/*.json committed to git, which meant Pages CI discarded every
-- cache write and refetched anything added since the last commit.
-- Apply with:
--   cd worker && wrangler d1 execute rommy-blog-db --remote --file=migrate-build-cache.sql
-- Then seed from the existing JSON files: npm run migrate-build-cache

CREATE TABLE IF NOT EXISTS build_cache (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_build_cache_namespace ON build_cache(namespace);
