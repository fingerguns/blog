/**
 * Generate thematic tag clouds for Reading Latest and Must Reads via Claude Fable.
 * Run from project root: node --env-file=.env scripts/generate-reading-tag-clouds.mjs
 *
 * Calls the Worker admin API (Anthropic key lives in wrangler secrets, not .env).
 */
import { formatTagCloudForDisplay } from "./lib/reading-tag-cloud.mjs";

const API_URL = process.env.ADMIN_API_URL || "https://rommy.blog/api/admin";
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  console.error("Set ADMIN_PASSWORD in .env at the repo root.");
  process.exit(1);
}

const res = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: adminPassword, action: "generate-reading-tag-clouds" }),
});

const data = await res.json();
if (!res.ok) {
  console.error(data.error || `Request failed (${res.status})`);
  process.exit(1);
}

const { counts, latest: latestCloud, mustReads: mustReadsCloud } = data;
console.log(`Loaded ${counts.latest} Latest book(s), ${counts.mustReads} Must Reads book(s).\n`);

console.log(formatTagCloudForDisplay("latest", latestCloud));
console.log(formatTagCloudForDisplay("mustReads", mustReadsCloud));

console.log("--- JSON ---");
console.log(JSON.stringify({ latest: latestCloud, mustReads: mustReadsCloud }, null, 2));
