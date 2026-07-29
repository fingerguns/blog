-- Anthropic API usage log (tokens per Worker call)
-- Run from worker/:
--   wrangler d1 execute rommy-blog-db --file=migrate-anthropic-usage.sql --remote

CREATE TABLE IF NOT EXISTS anthropic_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  feature TEXT NOT NULL,
  context TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_anthropic_usage_created_at ON anthropic_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_anthropic_usage_feature ON anthropic_usage(feature);
