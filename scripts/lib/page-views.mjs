/**
 * Page-view counts for the two permalink pages — a Thinking note and a
 * Writing post. The Worker counts a view per page load (worker/page-views.mjs)
 * into the D1 `page_views` table, keyed by the page's canonical path; the
 * history before that was seeded once from a Google Analytics export
 * (scripts/seed-page-views.mjs). Both use the helpers here, so a GA row and a
 * live request for the same page land on the same key.
 *
 * Imported by the Worker: no Node built-ins.
 */

const THINKING_FILTER_SEGMENTS = new Set(["images", "videos", "audio", "youtube", "music", "text"]);

/**
 * The canonical counter key for a permalink path — `/thinking/<slug>/` or
 * `/posts/<slug>/` — or null for any other page. Tolerates what analytics
 * exports carry: a missing trailing slash, a query string or fragment, a
 * full URL, and percent-encoding.
 */
export function permalinkViewPath(input) {
  let path = String(input || "").trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const m = /^\/(thinking|posts)\/([^/]+)\/?$/.exec(decoded);
  if (!m) return null;
  const [, section, slug] = m;
  if (section === "thinking" && THINKING_FILTER_SEGMENTS.has(slug)) return null;
  return `/${section}/${slug}/`;
}

// Crawlers, link unfurlers, monitors and scripted clients — not a person
// reading the page. Matched against the User-Agent; an empty one counts as
// a script too.
const NON_READER_UA =
  /bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|undici|libwww|httpclient|feedfetcher|feedly|inoreader|newsblur|\brss\b/i;

/**
 * Whether a request is a page load to count: a GET from what looks like a
 * browser, and not a speculative prefetch or prerender the reader may
 * never see. `headers` is anything with a `get(name)` method.
 */
export function isCountableView(method, headers) {
  if (String(method).toUpperCase() !== "GET") return false;
  const ua = headers.get("user-agent") || "";
  if (!ua || NON_READER_UA.test(ua)) return false;
  const purpose = `${headers.get("sec-purpose") || ""} ${headers.get("purpose") || ""} ${headers.get("x-moz") || ""}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  return true;
}

/** "1 view", "1,234 views". */
export function formatViews(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  return `${count.toLocaleString("en-US")} ${count === 1 ? "view" : "views"}`;
}

/** Split one CSV line, honouring double-quoted fields. */
function csvFields(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * Per-permalink view totals from a Google Analytics 4 "Pages and screens"
 * CSV export. GA prefixes the table with `#` comment lines and may append a
 * totals row; the header row is found by its columns (a "Page path…" column
 * and a "Views" column), and rows are summed by canonical path, since GA
 * reports `/posts/x` and `/posts/x/` separately. Non-permalink rows are
 * dropped. Returns a Map of path → views.
 */
export function parseGaPagesCsv(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  let pathCol = -1;
  let viewsCol = -1;
  const totals = new Map();
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const fields = csvFields(line);
    if (pathCol === -1) {
      const lower = fields.map((f) => f.toLowerCase());
      const p = lower.findIndex((f) => f.startsWith("page path") || f === "pagepath" || f === "page location");
      const v = lower.findIndex((f) => f === "views" || f === "screenpageviews");
      if (p !== -1 && v !== -1) {
        pathCol = p;
        viewsCol = v;
      }
      continue;
    }
    const path = permalinkViewPath(fields[pathCol]);
    const views = Number(String(fields[viewsCol] || "").replace(/,/g, ""));
    if (!path || !Number.isFinite(views) || views <= 0) continue;
    totals.set(path, (totals.get(path) || 0) + Math.floor(views));
  }
  if (pathCol === -1) {
    throw new Error('No header row with a "Page path" column and a "Views" column found in the CSV');
  }
  return totals;
}
