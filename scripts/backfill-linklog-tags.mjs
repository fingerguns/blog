/**
 * Backfill topic tags for Sharing (linklog) entries missing them.
 * Run from project root: node --env-file=.env scripts/backfill-linklog-tags.mjs
 *
 * Calls the Worker admin API (Anthropic key lives in wrangler secrets, not .env).
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
  body: JSON.stringify({ password: adminPassword, action: "backfill-linklog-tags" }),
});

const data = await res.json();
if (!res.ok) {
  console.error(data.error || `Request failed (${res.status})`);
  process.exit(1);
}

console.log(`Processed ${data.processed} link(s): ${data.saved} tagged, ${data.skipped?.length || 0} skipped.`);

for (const result of data.results || []) {
  if (result.saved) {
    console.log(`✓ ${result.title}: ${(result.tags || []).join(", ")}`);
  }
}

for (const result of data.skipped || []) {
  console.log(`✗ ${result.linklogId}: ${result.reason || "skipped"}`);
}
