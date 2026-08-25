/**
 * Seed the D1 `build_cache` table from the legacy data/*.json cache files.
 *
 * Idempotent — safe to re-run. Apply the schema first:
 *   cd worker && wrangler d1 execute rommy-blog-db --remote --file=migrate-build-cache.sql
 *
 * Then: npm run migrate-build-cache
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { d1Configured } from "./d1-client.mjs";
import {
  CACHE_NAMESPACES,
  LEGACY_CACHE_FILES,
  loadBuildCache,
  saveBuildCache,
} from "./lib/build-cache.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!d1Configured()) {
  console.error("D1 not configured. Needs CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID.");
  process.exit(1);
}

let total = 0;
let failed = 0;

for (const namespace of Object.values(CACHE_NAMESPACES)) {
  const file = join(root, LEGACY_CACHE_FILES[namespace]);

  if (!existsSync(file)) {
    console.log(`${namespace}: no legacy file at ${LEGACY_CACHE_FILES[namespace]} — skipping`);
    continue;
  }

  let legacy;
  try {
    legacy = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`${namespace}: could not parse ${LEGACY_CACHE_FILES[namespace]} — ${err.message}`);
    failed++;
    continue;
  }

  // Load with the legacy fallback disabled, so `existing` reflects what D1
  // actually holds. Passing a real path here would seed from the file and then
  // report those entries as if they had come from D1.
  const existing = await loadBuildCache(namespace, { legacyFile: null, skipLegacy: true });
  const merged = { ...existing, ...legacy };
  const { written } = await saveBuildCache(namespace, merged);

  console.log(
    `${namespace}: ${Object.keys(legacy).length} in file, ${Object.keys(existing).length} already in D1, ${written} written`
  );
  total += written;
}

console.log(`\n${total} entr${total === 1 ? "y" : "ies"} written to build_cache.`);
if (failed > 0) {
  console.error(`${failed} namespace(s) failed.`);
  process.exit(1);
}
console.log(
  "\nOnce a build succeeds against D1, remove the legacy files:\n" +
    "  git rm --cached data/reading-covers.json data/spotify-thumbnails.json data/video-posters.json data/linklog-unfurls.json"
);
