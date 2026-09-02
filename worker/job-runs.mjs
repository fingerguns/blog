import {
  getJobStatus,
  JOB_HEALTH,
  JOB_RETENTION_DAYS,
  JOB_STATUS,
} from "../scripts/lib/job-runs.mjs";

export { getJobStatus, JOB_HEALTH, JOB_STATUS };

const DETAIL_MAX = 500;

function truncate(value) {
  if (!value) return null;
  const text = String(value);
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

/**
 * Append one row to job_runs. Telemetry must never break the thing it observes,
 * so every failure here is swallowed after logging — same contract as
 * logAnthropicUsage in worker/anthropic-usage.mjs.
 */
export async function recordJobRun(db, { job, status, context, detail, durationMs } = {}) {
  if (!db || !job || !status) return;

  if (status === JOB_STATUS.FAILED) {
    console.error(`job ${job} failed${context ? ` (${context})` : ""}: ${detail || "no detail"}`);
  }

  try {
    await db
      .prepare(
        `INSERT INTO job_runs (job, status, context, detail, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        job,
        status,
        context ? String(context) : null,
        truncate(detail),
        Number.isFinite(durationMs) ? Math.round(durationMs) : null,
        new Date().toISOString()
      )
      .run();
  } catch (err) {
    console.error("job run log failed:", err?.message || err);
  }
}

/**
 * Time `fn`, record the outcome, and re-throw on failure so callers keep their
 * existing control flow. Use where a job owns its whole try/catch; use
 * recordJobRun directly where the caller already handles the error.
 */
export async function runJob(db, job, fn, { context = null } = {}) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await recordJobRun(db, {
      job,
      status: JOB_STATUS.OK,
      context,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    await recordJobRun(db, {
      job,
      status: JOB_STATUS.FAILED,
      context,
      detail: err?.message || String(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

/** Keep the table bounded. Called opportunistically from the scheduled handler. */
export async function pruneJobRuns(db, { keepDays = JOB_RETENTION_DAYS } = {}) {
  if (!db) return;
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    await db.prepare("DELETE FROM job_runs WHERE created_at < ?").bind(cutoff).run();
  } catch (err) {
    console.error("job run prune failed:", err?.message || err);
  }
}
