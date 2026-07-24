/**
 * Regenerate Reading tab intro copy via Claude Opus and trigger a rebuild.
 * Run from project root: node --env-file=.env scripts/refresh-reading-tab-intros.mjs
 *
 * Optional tab argument: latest | mustReads (default: both)
 */
const API_URL = process.env.ADMIN_API_URL || "https://rommy.blog/api/admin";
const password = process.env.ADMIN_PASSWORD;
const tabArg = process.argv[2];

if (!password) {
  console.error("Set ADMIN_PASSWORD in .env at the repo root.");
  console.error("Run: npm run refresh-reading-tab-intros (from repo root or worker/)");
  process.exit(1);
}

const body = { password, action: "refresh-reading-tab-intros" };
if (tabArg) body.tab = tabArg;

const res = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const data = await res.json();
if (!res.ok) {
  console.error(data.error || `Request failed (${res.status})`);
  process.exit(1);
}

console.log("Reading tab intros updated:\n");
for (const result of data.refresh || []) {
  const status = result.saved ? "saved" : `skipped (${result.reason || "unknown"})`;
  console.log(`## ${result.tab} — ${status}`);
  if (result.preview) console.log(result.preview);
  console.log("");
}
for (const [tab, intro] of Object.entries(data.intros || {})) {
  console.log(`### ${tab}\n${intro}\n`);
}
