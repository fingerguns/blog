/**
 * Regenerate all section hover tooltips via Workers AI and trigger a rebuild.
 * Run from project root: node --env-file=.env scripts/refresh-section-hints.mjs
 */
const API_URL = process.env.ADMIN_API_URL || "https://rommy.blog/api/admin";
const password = process.env.ADMIN_PASSWORD;

if (!password) {
  console.error("Set ADMIN_PASSWORD in .env");
  process.exit(1);
}

const res = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password, action: "refresh-section-hints" }),
});

const data = await res.json();
if (!res.ok) {
  console.error(data.error || `Request failed (${res.status})`);
  process.exit(1);
}

console.log("Section hints updated:\n");
for (const [section, hint] of Object.entries(data.hints || {})) {
  console.log(`## ${section}\n${hint}\n`);
}
