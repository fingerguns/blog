/**
 * Shapes stored Oura documents into what the admin Health tab draws. Pure and
 * free of Node built-ins: the Worker imports it (getOuraDashboard in
 * worker/oura.mjs) and npm test runs it in Node.
 *
 * Oura's conventions this relies on:
 * - Durations are seconds; temperature deviation is °C from the personal baseline.
 * - A night is filed under the morning it ends (a sleep session's `day`).
 * - An activity day starts at 04:00 local, and `class_5_min` holds 288 digits,
 *   one per five minutes from then: 0 non-wear, 1 rest, 2 inactive, 3 low,
 *   4 medium, 5 high.
 * - `sleep_phase_5_min` holds one digit per five minutes from `bedtime_start`:
 *   1 deep, 2 light, 3 REM, 4 awake.
 */

/** "2026-11-25" plus n days, as a date string (calendar arithmetic in UTC). */
export function addDays(isoDay, n) {
  const [y, m, d] = String(isoDay).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The night's main sleep among a day's sessions: Oura's `long_sleep`, else the
 * longest session. Naps and rest periods are the rest.
 */
export function mainSleep(sessions) {
  const list = (sessions || []).filter(Boolean);
  if (!list.length) return null;
  const longest = (arr) =>
    arr.reduce((best, s) => ((num(s.total_sleep_duration) || 0) > (num(best.total_sleep_duration) || 0) ? s : best));
  const long = list.filter((s) => s.type === "long_sleep");
  return longest(long.length ? long : list);
}

/**
 * The metrics a series row carries, each with whether a higher value is the
 * better one (for "best"), or null where neither is (temperature deviation).
 */
export const SERIES_METRICS = {
  steps: { better: "higher" },
  activityScore: { better: "higher" },
  sleepScore: { better: "higher" },
  readinessScore: { better: "higher" },
  totalSleep: { better: "higher" },
  restingHr: { better: "lower" },
  hrv: { better: "higher" },
  tempDev: { better: null },
  activeCalories: { better: "higher" },
  stressHigh: { better: "lower" },
  recoveryHigh: { better: "higher" },
};

/**
 * One row per day from the per-kind scalar rows getOuraDashboard reads
 * (json_extract columns). Sleep figures are the day's main sleep.
 */
export function buildSeries(rows) {
  const byDay = new Map();
  const at = (day) => {
    if (!byDay.has(day)) byDay.set(day, { day });
    return byDay.get(day);
  };
  for (const r of rows.activity || []) {
    Object.assign(at(r.day), {
      steps: num(r.steps),
      activityScore: num(r.score),
      activeCalories: num(r.active_calories),
      totalCalories: num(r.total_calories),
      highTime: num(r.high_activity_time),
      mediumTime: num(r.medium_activity_time),
      lowTime: num(r.low_activity_time),
      sedentaryTime: num(r.sedentary_time),
    });
  }
  for (const r of rows.sleep || []) at(r.day).sleepScore = num(r.score);
  for (const r of rows.readiness || []) {
    Object.assign(at(r.day), { readinessScore: num(r.score), tempDev: num(r.temperature_deviation) });
  }
  for (const r of rows.stress || []) {
    Object.assign(at(r.day), { stressHigh: num(r.stress_high), recoveryHigh: num(r.recovery_high) });
  }
  for (const r of rows.spo2 || []) at(r.day).spo2 = num(r.spo2);
  const sessionsByDay = new Map();
  for (const r of rows.sessions || []) {
    if (!sessionsByDay.has(r.day)) sessionsByDay.set(r.day, []);
    sessionsByDay.get(r.day).push(r);
  }
  for (const [day, list] of sessionsByDay) {
    const s = mainSleep(list);
    if (!s) continue;
    Object.assign(at(day), {
      totalSleep: num(s.total_sleep_duration),
      deepSleep: num(s.deep_sleep_duration),
      remSleep: num(s.rem_sleep_duration),
      lightSleep: num(s.light_sleep_duration),
      awakeTime: num(s.awake_time),
      efficiency: num(s.efficiency),
      restingHr: num(s.lowest_heart_rate),
      hrv: num(s.average_hrv),
    });
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

/**
 * A metric's average over the range, the previous period's average and the
 * change between them, its best day (by SERIES_METRICS' direction), and how
 * many days had a value. Days without one are left out, not counted as zero.
 */
export function rangeStats(series, previous, metric) {
  const vals = (series || []).filter((r) => r[metric] !== null && r[metric] !== undefined);
  const prevVals = (previous || []).map((r) => r[metric]).filter((v) => v !== null && v !== undefined);
  const avg = mean(vals.map((r) => r[metric]));
  const prevAvg = mean(prevVals);
  const better = SERIES_METRICS[metric]?.better || null;
  let best = null;
  if (better && vals.length) {
    const pick = vals.reduce((b, r) => {
      if (!b) return r;
      return better === "higher" ? (r[metric] > b[metric] ? r : b) : r[metric] < b[metric] ? r : b;
    }, null);
    best = { value: pick[metric], day: pick.day };
  }
  return {
    avg,
    prevAvg,
    change: avg !== null && prevAvg !== null ? avg - prevAvg : null,
    best,
    days: vals.length,
  };
}

/** Collapse a digit string into runs: [{ start, length, value }], start in slots. */
function runs(str) {
  const out = [];
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    const last = out[out.length - 1];
    if (last && last.value === v) last.length++;
    else out.push({ start: i, length: 1, value: v });
  }
  return out;
}

const ACTIVITY_LEVELS = { 0: "nonwear", 1: "rest", 2: "inactive", 3: "low", 4: "medium", 5: "high" };
const SLEEP_STAGES = { 1: "deep", 2: "light", 3: "rem", 4: "awake" };

/** class_5_min → runs of { start, length, level } in five-minute slots from 04:00. */
export function parseClass5Min(str) {
  return runs(str).map((r) => ({ start: r.start, length: r.length, level: ACTIVITY_LEVELS[r.value] || "nonwear" }));
}

/** sleep_phase_5_min → runs of { start, length, stage } in five-minute slots from bedtime. */
export function parseHypnogram(str) {
  return runs(str).map((r) => ({ start: r.start, length: r.length, stage: SLEEP_STAGES[r.value] || "awake" }));
}

/** A heart-rate or HRV sample object → { interval, start, items } with gaps as null. */
function samples(obj) {
  if (!obj || !Array.isArray(obj.items)) return null;
  return {
    interval: num(obj.interval) || 300,
    start: typeof obj.timestamp === "string" ? obj.timestamp : null,
    items: obj.items.map(num),
  };
}

/**
 * One day's view from its documents, all filed under that day: its
 * `activity`, `stress` and `spo2`, and the night before it (`sleep`,
 * `sessions`) with that morning's `readiness`. Missing documents come back as
 * null.
 */
export function dayDetail(docs = {}) {
  const a = docs.activity || null;
  const main = mainSleep(docs.sessions);
  const naps = (docs.sessions || []).filter((s) => s && s !== main && num(s.total_sleep_duration) > 0);
  return {
    scores: {
      readiness: num(docs.readiness?.score),
      sleep: num(docs.sleep?.score),
      activity: num(a?.score),
    },
    activity: a
      ? {
          steps: num(a.steps),
          activeCalories: num(a.active_calories),
          totalCalories: num(a.total_calories),
          walkingMeters: num(a.equivalent_walking_distance),
          time: {
            high: num(a.high_activity_time),
            medium: num(a.medium_activity_time),
            low: num(a.low_activity_time),
            sedentary: num(a.sedentary_time),
            rest: num(a.resting_time),
            nonwear: num(a.non_wear_time),
          },
          strip: a.class_5_min ? { start: a.timestamp || null, runs: parseClass5Min(a.class_5_min) } : null,
          contributors: a.contributors || null,
        }
      : null,
    sleep: main
      ? {
          type: main.type || null,
          bedtimeStart: main.bedtime_start || null,
          bedtimeEnd: main.bedtime_end || null,
          total: num(main.total_sleep_duration),
          timeInBed: num(main.time_in_bed),
          stages: {
            deep: num(main.deep_sleep_duration),
            rem: num(main.rem_sleep_duration),
            light: num(main.light_sleep_duration),
            awake: num(main.awake_time),
          },
          efficiency: num(main.efficiency),
          latency: num(main.latency),
          hypnogram: main.sleep_phase_5_min ? parseHypnogram(main.sleep_phase_5_min) : null,
          heartRate: samples(main.heart_rate),
          hrv: samples(main.hrv),
          contributors: docs.sleep?.contributors || null,
        }
      : null,
    naps: naps.map((s) => ({
      type: s.type || null,
      start: s.bedtime_start || null,
      total: num(s.total_sleep_duration),
    })),
    body: {
      restingHr: num(main?.lowest_heart_rate),
      averageHr: num(main?.average_heart_rate),
      hrv: num(main?.average_hrv),
      breath: num(main?.average_breath),
      tempDev: num(docs.readiness?.temperature_deviation),
      stressHigh: num(docs.stress?.stress_high),
      recoveryHigh: num(docs.stress?.recovery_high),
      stressSummary: docs.stress?.day_summary || null,
      spo2: num(docs.spo2?.spo2_percentage?.average),
      breathingDisturbance: num(docs.spo2?.breathing_disturbance_index),
    },
    readinessContributors: docs.readiness?.contributors || null,
  };
}
