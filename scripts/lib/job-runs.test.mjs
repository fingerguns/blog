// Run with: npm test
//
// getJobStatus() is pure SQL over a known schema, so it can be exercised
// against node:sqlite with a small D1-shaped adapter — no Worker, no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getJobStatus, JOB_HEALTH, JOB_STATUS } from "./job-runs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Minimal stand-in for the D1 binding: prepare().bind().all()/first()/run(). */
function d1(db) {
  return {
    prepare(sql) {
      let params = [];
      const api = {
        bind(...args) {
          params = args;
          return api;
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
        async first() {
          return db.prepare(sql).get(...params) ?? null;
        },
        async run() {
          return db.prepare(sql).run(...params);
        },
      };
      return api;
    },
  };
}

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

function freshDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(join(root, "worker", "migrate-job-runs.sql"), "utf8"));
  const insert = (job, status, detail, createdAt) =>
    raw
      .prepare(
        "INSERT INTO job_runs (job, status, context, detail, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(job, status, null, detail, 120, createdAt);
  return { raw, db: d1(raw), insert };
}

test("reports the most recent run per job", async () => {
  const { db, insert } = freshDb();
  insert("rebuild", JOB_STATUS.OK, null, hoursAgo(30));
  insert("rebuild", JOB_STATUS.FAILED, "Deploy hook returned HTTP 500", hoursAgo(1));

  const status = await getJobStatus(db, { days: 7 });
  const rebuild = status.jobs.find((j) => j.job === "rebuild");

  assert.equal(rebuild.status, "failed");
  assert.equal(rebuild.detail, "Deploy hook returned HTTP 500");
  assert.equal(rebuild.failures, 1);
  assert.equal(rebuild.broken, true);
  assert.equal(rebuild.recovered, false);
  assert.equal(status.healthy, false);
  assert.equal(status.health, JOB_HEALTH.BAD);
});

test("a job that has never run is reported rather than omitted", async () => {
  const { db } = freshDb();
  const status = await getJobStatus(db, { days: 7 });
  const microblog = status.jobs.find((j) => j.job === "syndicate:microblog");

  assert.equal(microblog.status, "never");
  assert.equal(microblog.last_run_at, null);
});

test("a scheduled job that has never run counts as a problem", async () => {
  const { db } = freshDb();
  const status = await getJobStatus(db, { days: 7 });
  const oura = status.jobs.find((j) => j.job === "oura-sync");

  // oura-sync is on a cron; never having fired is the exact failure that used
  // to be invisible, so it must not report healthy.
  assert.equal(oura.scheduled, true);
  assert.equal(oura.stale, true);
  assert.equal(status.healthy, false);
  assert.equal(status.health, JOB_HEALTH.BAD);
  assert.ok(status.problems.includes("oura-sync"));
});

test("an event-driven job that has never run is not a problem", async () => {
  const { db, insert } = freshDb();
  // Both cron jobs healthy; syndication has simply never fired.
  insert("oura-sync", JOB_STATUS.OK, null, hoursAgo(2));
  insert("rebuild", JOB_STATUS.OK, null, hoursAgo(2));

  const status = await getJobStatus(db, { days: 7 });
  const bluesky = status.jobs.find((j) => j.job === "syndicate:bluesky");

  assert.equal(bluesky.status, "never");
  assert.equal(bluesky.scheduled, false);
  assert.equal(bluesky.stale, false);
  assert.equal(status.healthy, true);
});

test("a successful job past its staleness threshold is flagged stale", async () => {
  const { db, insert } = freshDb();
  // rebuild's threshold is 72h
  insert("rebuild", JOB_STATUS.OK, null, hoursAgo(100));

  const status = await getJobStatus(db, { days: 7 });
  const rebuild = status.jobs.find((j) => j.job === "rebuild");

  assert.equal(rebuild.status, "ok");
  assert.equal(rebuild.stale, true);
});

test("jobs without a staleness threshold never go stale", async () => {
  const { db, insert } = freshDb();
  insert("syndicate:bluesky", JOB_STATUS.OK, null, hoursAgo(400));

  const status = await getJobStatus(db, { days: 7 });
  const bluesky = status.jobs.find((j) => j.job === "syndicate:bluesky");

  assert.equal(bluesky.stale, false);
  // Outside the 7-day window, but its last known state still reports.
  assert.equal(bluesky.status, "ok");
});

