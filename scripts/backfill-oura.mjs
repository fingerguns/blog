/**
 * Backfill Oura daily step history into D1 (up to ~2 years).
 * Run from project root: node --env-file=.env scripts/backfill-oura.mjs
 */
const API_URL = process.env.ADMIN_API_URL || "https://rommy.blog/api/admin";
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  console.error("Set ADMIN_PASSWORD in .env at the repo root.");
  process.exit(1);
}

const res = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: adminPassword, action: "sync-oura", backfill: true }),
});

const data = await res.json();
if (!res.ok) {
  console.error(data.error || `Request failed (${res.status})`);
  process.exit(1);
}

console.log(
  `Oura ${data.mode} sync: upserted ${data.upserted} day(s) (${data.start_date} → ${data.end_date}). Latest: ${data.latestSteps ?? "n/a"} steps on ${data.latestDay ?? "n/a"}.`
);
