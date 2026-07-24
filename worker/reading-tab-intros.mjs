import {
  DEFAULT_READING_TAB_INTROS,
  READING_TAB_KEYS,
  buildReadingTabIntroPrompt,
  mergeReadingTabIntros,
  normalizeReadingTabIntro,
} from "../scripts/lib/reading-tab-intros.mjs";

export { READING_TAB_KEYS };

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SITE_CONFIG_KEY = "reading_tab_intros";

async function dbRun(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function dbFirst(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

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

function formatReadingSample(row) {
  const author = row.author ? ` (${row.author})` : "";
  return `${row.ym}: ${row.title}${author}`;
}

function formatFavoriteSample(row) {
  return row.author ? `${row.title} — ${row.author}` : row.title;
}

export async function loadReadingTabIntros(db) {
  const row = await dbFirst(db, "SELECT value FROM site_config WHERE key = ?", SITE_CONFIG_KEY);
  if (!row?.value) return { ...DEFAULT_READING_TAB_INTROS };
  try {
    return mergeReadingTabIntros(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_READING_TAB_INTROS };
  }
}

export async function saveReadingTabIntro(db, tab, intro) {
  const current = await loadReadingTabIntros(db);
  current[tab] = intro;
  await dbRun(
    db,
    "INSERT OR REPLACE INTO site_config (key, value) VALUES (?, ?)",
    SITE_CONFIG_KEY,
    JSON.stringify(current)
  );
}

async function fetchTabSamples(db, tab) {
  if (tab === "latest") {
    const [currentYm, previousYm] = recentReadingMonths();
    const { results } = await dbAll(
      db,
      "SELECT title, ym, author FROM reading WHERE ym IN (?, ?) ORDER BY ym DESC, added_at DESC, id DESC",
      currentYm,
      previousYm
    );
    return (results || []).map(formatReadingSample);
  }

  if (tab === "mustReads") {
    const { results } = await dbAll(
      db,
      "SELECT title, author FROM reading_favorites ORDER BY title COLLATE NOCASE ASC, id ASC"
    );
    return (results || []).map(formatFavoriteSample);
  }

  return [];
}

function extractAiText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result?.response === "string") return result.result.response;
  return "";
}

export async function generateReadingTabIntro(env, tab, samples, currentIntro) {
  if (!env.AI) return null;

  const prompt = buildReadingTabIntroPrompt(tab, samples, currentIntro);
  const result = await env.AI.run(AI_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You write visitor-facing intro copy for a personal blog's reading lists. Output only the paragraph requested, with book titles in <em> tags.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 480,
  });

  const intro = normalizeReadingTabIntro(extractAiText(result));
  return intro.length >= 80 ? intro : null;
}

export async function refreshReadingTabIntro(env, db, tab, triggerRebuild) {
  if (!READING_TAB_KEYS.includes(tab)) return;

  try {
    const samples = await fetchTabSamples(db, tab);
    const intros = await loadReadingTabIntros(db);
    const next = await generateReadingTabIntro(env, tab, samples, intros[tab]);
    if (!next) return;

    await saveReadingTabIntro(db, tab, next);
    if (typeof triggerRebuild === "function") {
      await triggerRebuild(env);
    }
  } catch (err) {
    console.error(`reading tab intro refresh failed (${tab}):`, err?.message || err);
  }
}

export function scheduleReadingTabIntroRefresh(ctx, env, db, tab, triggerRebuild) {
  if (!ctx?.waitUntil || !tab) return;
  ctx.waitUntil(refreshReadingTabIntro(env, db, tab, triggerRebuild));
}
