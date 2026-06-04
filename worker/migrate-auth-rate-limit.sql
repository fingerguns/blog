-- One-time migration for existing rommy-blog-db deployments
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
