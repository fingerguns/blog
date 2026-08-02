/**
 * Backfill neighborhood labels on Thinking posts from stored GPS points.
 * Run from project root: node --env-file=.env scripts/backfill-thinking-locations.mjs
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
  body: JSON.stringify({ password: adminPassword, action: "backfill-thinking-locations" }),
});

const data = await res.json();
if (!res.ok) {
  console.error(data.error || `Request failed (${res.status})`);
  process.exit(1);
}

console.log(
  `Updated ${data.updated} post(s); skipped ${data.skipped} with no nearby GPS (${data.total} total without labels).`
);
