/**
 * Live publishing: the pure parts, shared by the build and the Worker.
 *
 * Every content write records a row in `content_changes` (kind, key, op).
 * The build stamps the highest change id it had seen on each page it writes
 * — the watermark — and the live overlay applies anything newer, so a post
 * appears before the Pages rebuild that will contain it lands. See
 * worker/live-overlay.mjs for the HTML side.
 */

/** The kinds of content the overlay knows how to place, keyed by table. */
export const CONTENT_KIND = {
  THINKING: "thinking",
  POST: "post",
  READING: "reading",
  FAVORITE: "favorite",
  LINKLOG: "linklog",
};

export const CONTENT_KINDS = new Set(Object.values(CONTENT_KIND));

/** The `data-live-key` a rendered item carries. */
export function liveKey(kind, key) {
  return `${kind}:${key}`;
}

/** Watermark meta tag, written into the <head> of every generated page. */
export const WATERMARK_META = "live-watermark";

export function watermarkMetaHtml(watermark) {
  return `<meta name="${WATERMARK_META}" content="${Number(watermark) || 0}" />`;
}

/** Read the watermark back out of a page; 0 when the page has none. */
export function readWatermark(html) {
  const m = new RegExp(`<meta name="${WATERMARK_META}" content="(\\d+)"`).exec(String(html || ""));
  return m ? Number(m[1]) : 0;
}

/**
 * Collapse change rows to the latest op per item. Rows may arrive in any
 * order; the highest id wins, so an upsert followed by a delete is a delete
 * and a delete followed by an upsert (unpublish, then publish again) is an
 * upsert. Unknown kinds are dropped.
 *
 * @returns {Map<string, {kind: string, key: string, op: "upsert"|"delete", id: number}>}
 *   keyed by liveKey(kind, key)
 */
export function collapseChanges(rows) {
  const out = new Map();
  for (const row of rows || []) {
    if (!CONTENT_KINDS.has(row.kind)) continue;
    if (row.op !== "upsert" && row.op !== "delete") continue;
    const id = Number(row.id);
    const k = liveKey(row.kind, String(row.key));
    const prev = out.get(k);
    if (!prev || id > prev.id) out.set(k, { kind: row.kind, key: String(row.key), op: row.op, id });
  }
  return out;
}

/**
 * Lists on the site run newest first. `data-live-sort` holds a string that
 * sorts the same way the build sorts — compare as strings, larger first.
 * Returns true when an item with sort `a` belongs above one with sort `b`.
 */
export function sortsAbove(a, b) {
  return String(a) > String(b);
}

/** Sort value for an item dated by an ISO datetime (Thinking, Writing, Sharing). */
export function datetimeSort(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * Sort value for a Reading row, matching sortReadingByYmDesc in build.mjs:
 * month read, then when it was added, then id.
 */
export function readingSort(r) {
  const added = datetimeSort(r?.added_at) || "0000";
  const id = String(Number(r?.id) || 0).padStart(10, "0");
  return `${String(r?.ym || "")}|${added}|${id}`;
}

function attrEsc(v) {
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Mark a rendered item for the overlay: `data-live-key` names it,
 * `data-live-sort` places it. Added to the item's first tag, so the renderers
 * themselves stay unaware of live publishing.
 */
export function withLiveAttrs(html, key, sort) {
  return String(html).replace(
    /<([a-zA-Z][a-zA-Z0-9]*)/,
    `<$1 data-live-key="${attrEsc(key)}" data-live-sort="${attrEsc(sort)}"`
  );
}

/** Attributes for a list container: its name, and how its items are ordered. */
export function liveListAttrs(name, { order = "desc", group = null } = {}) {
  let out = ` data-live-list="${attrEsc(name)}"`;
  if (order !== "desc") out += ` data-live-order="${attrEsc(order)}"`;
  if (group != null) out += ` data-live-group="${attrEsc(group)}"`;
  return out;
}

/** "2026-11" for an ISO datetime, in New York time — the Thinking grid's month. */
export function monthKeyET(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(d);
}

/** Sort value for a Writing post or Sharing link (datetime, else noon on its date). */
export function datedItemSort(p) {
  return datetimeSort(p?.datetime || (p?.date ? `${p.date}T12:00:00.000Z` : ""));
}
