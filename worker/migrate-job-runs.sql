-- Durable record of background job outcomes (cron syncs, rebuilds, syndication).
-- Read by the /admin/ status strip via the `job-status` action.
-- Apply with: npm run d1 -- worker/migrate-job-runs.sql

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  status TEXT NOT NULL,
  context TEXT,
  detail TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_runs_created_at ON job_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, created_at);
