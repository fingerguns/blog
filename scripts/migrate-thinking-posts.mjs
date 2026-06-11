/**
 * One-time migration: Micro.blog feed → thinking_posts in D1
 *
 * Prerequisites:
 *   1. Run the SQL migration first:
 *        wrangler d1 execute rommy-blog-db --file=migrate-thinking-posts.sql --remote
 *      (from the worker/ directory)
 *   2. Run this script from the project root:
 *        node scripts/migrate-thinking-posts.mjs
 *
 * Safe to re-run — uses INSERT OR IGNORE so existing rows are not overwritten.
 */
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_NAME = "rommy-blog-db";

function escSql(s) {
  return String(s ?? "").replace(/'/g, "''");
}

function mbSlug(iso) {
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

function extractText(html) {
  return String(html)
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImgSrc(html) {
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function extractImgAlt(html) {
  const m = String(html).match(/<img[^>]+alt=["']([^"']*)["']/i);
  return m ? m[1] : "";
}

function innerHtml(html) {
  // Strip the outer <div class="microblog-body"> wrapper if present, keep inner HTML.
  return String(html)
    .replace(/^<div[^>]*>\s*/i, "")
    .replace(/\s*<\/div>\s*$/i, "")
    .trim();
}

console.log("Fetching Micro.blog feed…");
const res = await fetch("https://rommy.micro.blog/feed.json", {
  headers: { "User-Agent": "rommy-blog-builder/1.0" },
  signal: AbortSignal.timeout(15000),
});
if (!res.ok) {
  console.error(`Feed fetch failed: HTTP ${res.status}`);
  process.exit(1);
}

const feed = await res.json();
const items = (feed.items || []).filter((item) => item.content_html && item.date_published);

console.log(`Found ${items.length} items.`);

const lines = [];
for (const item of items) {
  const slug = mbSlug(item.date_published);
  const contentHtml = innerHtml(item.content_html);
  const text = extractText(item.content_html);
  const mediaUrl = extractImgSrc(item.content_html) || null;
  const mediaAlt = mediaUrl ? extractImgAlt(item.content_html) : null;
  const microblogUrl = item.url || null;
  const datetime = item.date_published;

  lines.push(
    `INSERT OR IGNORE INTO thinking_posts (slug, text, media_url, media_alt, content_html, datetime, microblog_url, created_at)` +
    ` VALUES ('${escSql(slug)}', '${escSql(text)}', ${mediaUrl ? `'${escSql(mediaUrl)}'` : "NULL"}, ${mediaAlt != null ? `'${escSql(mediaAlt)}'` : "NULL"}, '${escSql(contentHtml)}', '${escSql(datetime)}', ${microblogUrl ? `'${escSql(microblogUrl)}'` : "NULL"}, '${escSql(datetime)}');`
  );
}

const sqlPath = join(root, "worker", "migrate-thinking-posts-data.sql");
writeFileSync(sqlPath, lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${lines.length} INSERT statements.`);

execSync(`wrangler d1 execute ${DB_NAME} --file=migrate-thinking-posts-data.sql --remote`, {
  cwd: join(root, "worker"),
  stdio: "inherit",
});

unlinkSync(sqlPath);
console.log("Migration complete.");
