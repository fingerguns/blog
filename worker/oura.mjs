import { dayDetail, buildSeries, rangeStats, addDays, SERIES_METRICS } from "../scripts/lib/oura-metrics.mjs";

const OURA_COLLECTION_BASE = "https://api.ouraring.com/v2/usercollection/";

// The dashboard's kinds and the Oura collection each one comes from. All but
// `sessions` are one document per day (table oura_daily); `sessions` are
// Oura's sleep periods, several a day (table oura_sleep_sessions).
export const OURA_KINDS = {
  activity: "daily_activity",
  sleep: "daily_sleep",
  readiness: "daily_readiness",
  stress: "daily_stress",
  spo2: "daily_spo2",
  sessions: "sleep",
};
// Sleep and readiness land each morning and activity grows through the day,
// so the scheduled sync re-reads the last few days of every kind.
const DASHBOARD_RECENT_DAYS = 3;
// Per-minute and per-30-second arrays the dashboard never draws. Dropped
// before storing: `met` alone is 1,440 numbers a day.
const DROPPED_FIELDS = {
  activity: ["met"],
  sessions: ["movement_30_sec", "sleep_phase_30_sec", "app_sleep_phase_5_min"],
};
const UPSERT_DAILY_SQL = `INSERT INTO oura_daily (kind, day, data, synced_at) VALUES (?, ?, ?, ?)
 ON CONFLICT(kind, day) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at`;
const UPSERT_SESSION_SQL = `INSERT INTO oura_sleep_sessions (id, day, type, data, synced_at) VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(id) DO UPDATE SET day = excluded.day, type = excluded.type, data = excluded.data, synced_at = excluded.synced_at`;
const BACKFILL_DAYS = 730;
const INCREMENTAL_DAYS = 14;
const D1_BATCH_SIZE = 100;
const SYNC_STATE_KEY = "oura_sync_state";

const UPSERT_OURA_SQL = `INSERT INTO oura_daily_activity (day, steps, activity_score, synced_at)
 VALUES (?, ?, ?, ?)
 ON CONFLICT(day) DO UPDATE SET
   steps = excluded.steps,
   activity_score = excluded.activity_score,
   synced_at = excluded.synced_at`;

function formatDateEt(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(date);
}

function addDaysEt(isoDay, deltaDays) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0);
  return formatDateEt(new Date(utc));
}

function ouraToken(env) {
  return String(env.OURA_ACCESS_TOKEN || "").trim();
}

// Every Oura request's Authorization header comes from here. Oura deprecated
// personal access tokens in December 2025 (the current one still works); if
// it stops, an OAuth2 refresh-token flow replaces this one function.
function ouraAuthHeader(env) {
  const token = ouraToken(env);
  if (!token) throw new Error("OURA_ACCESS_TOKEN is not configured");
  return `Bearer ${token}`;
}

async function loadSyncState(db) {
  const row = await db.prepare("SELECT value FROM site_config WHERE key = ?").bind(SYNC_STATE_KEY).first();
  if (!row?.value) return { backfill_complete: false };
  try {
    return JSON.parse(row.value);
  } catch {
    return { backfill_complete: false };
  }
}

async function saveSyncState(db, state) {
  await db
    .prepare("INSERT OR REPLACE INTO site_config (key, value) VALUES (?, ?)")
    .bind(SYNC_STATE_KEY, JSON.stringify(state))
    .run();
}

export async function fetchDailyActivity(token, startDate, endDate) {
  return fetchOuraCollection(`Bearer ${token}`, "daily_activity", startDate, endDate);
}

