import { extractAnthropicText, runAnthropicText } from "../scripts/lib/anthropic.mjs";
import {
  buildTagCloudPrompt,
  parseTagCloudResponse,
} from "../scripts/lib/reading-tag-cloud.mjs";

async function dbAll(db, sql, ...params) {
  return db.prepare(sql).bind(...params).all();
}

function recentReadingMonths() {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previous = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  return [current, previous];
}

async function loadLatestBooks(db) {
  const [currentYm, previousYm] = recentReadingMonths();
  const { results } = await dbAll(
    db,
    "SELECT title, author, ym FROM reading WHERE ym IN (?, ?) ORDER BY ym DESC, added_at DESC, id DESC",
    currentYm,
    previousYm
  );
  return (results || []).map((row) => ({
    title: row.title,
    author: row.author || "",
    ym: row.ym,
  }));
}

async function loadMustReadsBooks(db) {
  const { results } = await dbAll(
    db,
    "SELECT title, author FROM reading_favorites ORDER BY title COLLATE NOCASE ASC, id ASC"
  );
  return (results || []).map((row) => ({
    title: row.title,
    author: row.author || "",
  }));
}

async function generateTagCloud(env, tab, books) {
  const prompt = buildTagCloudPrompt(tab, books);
  const result = await runAnthropicText(env, {
    system:
      "You analyze book lists and return thematic tag clouds as JSON only. No markdown fences or commentary.",
    user: prompt,
    maxTokens: 1024,
  });
  return parseTagCloudResponse(extractAnthropicText(result));
}

export async function generateReadingTagClouds(env, db) {
  const latestBooks = await loadLatestBooks(db);
  const mustReadsBooks = await loadMustReadsBooks(db);

  const [latest, mustReads] = await Promise.all([
    generateTagCloud(env, "latest", latestBooks),
    generateTagCloud(env, "mustReads", mustReadsBooks),
  ]);

  return {
    counts: { latest: latestBooks.length, mustReads: mustReadsBooks.length },
    latest,
    mustReads,
  };
}
