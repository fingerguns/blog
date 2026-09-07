/**
 * Map view for the Thinking archive.
 *
 * A Thinking post stores a *label* ("Clinton Hill, Brooklyn"), never a
 * coordinate — the GPS log those labels were derived from is private and stays
 * that way (see the location notes in README.md). So the map is built by
 * geocoding the handful of distinct labels forward into a point, and every post
 * sharing a label shares that one point exactly.
 *
 * That is why there is no clustering library here. Posts do not land *near* each
 * other and need grouping; they land on the identical coordinate, and no amount
 * of zooming would ever separate them. Grouping by label up front is both
 * cheaper and more honest: one marker per neighborhood, carrying its own count.
 */

/** Longest a post's map-overlay excerpt runs before it is cut. */
export const MAP_EXCERPT_MAX = 220;

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
};

/**
 * Turn `&gt;` back into `>`.
 *
 * The excerpt is handed to the browser as JSON and written with `textContent`,
 * which does no entity decoding of its own — so an entity left encoded here is
 * shown to the reader verbatim, as a literal "&gt;". `stripHtml` removes tags
 * but deliberately leaves entities alone, so the decoding has to happen here.
 * `&amp;` is resolved last so that `&amp;gt;` stays the text "&gt;" rather than
 * being decoded twice into ">".
 */
export function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => {
      const key = name.toLowerCase();
      if (key === "amp") return match;
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
    })
    .replace(/&amp;/gi, "&");
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function mapExcerpt(text, max = MAP_EXCERPT_MAX) {
  const plain = decodeEntities(text).replace(/\s+/g, " ").trim();
  if (!plain) return "";
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

/**
 * Group located posts into one entry per neighborhood.
 *
 * `entries` are `{ slug, label, kind, text, date, dateText }`. `coordsByLabel` maps a
 * label to `{ lat, lon }`, or to a falsy value for a label that could not be
 * geocoded. A post is dropped when it has no label or its label has no point —
 * a marker at a guessed location would be worse than no marker.
 *
 * Places come back busiest-first and posts inside a place newest-first. Note
 * that busiest-first is a *data* order, not a paint order — the map deliberately
 * adds markers in reverse so the densest pin ends up on top rather than buried
 * under the single-post pins that share its corner of the city.
 */
export function groupThinkingByPlace(entries = [], coordsByLabel = {}) {
  const byLabel = new Map();

  for (const entry of entries) {
    const label = String(entry?.label || "").trim();
    if (!label) continue;

    const coords = coordsByLabel[label];
    const lat = Number(coords?.lat);
    const lon = Number(coords?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (!byLabel.has(label)) byLabel.set(label, { label, lat, lon, posts: [] });
    byLabel.get(label).posts.push({
      slug: String(entry.slug || ""),
      kind: String(entry.kind || "text"),
      text: mapExcerpt(entry.text),
      date: String(entry.date || ""),
      // Formatted by the caller, which owns the site's ET date formatting.
      dateText: String(entry.dateText || ""),
    });
  }

  const places = [...byLabel.values()];
  for (const place of places) {
    place.posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  places.sort((a, b) => b.posts.length - a.posts.length || a.label.localeCompare(b.label));
  return places;
}

/**
 * Bounding box `[west, south, east, north]` covering every place, or null when
 * there is nothing to fit. A single place has zero extent, so the map falls back
 * to centring on it rather than fitting a degenerate box.
 */
export function placesBounds(places = []) {
  if (!places.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of places) {
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  if (west === east && south === north) return null;
  return [west, south, east, north];
}
