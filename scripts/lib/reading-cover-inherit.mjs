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
