const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection/daily_activity";
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
  const records = [];
  let nextToken = null;

  do {
    const url = new URL(OURA_API_BASE);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    if (nextToken) url.searchParams.set("next_token", nextToken);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
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

export async function syncOuraSteps(db, env, { mode } = {}) {
  const token = ouraToken(env);
  if (!token) {
    throw new Error("OURA_ACCESS_TOKEN is not configured");
  }

  const syncState = await loadSyncState(db);
  const today = formatDateEt();
  const useBackfill = mode === "backfill" || !syncState.backfill_complete;
  const startDate = useBackfill ? addDaysEt(today, -BACKFILL_DAYS) : addDaysEt(today, -INCREMENTAL_DAYS);
  const endDate = today;

  const records = await fetchDailyActivity(token, startDate, endDate);
  const upserted = await upsertDailyActivity(db, records);
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
  };
}
