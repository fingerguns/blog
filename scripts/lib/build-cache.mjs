/**
 * Build-time caches, stored in D1 rather than committed JSON.
 *
 * These caches exist so the build does not refetch book covers, Spotify art,
 * video posters, and link unfurls on every run. Holding them in data/*.json
 * meant Cloudflare Pages wrote them to an ephemeral checkout and threw them
 * away — only a local build followed by a commit ever warmed the cache, and
 * the churn showed up as dirty working-tree files.
 *
 * Values are JSON-encoded, so `false` (meaning "checked, nothing available")
 * round-trips as a present key — the build relies on `key in cache` to avoid
 * retrying known-empty lookups.
 */

import { existsSync, readFileSync } from "node:fs";
import { d1Configured, d1Query } from "../d1-client.mjs";

export const CACHE_NAMESPACES = {
  READING_COVERS: "reading-covers",
  SPOTIFY_THUMBNAILS: "spotify-thumbnails",
  VIDEO_POSTERS: "video-posters",
  LINKLOG_UNFURLS: "linklog-unfurls",
};

/** Legacy on-disk locations, used to seed D1 and as a read fallback. */
export const LEGACY_CACHE_FILES = {
  [CACHE_NAMESPACES.READING_COVERS]: "data/reading-covers.json",
  [CACHE_NAMESPACES.SPOTIFY_THUMBNAILS]: "data/spotify-thumbnails.json",
  [CACHE_NAMESPACES.VIDEO_POSTERS]: "data/video-posters.json",
  [CACHE_NAMESPACES.LINKLOG_UNFURLS]: "data/linklog-unfurls.json",
};

// One multi-row INSERT per chunk. Two D1 constraints shape this:
//   1. The REST /query endpoint takes a single statement object, not an array.
//      d1Batch() in d1-client.mjs sends an array and is rejected with
//      "Expected object, received array", so it is not used here.
//   2. D1 allows at most 100 bound parameters per query. At four per row
//      (namespace, key, value, updated_at) that caps a chunk at 25 rows;
//      20 leaves headroom.
const ROWS_PER_STATEMENT = 20;

// namespace -> Map(key -> serialized value) as it was when loaded, so save()
// can write only what actually changed.
const snapshots = new Map();

function serialize(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function snapshot(namespace, entries) {
  const map = new Map();
  for (const [key, value] of Object.entries(entries)) {
    map.set(key, serialize(value));
  }
  snapshots.set(namespace, map);
}

function readLegacyFile(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read one cache namespace. Falls back to the legacy JSON file when D1 is
 * unconfigured or the namespace is empty, so a local build without .env still
 * works and the first run after this change is not cold.
 */
export async function loadBuildCache(namespace, { legacyFile, skipLegacy = false } = {}) {
  const entries = {};

  if (d1Configured()) {
    try {
      const rows = await d1Query(
        "SELECT key, value FROM build_cache WHERE namespace = ?",
        [namespace]
      );
      for (const row of rows) {
        try {
          entries[row.key] = JSON.parse(row.value);
        } catch {
          // Corrupt row: leave the key absent so the build refetches it.
        }
      }
    } catch (err) {
      console.warn(`build cache: could not read "${namespace}" from D1 — ${err.message}`);
    }
  }

  if (!skipLegacy && Object.keys(entries).length === 0) {
    const legacy = readLegacyFile(legacyFile || LEGACY_CACHE_FILES[namespace]);
    if (legacy) {
      Object.assign(entries, legacy);
      console.log(
        `build cache: seeded "${namespace}" from ${legacyFile || LEGACY_CACHE_FILES[namespace]} (${Object.keys(legacy).length} entries)`
      );
      // Deliberately not snapshotted below — leaving the snapshot empty makes
      // the next save() write every entry, which is what seeds D1.
      snapshots.set(namespace, new Map());
      return entries;
    }
  }

  snapshot(namespace, entries);
  return entries;
}

/**
 * Persist a namespace, writing only entries that changed since load.
 * Safe to call unconditionally — an unchanged cache is a no-op.
 */
export async function saveBuildCache(namespace, entries) {
  const previous = snapshots.get(namespace) || new Map();
  const updatedAt = new Date().toISOString();

  const changed = [];
  for (const [key, value] of Object.entries(entries)) {
    const encoded = serialize(value);
    if (previous.get(key) === encoded) continue;
    changed.push([key, encoded]);
  }

  if (changed.length === 0) return { written: 0 };

  if (!d1Configured()) {
    console.warn(
      `build cache: D1 not configured — ${changed.length} "${namespace}" entries not persisted`
    );
    return { written: 0 };
  }

  try {
    for (let i = 0; i < changed.length; i += ROWS_PER_STATEMENT) {
      const chunk = changed.slice(i, i + ROWS_PER_STATEMENT);
      const tuples = chunk.map(() => "(?, ?, ?, ?)").join(", ");
      const params = chunk.flatMap(([key, encoded]) => [namespace, key, encoded, updatedAt]);
      await d1Query(
        `INSERT INTO build_cache (namespace, key, value, updated_at)
         VALUES ${tuples}
         ON CONFLICT(namespace, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        params
      );
    }
  } catch (err) {
    // A cache that cannot be written is a slow build, not a broken one.
    console.warn(`build cache: could not write "${namespace}" to D1 — ${err.message}`);
    return { written: 0 };
  }

  snapshot(namespace, entries);
  return { written: changed.length };
}
