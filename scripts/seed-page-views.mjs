/**
 * One-off: seed the D1 `page_views` table with each permalink's history from
 * a Google Analytics 4 export, so the counts the Worker keeps from now on do
 * not start at zero.
 *
 * Export it in GA: Reports → Engagement → Pages and screens, dimension
 * "Page path and screen class", date range from the start of the property to
 * the day before the Worker started counting, then Share → Download CSV.
 *
 *   node --env-file=.env scripts/seed-page-views.mjs <export.csv>            # dry run: prints what it would add
 *   node --env-file=.env scripts/seed-page-views.mjs <export.csv> --apply    # writes to D1
 *
 * GA's totals are *added* to whatever the Worker has counted since, so the
 * date range must stop where the Worker's counting began. Because adding is
 * not idempotent, an applied seed leaves a marker in `build_cache`
 * (namespace `page-views`, key `ga-seed`) and a second --apply refuses
 * unless also given --force.
 */
import { readFileSync } from "node:fs";
import { d1Configured, d1Query } from "./d1-client.mjs";
import { parseGaPagesCsv } from "./lib/page-views.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const force = args.includes("--force");

if (!file) {
  console.error("Usage: node --env-file=.env scripts/seed-page-views.mjs <ga-export.csv> [--apply] [--force]");
  process.exit(1);
}

const totals = [...parseGaPagesCsv(readFileSync(file, "utf8"))].sort((a, b) => b[1] - a[1]);
const sum = totals.reduce((n, [, v]) => n + v, 0);
const posts = totals.filter(([p]) => p.startsWith("/posts/")).length;
console.log(`${totals.length} permalinks in the export (${posts} Writing, ${totals.length - posts} Thinking), ${sum} views in all.`);
for (const [path, views] of totals.slice(0, 10)) console.log(`  ${String(views).padStart(7)}  ${path}`);
if (totals.length > 10) console.log(`  … and ${totals.length - 10} more`);

if (!apply) {
  console.log("\nDry run — nothing written. Re-run with --apply to add these to D1.");
  process.exit(0);
}
if (!d1Configured()) {
  console.error("D1 not configured: set CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID in .env.");
  process.exit(1);
}

const MARKER = ["page-views", "ga-seed"];
const seeded = await d1Query("SELECT value FROM build_cache WHERE namespace = ?1 AND key = ?2", MARKER);
if (seeded.length && !force) {
  console.error(`\nAlready seeded (${seeded[0].value}). Adding again would double-count; pass --force to do it anyway.`);
  process.exit(1);
}

// Two bound parameters per row; D1 allows 100 per statement.
const ROWS_PER_STATEMENT = 40;
const now = new Date().toISOString();
for (let i = 0; i < totals.length; i += ROWS_PER_STATEMENT) {
  const chunk = totals.slice(i, i + ROWS_PER_STATEMENT);
  const values = chunk.map((_, j) => `(?${j * 2 + 1}, ?${j * 2 + 2}, '${now}')`).join(", ");
  await d1Query(
    `INSERT INTO page_views (path, views, updated_at) VALUES ${values} ` +
      "ON CONFLICT(path) DO UPDATE SET views = views + excluded.views, updated_at = excluded.updated_at",
    chunk.flat()
  );
}
await d1Query(
  "INSERT INTO build_cache (namespace, key, value, updated_at) VALUES (?1, ?2, ?3, ?4) " +
    "ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  [...MARKER, JSON.stringify({ at: now, file: file.split("/").pop(), pages: totals.length, views: sum }), now]
);
console.log(`\nAdded ${sum} views across ${totals.length} pages to D1 page_views.`);
