/**
 * Seed watching table in D1 from a Letterboxd export.
 * Run: node --env-file=.env scripts/seed-watching-from-letterboxd.mjs /path/to/ratings.csv [--remote]
 *
 * Uses ratings.csv for titles, URLs, and ratings. When watched.csv sits in the
 * same folder, first-watch dates come from there (ratings.csv dates are often
 * re-rating dates, not when you first saw the film).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_NAME = "rommy-blog-db";
const args = process.argv.slice(2).filter((a) => a !== "--remote");
const remote = process.argv.includes("--remote");
const csvPath = args[0];

if (!csvPath) {
  console.error("Usage: node scripts/seed-watching-from-letterboxd.mjs /path/to/ratings.csv [--remote]");
  process.exit(1);
}

function escSql(s) {
  return String(s ?? "").replace(/'/g, "''");
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  function readField() {
    let field = "";
    if (text[i] === '"') {
      i++;
      while (i < len) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += text[i++];
        }
      }
      if (text[i] === ",") i++;
      return field;
    }
    while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
      field += text[i++];
    }
    if (text[i] === ",") i++;
    return field;
  }

  const headers = [];
  while (i < len && text[i] !== "\n" && text[i] !== "\r") {
    headers.push(readField());
  }
  if (text[i] === "\r") i++;
  if (text[i] === "\n") i++;

  while (i < len) {
    const row = {};
    for (let h = 0; h < headers.length; h++) {
      row[headers[h]] = readField();
    }
    if (Object.values(row).some((v) => v !== "")) rows.push(row);
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
  }
  return rows;
}

const raw = readFileSync(csvPath, "utf8");
const parsed = parseCsv(raw);

const watchedByUri = new Map();
const watchedPath = join(dirname(csvPath), "watched.csv");
if (existsSync(watchedPath)) {
  for (const row of parseCsv(readFileSync(watchedPath, "utf8"))) {
    const uri = String(row["Letterboxd URI"] || "").trim();
    const date = String(row.Date || "").trim();
    if (uri && date) watchedByUri.set(uri, date);
  }
  console.log(`Using first-watch dates from ${watchedPath} (${watchedByUri.size} films)`);
} else {
  console.log("No watched.csv alongside ratings — using rating dates for watched_at");
}

const films = [];

for (const row of parsed) {
  const uri = String(row["Letterboxd URI"] || "").trim();
  const ratingDate = String(row.Date || "").trim();
  const title = String(row.Name || "").trim();
  const ratingRaw = String(row.Rating || "").trim();
  const date = watchedByUri.get(uri) || ratingDate;
  if (!uri || !date || !title) continue;

  films.push({
    date,
    title,
    uri,
    rating: ratingRaw ? Number(ratingRaw) : null,
  });
}

if (!films.length) {
  console.log("No films found in CSV.");
  process.exit(0);
}

const now = new Date().toISOString();
const lines = ["DELETE FROM watching;"];

for (const film of films) {
  const ym = film.date.slice(0, 7);
  const rating =
    film.rating !== null && Number.isFinite(film.rating) ? String(film.rating) : "NULL";
  lines.push(
    `INSERT INTO watching (ym, title, url, watched_at, rating, added_at) VALUES ('${escSql(ym)}', '${escSql(film.title)}', '${escSql(film.uri)}', '${escSql(film.date)}', ${rating === "NULL" ? "NULL" : rating}, '${now}');`
  );
}

const sqlPath = join(root, "worker", "seed-watching-data.sql");
writeFileSync(sqlPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${films.length} film(s) to worker/seed-watching-data.sql`);

const flag = remote ? "--remote" : "--local";
const wranglerEnv = { ...process.env };
delete wranglerEnv.CLOUDFLARE_API_TOKEN;
delete wranglerEnv.CF_API_TOKEN;
execSync(`wrangler d1 execute ${DB_NAME} --file=seed-watching-data.sql ${flag}`, {
  cwd: join(root, "worker"),
  stdio: "inherit",
  env: wranglerEnv,
});

unlinkSync(sqlPath);
console.log("Seed complete.");