test("job names absent from KNOWN_JOBS still surface", async () => {
  const { db, insert } = freshDb();
  insert("some-new-job", JOB_STATUS.OK, null, hoursAgo(3));

  const status = await getJobStatus(db, { days: 7 });
  assert.ok(status.jobs.some((j) => j.job === "some-new-job"));
});

test("recent is scoped to the window while latest state is not", async () => {
  const { db, insert } = freshDb();
  insert("oura-sync", JOB_STATUS.OK, null, hoursAgo(2));
  insert("syndicate:bluesky", JOB_STATUS.OK, null, hoursAgo(400));
  // 400h is outside the 7-day window but must still report its last state.

  const status = await getJobStatus(db, { days: 7 });

  assert.equal(status.recent.length, 1);
  assert.equal(status.recent[0].job, "oura-sync");
  assert.equal(status.jobs.find((j) => j.job === "syndicate:bluesky").status, "ok");
});

test("all jobs healthy reports healthy", async () => {
  const { db, insert } = freshDb();
  insert("oura-sync", JOB_STATUS.OK, null, hoursAgo(2));
  insert("rebuild", JOB_STATUS.OK, null, hoursAgo(2));
  insert("syndicate:microblog", JOB_STATUS.OK, null, hoursAgo(2));
  insert("syndicate:bluesky", JOB_STATUS.OK, null, hoursAgo(2));
  insert("syndicate:mastodon", JOB_STATUS.OK, null, hoursAgo(2));

  const status = await getJobStatus(db, { days: 7 });

  assert.equal(status.healthy, true);
  assert.equal(status.health, JOB_HEALTH.OK);
  assert.deepEqual(status.problems, []);
  assert.deepEqual(status.recovered, []);
});

test("a job that failed but has since succeeded is a warning, not a problem", async () => {
  const { db, insert } = freshDb();
  insert("oura-sync", JOB_STATUS.OK, null, hoursAgo(2));
  insert("rebuild", JOB_STATUS.FAILED, "Deploy hook returned HTTP 304", hoursAgo(30));
  insert("rebuild", JOB_STATUS.OK, null, hoursAgo(1));

  const status = await getJobStatus(db, { days: 7 });
  const rebuild = status.jobs.find((j) => j.job === "rebuild");

  // The failure is still counted and still shown — it just doesn't hold the
  // board red for the rest of the window once the job is working again.
  assert.equal(rebuild.failures, 1);
  assert.equal(rebuild.broken, false);
  assert.equal(rebuild.recovered, true);
  assert.equal(status.health, JOB_HEALTH.WARN);
  assert.equal(status.healthy, true);
  assert.deepEqual(status.problems, []);
  assert.deepEqual(status.recovered, ["rebuild"]);
});

test("a recovered job still goes red if it is also stale", async () => {
  const { db, insert } = freshDb();
  insert("oura-sync", JOB_STATUS.OK, null, hoursAgo(2));
  // Succeeded last, so not failing — but rebuild's 72h threshold is blown.
  insert("rebuild", JOB_STATUS.FAILED, "boom", hoursAgo(120));
  insert("rebuild", JOB_STATUS.OK, null, hoursAgo(100));

  const status = await getJobStatus(db, { days: 7 });
  const rebuild = status.jobs.find((j) => j.job === "rebuild");

  assert.equal(rebuild.broken, true);
  assert.equal(rebuild.recovered, false);
  assert.equal(status.health, JOB_HEALTH.BAD);
});

test("a skipped run is neither a failure nor a warning", async () => {
  const { db, insert } = freshDb();
  insert("oura-sync", JOB_STATUS.OK, null, hoursAgo(2));
  // What a redundant deploy hook now records: the build was already queued.
  insert("rebuild", JOB_STATUS.SKIPPED, "Deploy already queued (HTTP 304)", hoursAgo(1));

  const status = await getJobStatus(db, { days: 7 });
  const rebuild = status.jobs.find((j) => j.job === "rebuild");

  assert.equal(rebuild.status, "skipped");
  assert.equal(rebuild.failures, 0);
  assert.equal(rebuild.broken, false);
  assert.equal(rebuild.recovered, false);
  assert.equal(status.health, JOB_HEALTH.OK);
});
