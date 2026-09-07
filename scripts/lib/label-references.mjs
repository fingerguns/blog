/**
 * Where each neighborhood label actually came from.
 *
 * The Worker's `geocode_cache` table is a reverse-geocode memo: its key is a
 * `"lat,lon"` fix and its value is the label that fix resolved to. Read
 * backwards it answers the question the forward geocode cannot — *which*
 * "Harris Township" this is — because it holds the coordinates that produced
 * the name in the first place.
 *
 * These points are a build-time disambiguator only. They pick between Nominatim
 * candidates and are never published: the coordinate that reaches the page is
 * always Nominatim's neighborhood centre. Keeping raw fixes off the public site
 * is the whole reason the map geocodes labels rather than reading the GPS log.
 */

/** `SELECT` the reverse-geocode memo backwards. */
export const LABEL_REFERENCE_SQL =
  "SELECT label, cache_key FROM geocode_cache WHERE label IS NOT NULL AND label != ''";

function parseCacheKey(key) {
  const parts = String(key || "").split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Collapse `{label, cache_key}` rows into one reference point per label.
 *
 * A label usually has several fixes behind it — 38 notes from home leave dozens
 * of nearby keys — so the mean is taken rather than an arbitrary first row. The
 * mean of points inside one neighborhood is still inside it, which is all the
 * precision this needs; it is a "which of these five candidates" hint, not a
 * location.
 */
export function referencePointsFromRows(rows = []) {
  const sums = new Map();

  for (const row of rows) {
    const label = String(row?.label || "").trim();
    if (!label) continue;
    const point = parseCacheKey(row?.cache_key);
    if (!point) continue;

    const acc = sums.get(label) || { lat: 0, lon: 0, n: 0 };
    acc.lat += point.lat;
    acc.lon += point.lon;
    acc.n += 1;
    sums.set(label, acc);
  }

  const out = {};
  for (const [label, acc] of sums) {
    out[label] = { lat: acc.lat / acc.n, lon: acc.lon / acc.n };
  }
  return out;
}
