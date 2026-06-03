/**
 * One-time migration: posts.json + post HTML files → D1
 * Run: node scripts/migrate-to-d1.mjs
 * Uses wrangler (already authenticated) — no separate API token needed.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_NAME = "rommy-blog-db";

function escSql(s) {
  return String(s).replace(/'/g, "''");
}

function extractBodyHtml(html) {
  const bodyStart = html.indexOf('<div class="body">');
  const bodyEndMarker = '</div>\n      <a class="back-to-top"';
  const bodyEnd = html.indexOf(bodyEndMarker);
  if (bodyStart < 0 || bodyEnd <= bodyStart) return "";
  return html.slice(bodyStart + '<div class="body">'.length, bodyEnd).trim();
}

function main() {
  const data = JSON.parse(readFileSync(join(root, "data/posts.json"), "utf8"));
  const now = new Date().toISOString();
  const lines = [];

  lines.push("DELETE FROM linklog;");
  lines.push("DELETE FROM reading;");
  lines.push("DELETE FROM post_versions;");
  lines.push("DELETE FROM posts;");

  for (const [key, value] of Object.entries(data.site || {})) {
    lines.push(
      `INSERT OR REPLACE INTO site_config (key, value) VALUES ('${escSql(key)}', '${escSql(JSON.stringify(value))}');`
    );
  }
  if (data.links) {
    lines.push(
      `INSERT OR REPLACE INTO site_config (key, value) VALUES ('links', '${escSql(JSON.stringify(data.links))}');`
    );
  }

  lines.push(
    `INSERT OR REPLACE INTO thinking (id, text, updated_at) VALUES (1, '${escSql(data.thinking?.text || "")}', '${now}');`
  );

  for (const p of data.posts || []) {
    const postPath = join(root, "posts", p.slug, "index.html");
    let bodyHtml = "";
    if (existsSync(postPath)) {
      bodyHtml = extractBodyHtml(readFileSync(postPath, "utf8"));
    }
    const created = p.datetime || now;
    lines.push(
      `INSERT OR REPLACE INTO posts (slug, title, summary, body_html, date, datetime, created_at, updated_at) VALUES ('${escSql(p.slug)}', '${escSql(p.title)}', '${escSql(p.summary)}', '${escSql(bodyHtml)}', '${escSql(p.date)}', '${escSql(p.datetime)}', '${created}', '${created}');`
    );
  }

  for (const r of data.reading || []) {
    lines.push(
      `INSERT INTO reading (ym, title, url, added_at) VALUES ('${escSql(r.ym)}', '${escSql(r.title)}', '${escSql(r.url)}', '${now}');`
    );
  }

  for (const l of data.linklog || []) {
    lines.push(
      `INSERT INTO linklog (url, title, date, datetime) VALUES ('${escSql(l.url)}', '${escSql(l.title)}', '${escSql(l.date)}', '${escSql(l.datetime)}');`
    );
  }

  const sqlPath = join(root, "worker", "migrate-data.sql");
  writeFileSync(sqlPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${lines.length} statements to worker/migrate-data.sql`);

  execSync(`wrangler d1 execute ${DB_NAME} --file=migrate-data.sql --remote`, {
    cwd: join(root, "worker"),
    stdio: "inherit",
  });

  unlinkSync(sqlPath);
  console.log("Migration complete.");
}

main();
