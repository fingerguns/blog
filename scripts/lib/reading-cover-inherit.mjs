import { isbnFromBookshopUrl } from "./bookshop-affiliate.mjs";

export function normalizeReadingTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildLatestCoverLookup(entries, coverForEntry) {
  const byIsbn = new Map();
  const byTitle = new Map();
  for (const entry of entries) {
    const cover = coverForEntry(entry);
    if (!cover) continue;
    const isbn = isbnFromBookshopUrl(entry.url);
    if (isbn) byIsbn.set(isbn, cover);
    const titleKey = normalizeReadingTitle(entry.title);
    if (titleKey) byTitle.set(titleKey, cover);
  }
  return { byIsbn, byTitle };
}

export function inheritLatestCover(favorite, lookup) {
  if (favorite.cover_url) return null;
  const isbn = isbnFromBookshopUrl(favorite.url);
  if (isbn && lookup.byIsbn.has(isbn)) return lookup.byIsbn.get(isbn);
  const titleKey = normalizeReadingTitle(favorite.title);
  if (titleKey && lookup.byTitle.has(titleKey)) return lookup.byTitle.get(titleKey);
  return null;
}

/**
 * A book's cover from the build's "reading-covers" cache: by URL, else by any
 * cached entry with the same ISBN.
 */
export function coverFromCacheFor(url, cache) {
  if (!url) return null;
  if (cache[url]) return cache[url];
  const isbn = isbnFromBookshopUrl(url);
  if (!isbn) return null;
  for (const [key, cover] of Object.entries(cache)) {
    if (isbnFromBookshopUrl(key) === isbn) return cover;
  }
  return null;
}

// Open Library URLs in the cache are auto-fetched fallbacks and must not
// override an admin-picked cover_url. Non-Open-Library entries are intentional
// edition overrides (R2 uploads, Booksense, AbeBooks, etc.) and should win at
// build time even before a D1 SQL migration runs.
export function isCommittedCoverOverride(coverUrl) {
  if (!coverUrl) return false;
  return !/covers\.openlibrary\.org\//i.test(coverUrl);
}

/** The cover a Reading entry shows: a committed override, else its pick, else the cache. */
export function coverForReadingEntryFrom(r, cache) {
  const cached = coverFromCacheFor(r.url, cache);
  if (cached && isCommittedCoverOverride(cached)) return cached;
  return r.cover_url || cached || null;
}
