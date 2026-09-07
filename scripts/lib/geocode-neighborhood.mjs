/**
 * Forward-geocode a neighborhood label ("Clinton Hill, Brooklyn") to a point.
 *
 * This is the mirror of the Worker's reverse lookup in `worker/location.mjs`:
 * that turns a private GPS fix into a label, this turns the label back into a
 * coordinate for the public Thinking map. Going through the label rather than
 * reading `location_points` is the whole point — the map can only ever be as
 * precise as a neighborhood name, which is what the site promises.
 *
 * Nominatim asks for at most one request per second and a real User-Agent, so
 * unlike the other build-time lookups these are issued in series with a pause
 * between them, NOT through mapWithConcurrency. There are only ~23 distinct
 * labels and the results are cached in D1, so a warm build issues none at all.
 */

const NOMINATIM_MIN_INTERVAL_MS = 1100;

/** Candidates to ask for, so a reference point has something to choose between. */
const NOMINATIM_CANDIDATES = 5;

/**
 * How far a resolved point may sit from the fix that produced its label.
 *
 * A neighborhood centroid is normally a couple of kilometres from a GPS fix
 * inside it; a large township or a bare county name can be further. 75 km is
 * generous for any real place while still catching the failure this exists for:
 * "Harris Township" resolving to Michigan when the fix was in Pennsylvania,
 * roughly 700 km away.
 */
export const MAX_REFERENCE_DRIFT_KM = 75;

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km. Degrees of longitude narrow toward the poles, so
 *  comparing raw degree deltas would bias every choice north. */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const DEFAULT_NOMINATIM_USER_AGENT =
  "rommy.blog-thinking-map/1.0 (neighborhood pins for rommy.blog; contact: rommy@gha.ly)";

function toPoint(result) {
  const lat = Number(result?.lat);
  const lon = Number(result?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Pull `{ lat, lon }` out of a Nominatim /search response body.
 *
 * Without a `reference` this takes Nominatim's own first choice. That is wrong
 * often enough to matter: a label like "Harris Township" carries no state, and
 * Nominatim's top hit for it is in Michigan while the note was written in
 * Pennsylvania — the right answer is present, just not first.
 *
 * So when the caller knows roughly where the label came from (the fix that
 * reverse-geocoded to it, see scripts/lib/label-references.mjs), the nearest
 * candidate wins instead, and a nearest candidate still further than
 * MAX_REFERENCE_DRIFT_KM is rejected outright rather than pinned somewhere
 * plainly wrong. Note the reference only ever *chooses between* candidates —
 * the coordinate returned is Nominatim's neighborhood centre, never the fix.
 */
export function pointFromNominatimResults(results, reference = null) {
  const points = (Array.isArray(results) ? results : []).map(toPoint).filter(Boolean);
  if (!points.length) return null;
  if (!reference || !Number.isFinite(reference.lat) || !Number.isFinite(reference.lon)) {
    return points[0];
  }

  let best = null;
  let bestKm = Infinity;
  for (const point of points) {
    const km = haversineKm(reference, point);
    if (km < bestKm) {
      best = point;
      bestKm = km;
    }
  }
  return bestKm <= MAX_REFERENCE_DRIFT_KM ? best : null;
}

export function nominatimSearchUrl(label) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", label);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(NOMINATIM_CANDIDATES));
  return url.toString();
}

async function geocodeOne(label, { userAgent, fetchImpl, reference }) {
  try {
    const res = await fetchImpl(nominatimSearchUrl(label), {
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
    if (!res.ok) return null;
    return pointFromNominatimResults(await res.json(), reference);
  } catch {
    return null;
  }
}

/**
 * Geocode `labels` in series, returning `{ label: {lat,lon} | false }`.
 *
 * A label that cannot be resolved records `false` rather than being omitted, so
 * the caller can tell "looked up, no such place" from "never looked up". The
 * caller decides whether to retry those — see the `retryEmpty` note at the call
 * site in build.mjs.
 */
export async function geocodeNeighborhoodLabels(
  labels,
  {
    userAgent = process.env.NOMINATIM_USER_AGENT || DEFAULT_NOMINATIM_USER_AGENT,
    fetchImpl = globalThis.fetch,
    minIntervalMs = NOMINATIM_MIN_INTERVAL_MS,
    references = {},
    onResult = () => {},
  } = {}
) {
  const out = {};
  const list = [...labels];
  for (let i = 0; i < list.length; i++) {
    const label = list[i];
    const point = await geocodeOne(label, {
      userAgent,
      fetchImpl,
      reference: references[label] || null,
    });
    out[label] = point || false;
    onResult(label, point);
    if (i < list.length - 1 && minIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, minIntervalMs));
    }
  }
  return out;
}