/** Every document in one Oura collection between two days, following next_token. */
export async function fetchOuraCollection(auth, collection, startDate, endDate) {
  const records = [];
  let nextToken = null;

  do {
    const url = new URL(`${OURA_COLLECTION_BASE}${collection}`);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    if (nextToken) url.searchParams.set("next_token", nextToken);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: auth,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Oura API ${res.status}: ${body.slice(0, 200)}`);
    }

    const payload = await res.json();
    const batch = Array.isArray(payload?.data) ? payload.data : [];
    records.push(...batch);
    nextToken = payload?.next_token || null;
  } while (nextToken);

  return records;
}

function activityRowFromRecord(record, syncedAt) {
  const day = typeof record?.day === "string" ? record.day.slice(0, 10) : "";
  const steps = Number(record?.steps);
  if (!day || !Number.isFinite(steps)) return null;
  const score = Number(record?.score);
  return {
    day,
    steps: Math.max(0, Math.round(steps)),
    activity_score: Number.isFinite(score) ? Math.round(score) : null,
    synced_at: syncedAt,
  };
}

export async function upsertDailyActivity(db, records) {
  const syncedAt = new Date().toISOString();
  const rows = [];

  for (const record of records) {
    const row = activityRowFromRecord(record, syncedAt);
    if (row) rows.push(row);
  }

  for (let i = 0; i < rows.length; i += D1_BATCH_SIZE) {
    const chunk = rows.slice(i, i + D1_BATCH_SIZE);
    const statements = chunk.map((row) =>
      db
        .prepare(UPSERT_OURA_SQL)
        .bind(row.day, row.steps, row.activity_score, row.synced_at)
    );
    await db.batch(statements);
  }

  return rows.length;
}

export async function getLatestOuraSteps(db) {
  const row = await db
    .prepare("SELECT day, steps FROM oura_daily_activity ORDER BY day DESC LIMIT 1")
    .first();
  if (!row?.day) return null;
  return { day: row.day, steps: Number(row.steps) || 0 };
}

export async function getOuraStepsSummary(db) {
  const latest = await getLatestOuraSteps(db);
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM oura_daily_activity").first();
  const syncState = await loadSyncState(db);
  return {
    latest,
    total_days: Number(countRow?.n) || 0,
    sync_state: syncState,
  };
}

/**
 * The scheduled sync (and the admin's Sync now): daily activity over the steps
 * window, stored both as steps for /now/ and as the dashboard's documents, then
 * the last few days of every other dashboard kind. `upserted` counts activity
 * days only, which is what decides a rebuild.
 */
export async function syncOuraSteps(db, env, { mode } = {}) {
  const auth = ouraAuthHeader(env);

  const syncState = await loadSyncState(db);
  const today = formatDateEt();
  const useBackfill = mode === "backfill" || !syncState.backfill_complete;
  const startDate = useBackfill ? addDaysEt(today, -BACKFILL_DAYS) : addDaysEt(today, -INCREMENTAL_DAYS);
  const endDate = today;

  const records = await fetchOuraCollection(auth, OURA_KINDS.activity, startDate, endDate);
  const upserted = await upsertDailyActivity(db, records);
  await upsertOuraDocs(db, "activity", records);
  const dashboard = await syncOura(db, env, {
    kinds: Object.keys(OURA_KINDS).filter((k) => k !== "activity"),
    start: addDaysEt(today, -DASHBOARD_RECENT_DAYS),
    end: addDaysEt(today, 1),
  });
  const latest = await getLatestOuraSteps(db);

  await saveSyncState(db, {
    backfill_complete: useBackfill ? true : syncState.backfill_complete,
    last_sync_at: new Date().toISOString(),
    rows_upserted_last_run: upserted,
    last_start_date: startDate,
    last_end_date: endDate,
  });

  return {
    upserted,
    latestDay: latest?.day || null,
    latestSteps: latest?.steps ?? null,
    mode: useBackfill ? "backfill" : "incremental",
    start_date: startDate,
    end_date: endDate,
    dashboard: dashboard.counts,
  };
}

function trimmedDoc(kind, doc) {
  const drop = DROPPED_FIELDS[kind];
  if (!drop) return doc;
  const copy = { ...doc };
  for (const field of drop) delete copy[field];
  return copy;
}

/** Store Oura documents of one kind; returns how many were written. */
const filledFields = (doc) => Object.values(doc || {}).filter((v) => v !== null && v !== undefined).length;

/**
 * Oura sometimes returns two documents for one day (SpO2 does, one of them
 * empty). Keep the fuller one, so an empty duplicate can't overwrite a reading.
 */
function onePerDay(docs) {
  const byDay = new Map();
  for (const doc of docs || []) {
    const day = typeof doc?.day === "string" ? doc.day.slice(0, 10) : "";
    const kept = byDay.get(day);
    if (!kept || filledFields(doc) >= filledFields(kept)) byDay.set(day, doc);
  }
  return [...byDay.values()];
}

export async function upsertOuraDocs(db, kind, docs) {
  const syncedAt = new Date().toISOString();
  const statements = [];
  for (const doc of kind === "sessions" ? docs || [] : onePerDay(docs)) {
    const day = typeof doc?.day === "string" ? doc.day.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const data = JSON.stringify(trimmedDoc(kind, doc));
    if (kind === "sessions") {
      if (typeof doc.id !== "string" || !doc.id) continue;
      statements.push(db.prepare(UPSERT_SESSION_SQL).bind(doc.id, day, doc.type || null, data, syncedAt));
    } else {
      statements.push(db.prepare(UPSERT_DAILY_SQL).bind(kind, day, data, syncedAt));
    }
  }
  for (let i = 0; i < statements.length; i += D1_BATCH_SIZE) {
    await db.batch(statements.slice(i, i + D1_BATCH_SIZE));
  }
  return statements.length;
}

/**
 * Fetch and store some kinds over one window (inclusive days). Used for the
 * scheduled catch-up and, in 60-day windows, by scripts/backfill-oura.mjs:
 * two years of every kind in one request would outrun a Worker's CPU budget.
 */
export async function syncOura(db, env, { kinds, start, end }) {
  const auth = ouraAuthHeader(env);
  const wanted = (kinds || []).filter((k) => Object.hasOwn(OURA_KINDS, k));
  // `end` is inclusive here; Oura treats daily_activity's end_date as
  // exclusive, so ask for a day more (an extra day is just upserted again).
  const fetchEnd = addDays(end, 1);
  const fetched = await Promise.all(
    wanted.map((kind) => fetchOuraCollection(auth, OURA_KINDS[kind], start, fetchEnd))
  );
  const counts = {};
  for (let i = 0; i < wanted.length; i++) {
    const kind = wanted[i];
    counts[kind] = await upsertOuraDocs(db, kind, fetched[i]);
    if (kind === "activity") await upsertDailyActivity(db, fetched[i]);
  }
  return { counts, start, end };
}

// ── Read side: the admin Health tab ─────────────────────────────────────────

const DAILY_SERIES_SQL = {
  activity: `SELECT day,
    json_extract(data, '$.score') AS score, json_extract(data, '$.steps') AS steps,
    json_extract(data, '$.active_calories') AS active_calories, json_extract(data, '$.total_calories') AS total_calories,
    json_extract(data, '$.high_activity_time') AS high_activity_time, json_extract(data, '$.medium_activity_time') AS medium_activity_time,
    json_extract(data, '$.low_activity_time') AS low_activity_time, json_extract(data, '$.sedentary_time') AS sedentary_time
    FROM oura_daily WHERE kind = 'activity' AND day BETWEEN ? AND ?`,
  sleep: `SELECT day, json_extract(data, '$.score') AS score FROM oura_daily WHERE kind = 'sleep' AND day BETWEEN ? AND ?`,
  readiness: `SELECT day, json_extract(data, '$.score') AS score, json_extract(data, '$.temperature_deviation') AS temperature_deviation
    FROM oura_daily WHERE kind = 'readiness' AND day BETWEEN ? AND ?`,
  stress: `SELECT day, json_extract(data, '$.stress_high') AS stress_high, json_extract(data, '$.recovery_high') AS recovery_high
    FROM oura_daily WHERE kind = 'stress' AND day BETWEEN ? AND ?`,
  spo2: `SELECT day, json_extract(data, '$.spo2_percentage.average') AS spo2, json_extract(data, '$.breathing_disturbance_index') AS breathing_disturbance_index
    FROM oura_daily WHERE kind = 'spo2' AND day BETWEEN ? AND ?`,
  sessions: `SELECT day, type,
    json_extract(data, '$.total_sleep_duration') AS total_sleep_duration, json_extract(data, '$.deep_sleep_duration') AS deep_sleep_duration,
    json_extract(data, '$.rem_sleep_duration') AS rem_sleep_duration, json_extract(data, '$.light_sleep_duration') AS light_sleep_duration,
    json_extract(data, '$.awake_time') AS awake_time, json_extract(data, '$.efficiency') AS efficiency,
    json_extract(data, '$.lowest_heart_rate') AS lowest_heart_rate, json_extract(data, '$.average_hrv') AS average_hrv
    FROM oura_sleep_sessions WHERE day BETWEEN ? AND ?`,
};

const ACTIVITY_SERIES_FIELDS = ["steps", "activityScore", "activeCalories", "totalCalories", "highTime", "mediumTime", "lowTime", "sedentaryTime"];

export const DASHBOARD_RANGES = { 7: 7, 30: 30, 90: 90, 365: 365, all: null };

/**
 * Everything the Health tab draws, in one response: the chosen day (its
 * activity and the night after it, with the next morning's readiness), the
 * series for the range, and each metric's stats against the period before.
 * Series come from json_extract on scalar fields, so the stored arrays are only
 * ever read for the one day on screen.
 */
export async function getOuraDashboard(db, { day, range } = {}) {
  const today = formatDateEt();
  const latestRow = await db.prepare("SELECT MAX(day) AS day FROM oura_daily WHERE kind = 'activity'").first();
  const firstRow = await db.prepare("SELECT MIN(day) AS day FROM oura_daily").first();
  const latestDay = latestRow?.day || null;
  const firstDay = firstRow?.day || null;
  const fallbackDay = addDays(today, -1);
  const shownDay = /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day : fallbackDay;

  const rangeKey = Object.hasOwn(DASHBOARD_RANGES, String(range)) ? String(range) : "30";
  const span = DASHBOARD_RANGES[rangeKey];
  const end = today;
  const start = span ? addDays(end, -(span - 1)) : firstDay || addDays(end, -364);
  // The period before, for the comparison: same length, just ahead of it.
  const prevStart = span ? addDays(start, -span) : start;

  const rows = {};
  for (const [kind, sql] of Object.entries(DAILY_SERIES_SQL)) {
    const { results } = await db.prepare(sql).bind(prevStart, end).all();
    rows[kind] = results || [];
  }
  const all = buildSeries(rows);
  // Today's activity is only part of a day, and would drag every average and
  // "best" down; its sleep and readiness (last night) are complete and stay.
  for (const row of all) {
    if (row.day !== today) continue;
    for (const k of ACTIVITY_SERIES_FIELDS) delete row[k];
  }
  const series = all.filter((r) => r.day >= start && r.day <= end);
  const previous = span ? all.filter((r) => r.day >= prevStart && r.day < start) : [];
  const stats = {};
  for (const metric of Object.keys(SERIES_METRICS)) {
    stats[metric] = rangeStats(series, previous, metric);
  }

  // The day view: activity for the day, and the night that followed it, which
  // Oura files under the next morning, with that morning's readiness.
  const nextDay = addDays(shownDay, 1);
  const docRows = await db
    .prepare("SELECT kind, day, data FROM oura_daily WHERE (kind IN ('activity','stress','spo2') AND day = ?) OR (kind IN ('sleep','readiness') AND day = ?)")
    .bind(shownDay, nextDay)
    .all();
  const docs = {};
  for (const r of docRows.results || []) {
    try {
      docs[r.kind] = JSON.parse(r.data);
    } catch {
      /* a malformed row shows as missing */
    }
  }
  const sessionRows = await db.prepare("SELECT data FROM oura_sleep_sessions WHERE day = ?").bind(nextDay).all();
  docs.sessions = (sessionRows.results || [])
    .map((r) => {
      try {
        return JSON.parse(r.data);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const syncState = await loadSyncState(db);
  return {
    day: shownDay,
    nightOf: nextDay,
    today,
    firstDay,
    latestDay,
    range: rangeKey,
    start,
    end,
    detail: dayDetail(docs),
    series,
    stats,
    sync: { last_sync_at: syncState.last_sync_at || null },
  };
}
