/**
 * Generate thematic tag clouds for Reading Latest and Must Reads via Claude Opus.
 * Run from project root: node --env-file=.env scripts/generate-reading-tag-clouds.mjs
 *
 * Uses ANTHROPIC_API_KEY locally if set; otherwise calls the Worker admin API
 * (which uses the wrangler ANTHROPIC_API_KEY secret).
 */
import { d1Configured, d1Query } from "./d1-client.mjs";
import { extractAnthropicText, runAnthropicText } from "./lib/anthropic.mjs";
import {
  buildTagCloudPrompt,
  formatTagCloudForDisplay,
  parseTagCloudResponse,
} from "./lib/reading-tag-cloud.mjs";

const API_URL = process.env.ADMIN_API_URL || "https://rommy.blog/api/admin";
const localApiKey = process.env.ANTHROPIC_API_KEY;
const adminPassword = process.env.ADMIN_PASSWORD;

function recentReadingMonths() {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previous = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  return [current, previous];
}

async function loadLatestBooks() {
  const [currentYm, previousYm] = recentReadingMonths();
  const rows = await d1Query(
    "SELECT title, author, ym FROM reading WHERE ym IN (?, ?) ORDER BY ym DESC, added_at DESC, id DESC",
    [currentYm, previousYm]
  );
  return rows.map((row) => ({
    title: row.title,
    author: row.author || "",
    ym: row.ym,
  }));
}

async function loadMustReadsBooks() {
  const rows = await d1Query(
    "SELECT title, author FROM reading_favorites ORDER BY title COLLATE NOCASE ASC, id ASC"
  );
  return rows.map((row) => ({
    title: row.title,
    author: row.author || "",
  }));
}

async function generateTagCloudLocal(tab, books) {
  const prompt = buildTagCloudPrompt(tab, books);
  const result = await runAnthropicText(
    { ANTHROPIC_API_KEY: localApiKey },
    {
      system:
        "You analyze book lists and return thematic tag clouds as JSON only. No markdown fences or commentary.",
      user: prompt,
      maxTokens: 1024,
    }
  );
  return parseTagCloudResponse(extractAnthropicText(result));
}

async function generateViaWorker() {
  if (!adminPassword) {
    console.error("Set ANTHROPIC_API_KEY or ADMIN_PASSWORD in .env.");
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
  return data;
}

let latestCloud;
let mustReadsCloud;
let counts;

if (localApiKey) {
  if (!d1Configured()) {
    console.error("D1 not configured (CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID).");
    process.exit(1);
  }

  const latestBooks = await loadLatestBooks();
  const mustReadsBooks = await loadMustReadsBooks();
  counts = { latest: latestBooks.length, mustReads: mustReadsBooks.length };
  console.log(`Loaded ${counts.latest} Latest book(s), ${counts.mustReads} Must Reads book(s).\n`);
  latestCloud = await generateTagCloudLocal("latest", latestBooks);
  mustReadsCloud = await generateTagCloudLocal("mustReads", mustReadsBooks);
} else {
  console.log("No local ANTHROPIC_API_KEY — calling Worker admin API…\n");
  const data = await generateViaWorker();
  counts = data.counts;
  latestCloud = data.latest;
  mustReadsCloud = data.mustReads;
  console.log(`Loaded ${counts.latest} Latest book(s), ${counts.mustReads} Must Reads book(s).\n`);
}

console.log(formatTagCloudForDisplay("latest", latestCloud));
console.log(formatTagCloudForDisplay("mustReads", mustReadsCloud));

console.log("--- JSON ---");
console.log(JSON.stringify({ latest: latestCloud, mustReads: mustReadsCloud }, null, 2));
