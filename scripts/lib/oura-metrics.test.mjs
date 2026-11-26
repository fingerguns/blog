// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  addDays,
  buildSeries,
  dayDetail,
  mainSleep,
  parseClass5Min,
  parseHypnogram,
  rangeStats,
} from "./oura-metrics.mjs";

// Shapes as Oura returns them (fields trimmed to what the code reads).
const longSleep = {
  id: "a",
  type: "long_sleep",
  day: "2026-11-19",
  bedtime_start: "2026-11-18T21:15:45.000-05:00",
  bedtime_end: "2026-11-19T05:13:15.000-05:00",
  total_sleep_duration: 26550,
  time_in_bed: 28650,
  deep_sleep_duration: 4320,
  rem_sleep_duration: 6180,
  light_sleep_duration: 16050,
  awake_time: 2100,
  efficiency: 93,
  latency: 1650,
  lowest_heart_rate: 58,
  average_heart_rate: 65.25,
  average_hrv: 38,
  average_breath: 12.75,
  sleep_phase_5_min: "4442211",
  heart_rate: { interval: 300, items: [null, 61, 59], timestamp: "2026-11-18T21:15:45.000-05:00" },
  hrv: { interval: 300, items: [null, 35, 40], timestamp: "2026-11-18T21:15:45.000-05:00" },
};
const nap = { id: "b", type: "late_nap", day: "2026-11-19", total_sleep_duration: 1800, bedtime_start: "2026-11-19T14:00:00.000-05:00" };

test("addDays crosses month and year ends", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("mainSleep prefers long_sleep, else the longest session", () => {
  assert.equal(mainSleep([nap, longSleep]).id, "a");
  const rest = { id: "c", type: "rest", total_sleep_duration: 900 };
  assert.equal(mainSleep([rest, nap]).id, "b");
  assert.equal(mainSleep([]), null);
});

test("parseClass5Min and parseHypnogram collapse digits into labelled runs", () => {
  assert.deepEqual(parseClass5Min("1122345"), [
    { start: 0, length: 2, level: "rest" },
    { start: 2, length: 2, level: "inactive" },
    { start: 4, length: 1, level: "low" },
    { start: 5, length: 1, level: "medium" },
    { start: 6, length: 1, level: "high" },
  ]);
  assert.deepEqual(parseHypnogram("4442211"), [
    { start: 0, length: 3, stage: "awake" },
    { start: 3, length: 2, stage: "light" },
    { start: 5, length: 2, stage: "deep" },
  ]);
});

test("dayDetail pairs a day's activity with the night after it", () => {
  const d = dayDetail({
    activity: { score: 84, steps: 15275, active_calories: 830, class_5_min: "1123", timestamp: "2026-11-18T04:00:00.000-05:00", high_activity_time: 120 },
    sleep: { score: 89, contributors: { deep_sleep: 95 } },
    readiness: { score: 86, temperature_deviation: 0.1, contributors: { hrv_balance: 93 } },
    stress: { stress_high: 2700, recovery_high: 5400, day_summary: "normal" },
    spo2: { spo2_percentage: null, breathing_disturbance_index: 9 },
    sessions: [nap, longSleep],
  });
  assert.deepEqual(d.scores, { readiness: 86, sleep: 89, activity: 84 });
  assert.equal(d.activity.steps, 15275);
  assert.equal(d.activity.strip.runs.length, 3);
  assert.equal(d.sleep.total, 26550);
  assert.equal(d.sleep.hypnogram[0].stage, "awake");
  assert.deepEqual(d.sleep.heartRate.items, [null, 61, 59]);
  assert.equal(d.naps.length, 1);
  assert.equal(d.body.restingHr, 58);
  assert.equal(d.body.spo2, null, "a null spo2_percentage reads as missing");
  assert.equal(d.body.stressHigh, 2700);
});

test("dayDetail with nothing stored is all empty, not an error", () => {
  const d = dayDetail({});
  assert.deepEqual(d.scores, { readiness: null, sleep: null, activity: null });
  assert.equal(d.activity, null);
  assert.equal(d.sleep, null);
  assert.deepEqual(d.naps, []);
});

test("buildSeries merges kinds by day and takes the main sleep's figures", () => {
  const series = buildSeries({
    activity: [{ day: "2026-11-19", score: 84, steps: 15275 }, { day: "2026-11-18", score: 80, steps: 900 }],
    sleep: [{ day: "2026-11-19", score: 89 }],
    readiness: [{ day: "2026-11-19", score: 86, temperature_deviation: 0.1 }],
    sessions: [nap, longSleep],
  });
  assert.deepEqual(series.map((r) => r.day), ["2026-11-18", "2026-11-19"]);
  const d = series[1];
  assert.equal(d.steps, 15275);
  assert.equal(d.sleepScore, 89);
  assert.equal(d.totalSleep, 26550);
  assert.equal(d.restingHr, 58);
  assert.equal(series[0].sleepScore, undefined);
});

test("rangeStats skips missing days and picks best by direction", () => {
  const series = [
    { day: "2026-11-01", steps: 1000, restingHr: 60 },
    { day: "2026-11-02", steps: null, restingHr: 55 },
    { day: "2026-11-03", steps: 3000 },
  ];
  const previous = [{ day: "2026-10-31", steps: 1000 }];
  const steps = rangeStats(series, previous, "steps");
  assert.equal(steps.avg, 2000);
  assert.equal(steps.days, 2);
  assert.equal(steps.prevAvg, 1000);
  assert.equal(steps.change, 1000);
  assert.deepEqual(steps.best, { value: 3000, day: "2026-11-03" });
  assert.deepEqual(rangeStats(series, [], "restingHr").best, { value: 55, day: "2026-11-02" }, "lower is better");
  assert.equal(rangeStats(series, [], "tempDev").best, null);
  assert.equal(rangeStats([], [], "steps").avg, null);
});

test("health data never reaches the static build", () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  for (const file of ["../build.mjs", "../d1-client.mjs"]) {
    const src = read(file);
    assert.ok(!/oura_daily\b|oura_sleep_sessions|oura-metrics/.test(src), file);
  }
});
