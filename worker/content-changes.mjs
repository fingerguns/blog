/**
 * The live-publishing change log (content_changes) — the Worker's half.
 *
 * Every content write calls recordContentChange() beside its D1 statement.
 * The live overlay (live-overlay.mjs) applies whatever was recorded after the
 * build that produced a page, so a post shows up before the Pages rebuild
 * that will contain it. A write site that forgets to record a change is not
 * broken, only slow: the change still arrives with the rebuild.
 */
import { CONTENT_KINDS } from "../scripts/lib/live-changes.mjs";

const RETENTION_DAYS = 7;

// The newest change id, held in the edge cache so a page view with nothing
// new costs no D1 query. caches.default is per data centre, so a write purges
// only the copy where it ran; elsewhere the id is at most this stale.
const LATEST_TTL_SECONDS = 10;
const LATEST_CACHE_URL = "https://rommy.blog/__live/latest-change-id";

/**
 * Record one add, edit or delete. Never throws: losing a change-log row only
 * costs the live overlay that item until the rebuild, which must not fail the
 * write that is already in D1.
 */
export async function recordContentChange(db, kind, key, op) {
  if (!db || !CONTENT_KINDS.has(kind) || key == null || key === "") return;
  try {
    await db
      .prepare("INSERT INTO content_changes (kind, key, op, created_at) VALUES (?, ?, ?, ?)")
      .bind(kind, String(key), op === "delete" ? "delete" : "upsert", new Date().toISOString())
      .run();
    await caches.default.delete(LATEST_CACHE_URL);
  } catch (err) {
    console.error(`content_changes: could not record ${kind}:${key} ${op}`, err);
  }
}

/** Newest change id (0 when there are none, or the table is missing). */
export async function latestChangeId(db) {
  const cache = caches.default;
  const hit = await cache.match(LATEST_CACHE_URL);
  if (hit) return Number(await hit.text()) || 0;
  let id = 0;
  try {
    const row = await db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM content_changes").first();
    id = Number(row?.id) || 0;
  } catch {
    id = 0;
  }
  await cache.put(
    LATEST_CACHE_URL,
    new Response(String(id), { headers: { "Cache-Control": `max-age=${LATEST_TTL_SECONDS}` } })
  );
  return id;
}

/** Change rows newer than a page's watermark, oldest first. */
export async function changesSince(db, watermark) {
  const { results } = await db
    .prepare("SELECT id, kind, key, op FROM content_changes WHERE id > ? ORDER BY id")
    .bind(Number(watermark) || 0)
    .all();
  return results || [];
}

/**
 * A row is only needed until the next successful deploy; a week is ample
 * margin for a stuck build. Called from the cron.
 */
export async function pruneContentChanges(db) {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare("DELETE FROM content_changes WHERE created_at < ?").bind(cutoff).run();
  } catch (err) {
    console.error("content_changes: prune failed", err);
  }
}
