/**
 * Client-side search over the whole site.
 *
 * The corpus is small — a few hundred items, well under 100 KB of text — so
 * the entire index ships as one JSON file and matching happens in the browser.
 * No server, no index server, nothing to keep in sync.
 *
 * This file is both imported by the build (to shape the index) and copied to
 * dist/search.js and imported by /search/ as a module, so the scoring that
 * `npm test` covers is the same code that runs in the browser.
 *
 * Index documents use short keys to keep the payload small:
 *   k  kind      "writing" | "thinking" | "reading" | "must-read" | "sharing"
 *   t  title     display title (may be empty for Thinking notes)
 *   x  text      searchable body, already stripped of markup
 *   u  url       where the result links
 *   d  date      ISO date, for display and recency tie-breaks
 */

export const KIND_LABELS = {
  writing: "Writing",
  thinking: "Thinking",
  reading: "Reading",
  "must-read": "Must Read",
  sharing: "Sharing",
};

/** Longest body text kept per document. Full posts are far longer than anyone
 *  searches for, and the tail contributes little but bytes. */
export const MAX_TEXT = 600;

export function normalize(value) {
  return String(value || "")
    .toLowerCase()
    // Fold accents so "cortazar" finds "Cortázar".
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Curly quotes and dashes become their plain equivalents.
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(query) {
  return normalize(query)
    .split(/[^a-z0-9'-]+/)
    .filter((t) => t.length > 0);
}

export function truncate(text, max = MAX_TEXT) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  // Cut on a word boundary rather than mid-word.
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * Score one document against pre-tokenized query terms.
 * Returns 0 when any term is missing — all terms must match somewhere, so
 * adding a word narrows results rather than widening them.
 */
export function scoreDoc(doc, terms) {
  if (terms.length === 0) return 0;

  const title = normalize(doc.t);
  const text = normalize(doc.x);
  let score = 0;

  for (const term of terms) {
    const inTitle = title.includes(term);
    const inText = text.includes(term);
    if (!inTitle && !inText) return 0;

    // A title hit is worth more than a body hit.
    if (inTitle) {
      score += 10;
      // Prefix matches beat mid-word ones: "wal" should rank "Walking" above
      // a post that merely contains "sidewalk".
      if (new RegExp(`\\b${escapeRegex(term)}`).test(title)) score += 6;
      if (title === term) score += 12;
    }
    if (inText) {
      score += 3;
      if (new RegExp(`\\b${escapeRegex(term)}`).test(text)) score += 2;
    }
  }

  // Whole-phrase hits outrank scattered term hits.
  if (terms.length > 1) {
    const phrase = terms.join(" ");
    if (title.includes(phrase)) score += 20;
    else if (text.includes(phrase)) score += 8;
  }

  return score;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rank documents for a query. Ties break toward the more recent item, so an
 * archive that keeps growing does not bury new writing under old.
 */
export function search(docs, query, { limit = 50 } = {}) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const hits = [];
  for (const doc of docs) {
    const score = scoreDoc(doc, terms);
    if (score > 0) hits.push({ doc, score });
  }

  hits.sort((a, b) => b.score - a.score || String(b.doc.d).localeCompare(String(a.doc.d)));
  return hits.slice(0, limit);
}

/**
 * A short excerpt centred on the first matching term, for result display.
 * Returns plain text; the caller is responsible for escaping.
 */
export function excerpt(doc, terms, { radius = 90 } = {}) {
  const text = String(doc.x || "").trim();
  if (!text) return "";

  const haystack = normalize(text);
  let at = -1;
  for (const term of terms) {
    const i = haystack.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return truncate(text, radius * 2);

  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}
