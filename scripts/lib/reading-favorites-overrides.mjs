import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
export { applyReadingFavoritesOverrides } from "./reading-favorites-apply.mjs";

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
