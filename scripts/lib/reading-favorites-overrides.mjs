import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isbnFromBookshopUrl } from "./bookshop-affiliate.mjs";
import { normalizeReadingTitle } from "./reading-cover-inherit.mjs";

export function loadReadingFavoritesOverrides(root) {
  const path = join(root, "data/reading-favorites.json");
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Merge cover_url, url, and author from reading-favorites.json into D1 favorites. */
export function applyReadingFavoritesOverrides(favorites, overrides) {
  if (!Array.isArray(favorites) || !overrides?.length) return favorites;

  const byTitle = new Map();
  const byIsbn = new Map();
  for (const item of overrides) {
    if (!item?.title) continue;
    byTitle.set(normalizeReadingTitle(item.title), item);
    const isbn = isbnFromBookshopUrl(item.url);
    if (isbn) byIsbn.set(isbn, item);
  }

  return favorites.map((favorite) => {
    const isbn = isbnFromBookshopUrl(favorite.url);
    const override =
      (isbn && byIsbn.get(isbn)) || byTitle.get(normalizeReadingTitle(favorite.title));
    if (!override) return favorite;

    return {
      ...favorite,
      ...(override.cover_url ? { cover_url: override.cover_url } : {}),
      ...(override.url ? { url: override.url } : {}),
      ...(override.author ? { author: override.author } : {}),
    };
  });
}
