/**
 * Seed reading_favorites in D1 from data/reading-favorites.json
 * Run: node scripts/seed-reading-favorites.mjs [--remote]
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_NAME = "rommy-blog-db";
const remote = process.argv.includes("--remote");

function escSql(s) {
  return String(s ?? "").replace(/'/g, "''");
}

const favorites = JSON.parse(readFileSync(join(root, "data/reading-favorites.json"), "utf8"));
if (!Array.isArray(favorites) || favorites.length === 0) {
  console.log("No favorites in data/reading-favorites.json — nothing to seed.");
  process.exit(0);
}

const now = new Date().toISOString();
const lines = ["DELETE FROM reading_favorites;"];

for (const item of favorites) {
  if (!item?.title || !item?.url) continue;
  const author = item.author ? `'${escSql(item.author)}'` : "NULL";
  const coverUrl = item.cover_url ? `'${escSql(item.cover_url)}'` : "NULL";
  lines.push(
    `INSERT INTO reading_favorites (title, url, cover_url, author, added_at) VALUES ('${escSql(item.title)}', '${escSql(item.url)}', ${coverUrl}, ${author}, '${now}');`
  );
}

const sqlPath = join(root, "worker", "seed-reading-favorites-data.sql");
writeFileSync(sqlPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length - 1} INSERT(s) to worker/seed-reading-favorites-data.sql`);

const flag = remote ? "--remote" : "--local";
execSync(`wrangler d1 execute ${DB_NAME} --file=seed-reading-favorites-data.sql ${flag}`, {
  cwd: join(root, "worker"),
  stdio: "inherit",
});

unlinkSync(sqlPath);
console.log("Seed complete.");
