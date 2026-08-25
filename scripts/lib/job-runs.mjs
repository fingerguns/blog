// Read side for the `job_runs` table — see worker/job-runs.mjs for the write side.
// Shared with build/CLI scripts the same way scripts/lib/anthropic-usage.mjs is.

export const JOB_STATUS = { OK: "ok", FAILED: "failed", SKIPPED: "skipped" };

// Jobs the status strip expects to exist. A job listed here but absent from
// job_runs renders as "never run", which is itself a finding — a cron that has
// never fired looks identical to a healthy one without this list.
export const KNOWN_JOBS = [
  { job: "oura-sync", label: "Oura sync", staleAfterHours: 24 },
  { job: "rebuild", label: "Site rebuild", staleAfterHours: 72 },
  { job: "syndicate:microblog", label: "micro.blog", staleAfterHours: null },
  { job: "syndicate:bluesky", label: "Bluesky", staleAfterHours: null },
  { job: "syndicate:mastodon", label: "Mastodon", staleAfterHours: null },
];

export const JOB_RETENTION_DAYS = 30;

function hoursSince(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 3_600_000;
}

export async function getJobStatus(db, { days = 7, limit = 25 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Latest run per job, across all history — a job that last ran before the
  // window still needs to report its last known state rather than vanishing.
  const { results: latest } = await db
    .prepare(
      `SELECT job, status, context, detail, duration_ms, created_at
         FROM (
           SELECT *,
                  ROW_NUMBER() OVER (PARTITION BY job ORDER BY created_at DESC, id DESC) AS rn
             FROM job_runs
         )
        WHERE rn = 1`
    )
    .all();

  const { results: failureCounts } = await db
    .prepare(
      `SELECT job, COUNT(*) AS failures
         FROM job_runs
        WHERE status = ? AND created_at >= ?
        GROUP BY job`
    )
    .bind(JOB_STATUS.FAILED, since)
    .all();

  const { results: recent } = await db
    .prepare(
      `SELECT job, status, context, detail, duration_ms, created_at
         FROM job_runs
        WHERE created_at >= ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    )
    .bind(since, Math.min(Math.max(Number(limit) || 25, 1), 200))
    .all();

  const latestByJob = new Map((latest || []).map((row) => [row.job, row]));
  const failuresByJob = new Map(
    (failureCounts || []).map((row) => [row.job, Number(row.failures) || 0])
  );

  // Union of jobs we expect and jobs we have actually seen, so a new job name
  // shows up without needing to be added to KNOWN_JOBS first.
  const names = [...new Set([...KNOWN_JOBS.map((j) => j.job), ...latestByJob.keys()])];

  const jobs = names.map((name) => {
    const known = KNOWN_JOBS.find((j) => j.job === name);
    const row = latestByJob.get(name) || null;
    const age = row ? hoursSince(row.created_at) : null;

    // Only jobs that run on their own schedule can be late. Syndication fires
    // when you publish, so "never run" there means "you haven't posted since
    // this deployed" — not a fault. For a cron, never having run is the fault.
    const scheduled = Boolean(known?.staleAfterHours);
    const stale = scheduled && (row === null || age > known.staleAfterHours);

    return {
      job: name,
      label: known?.label || name,
      status: row ? row.status : "never",
      scheduled,
      context: row?.context || null,
      detail: row?.detail || null,
      duration_ms: row?.duration_ms ?? null,
      last_run_at: row?.created_at || null,
      age_hours: age === null ? null : Math.round(age * 10) / 10,
      stale,
      failures: failuresByJob.get(name) || 0,
    };
  });

  jobs.sort((a, b) => a.label.localeCompare(b.label));

  const problems = jobs.filter(
    (j) => j.status === JOB_STATUS.FAILED || j.stale || j.failures > 0
  );

  return {
    days,
    since,
    healthy: problems.length === 0,
    problems: problems.map((j) => j.job),
    jobs,
    recent: recent || [],
  };
}
