const LOCATION_LOOKUP_WINDOW_MS = 15 * 60 * 1000;
const MAX_HORIZONTAL_ACCURACY_M = 150;
const GEOCODE_DECIMALS = 4;

function parseOverlandTimestamp(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function locationAuthOk(request, env) {
  const expected = env.LOCATION_API_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && match[1] === expected);
}

function overlandFeatureToRow(feature, createdAt) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const props = feature?.properties || {};
  const recordedAt = parseOverlandTimestamp(props.timestamp);
  if (!recordedAt) return null;
  const horizontalAccuracy = Number(props.horizontal_accuracy);
  return {
    device_id: typeof props.device_id === "string" ? props.device_id : "",
    recorded_at: recordedAt,
    lat,
    lon,
    horizontal_accuracy: Number.isFinite(horizontalAccuracy) ? horizontalAccuracy : null,
    altitude: Number.isFinite(Number(props.altitude)) ? Number(props.altitude) : null,
    speed: Number.isFinite(Number(props.speed)) && Number(props.speed) >= 0 ? Number(props.speed) : null,
    course: Number.isFinite(Number(props.course)) && Number(props.course) >= 0 ? Number(props.course) : null,
    battery_level: Number.isFinite(Number(props.battery_level)) ? Number(props.battery_level) : null,
    created_at: createdAt,
  };
}

function geocodeCacheKey(lat, lon) {
  return `${lat.toFixed(GEOCODE_DECIMALS)},${lon.toFixed(GEOCODE_DECIMALS)}`;
}

function neighborhoodLabelFromAddress(address = {}) {
  const neighborhood =
    address.neighbourhood ||
    address.suburb ||
    address.city_district ||
    address.quarter ||
    address.hamlet ||
    "";
  const borough =
    address.borough ||
    address.city ||
    address.town ||
    address.village ||
    address.county ||
    "";
  if (neighborhood && borough && neighborhood.toLowerCase() !== borough.toLowerCase()) {
    return `${neighborhood}, ${borough}`;
  }
  return neighborhood || borough || "";
}

async function reverseGeocodeLabel(lat, lon, env) {
  const userAgent =
    env.NOMINATIM_USER_AGENT ||
    "rommy.blog-location/1.0 (private location tracking; contact: rommy@gha.ly)";
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "16");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
    },
  });
  if (!res.ok) return "";
  const data = await res.json();
  return neighborhoodLabelFromAddress(data.address || {});
}

async function getGeocodeLabel(db, lat, lon, env) {
  const cacheKey = geocodeCacheKey(lat, lon);
  const cached = await db.prepare("SELECT label FROM geocode_cache WHERE cache_key = ?").bind(cacheKey).first();
  if (cached?.label) return cached.label;

  const label = await reverseGeocodeLabel(lat, lon, env);
  if (!label) return "";

  await db
    .prepare("INSERT INTO geocode_cache (cache_key, label, created_at) VALUES (?, ?, ?)")
    .bind(cacheKey, label, new Date().toISOString())
    .run();
  return label;
}

export async function ingestOverlandLocations(db, payload) {
  const locations = Array.isArray(payload?.locations) ? payload.locations : [];
  const createdAt = new Date().toISOString();
  let inserted = 0;

  for (const feature of locations) {
    const row = overlandFeatureToRow(feature, createdAt);
    if (!row) continue;
    await db
      .prepare(
        `INSERT INTO location_points
          (device_id, recorded_at, lat, lon, horizontal_accuracy, altitude, speed, course, battery_level, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.device_id,
        row.recorded_at,
        row.lat,
        row.lon,
        row.horizontal_accuracy,
        row.altitude,
        row.speed,
        row.course,
        row.battery_level,
        row.created_at
      )
      .run();
    inserted += 1;
  }

  return inserted;
}

export async function resolveLocationLabelForDatetime(db, env, isoDatetime) {
  if (!isoDatetime) return "";
  const targetMs = Date.parse(isoDatetime);
  if (!Number.isFinite(targetMs)) return "";

  const fromIso = new Date(targetMs - LOCATION_LOOKUP_WINDOW_MS).toISOString();
  const toIso = new Date(targetMs + LOCATION_LOOKUP_WINDOW_MS).toISOString();

  const { results } = await db
    .prepare(
      `SELECT lat, lon, recorded_at, horizontal_accuracy
       FROM location_points
       WHERE recorded_at >= ? AND recorded_at <= ?
         AND (horizontal_accuracy IS NULL OR horizontal_accuracy <= ?)
       ORDER BY ABS(strftime('%s', recorded_at) - strftime('%s', ?)) ASC
       LIMIT 1`
    )
    .bind(fromIso, toIso, MAX_HORIZONTAL_ACCURACY_M, isoDatetime)
    .all();

  const point = results?.[0];
  if (!point) return "";
  return getGeocodeLabel(db, point.lat, point.lon, env);
}

export async function handleLocationIngest(request, env) {
  if (!env.DB) {
    return json({ error: "Database not configured" }, 500);
  }
  if (!locationAuthOk(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  try {
    const inserted = await ingestOverlandLocations(env.DB, payload);
    return json({ result: "ok", inserted });
  } catch (err) {
    return json({ error: err.message || "Ingest failed" }, 500);
  }
}

export async function handleLocationQuery(payload, db, env) {
  const from = typeof payload.from === "string" ? payload.from : "";
  const to = typeof payload.to === "string" ? payload.to : "";
  const limit = Math.min(Math.max(Number(payload.limit) || 1000, 1), 5000);

  let sql = `SELECT device_id, recorded_at, lat, lon, horizontal_accuracy, altitude, speed, course, battery_level
             FROM location_points`;
  const params = [];
  const clauses = [];
  if (from) {
    clauses.push("recorded_at >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("recorded_at <= ?");
    params.push(to);
  }
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY recorded_at ASC LIMIT ?";
  params.push(limit);

  const { results } = await db.prepare(sql).bind(...params).all();
  return {
    ok: true,
    count: results?.length || 0,
    points: results || [],
  };
}

export async function handleBackfillThinkingLocations(db, env) {
  const { results: rows } = await db
    .prepare(
      `SELECT slug, datetime FROM thinking_posts
       WHERE location_label IS NULL OR location_label = ''
       ORDER BY datetime ASC`
    )
    .all();

  let updated = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const label = await resolveLocationLabelForDatetime(db, env, row.datetime);
    if (!label) {
      skipped += 1;
      continue;
    }
    await db.prepare("UPDATE thinking_posts SET location_label = ? WHERE slug = ?").bind(label, row.slug).run();
    updated += 1;
  }

  return { updated, skipped, total: (rows || []).length };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
