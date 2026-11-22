// Neighborhood outlines for the /now/ map: the real shape of the current
// neighborhood instead of its bounding box, where one is known.
//
// Sources (worker/location.mjs): in NYC, the Who's On First polygon whose id
// NYC Planning's geosearch returns with the label, so the outline is always
// the same place as the name; elsewhere, the polygon Nominatim returns with
// the box when OpenStreetMap maps the neighborhood as an area (often it is
// only a point, and the map keeps the box). No Node built-ins: the Worker
// imports this.

/** Most points an outline may carry; past this it is treated as unusable. */
export const MAX_OUTLINE_POINTS = 4000;

const round = (n) => Math.round(n * 1e5) / 1e5; // ~1 m, plenty for a neighborhood edge

function cleanRing(ring) {
  if (!Array.isArray(ring)) return null;
  const out = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) return null;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    const p = [round(lon), round(lat)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length < 4) return null; // a closed ring needs 3 corners plus the closing point
  const [f, l] = [out[0], out[out.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);
  return out;
}

function cleanPolygon(rings) {
  if (!Array.isArray(rings) || !rings.length) return null;
  const cleaned = rings.map(cleanRing);
  // The outer ring must be good; a broken hole is just dropped.
  if (!cleaned[0]) return null;
  return cleaned.filter(Boolean);
}

/**
 * A GeoJSON geometry made safe to send to the map: Polygon or MultiPolygon
 * only, numeric and in range, coordinates rounded, and small enough to draw.
 * Returns null for anything else (a Point, a line, junk, something huge), and
 * the caller falls back to the box.
 */
export function cleanOutline(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  let polygons;
  if (geometry.type === "Polygon") polygons = [geometry.coordinates];
  else if (geometry.type === "MultiPolygon") polygons = geometry.coordinates;
  else return null;
  if (!Array.isArray(polygons)) return null;
  const cleaned = polygons.map(cleanPolygon).filter(Boolean);
  if (!cleaned.length) return null;
  const points = cleaned.flat(2).length;
  if (points > MAX_OUTLINE_POINTS) return null;
  return cleaned.length === 1
    ? { type: "Polygon", coordinates: cleaned[0] }
    : { type: "MultiPolygon", coordinates: cleaned };
}

/** [west, south, east, north] of an outline, or null. */
export function outlineBbox(geometry) {
  const g = cleanOutline(geometry);
  if (!g) return null;
  const pts = g.type === "Polygon" ? g.coordinates.flat() : g.coordinates.flat(2);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/**
 * Whether an outline plausibly is the place the box describes: its own box
 * overlaps the given one. Guards against a lookup returning some other place
 * with the same name.
 */
export function outlineMatchesBbox(geometry, bbox) {
  const ob = outlineBbox(geometry);
  if (!ob || !Array.isArray(bbox) || bbox.length !== 4) return false;
  const [w, s, e, n] = bbox;
  return ob[0] <= e && ob[2] >= w && ob[1] <= n && ob[3] >= s;
}
