import {
  anthropicConfigured,
  extractAnthropicText,
  runAnthropicText,
} from "../scripts/lib/anthropic.mjs";
import { logAnthropicUsage } from "./anthropic-usage.mjs";
import {
  DEFAULT_READING_TAB_INTROS,
  READING_TAB_KEYS,
  buildReadingTabIntroPrompt,
  introsAreSimilar,
  mergeReadingTabIntros,
  normalizeReadingTabIntro,
} from "../scripts/lib/reading-tab-intros.mjs";

export { READING_TAB_KEYS };

const SITE_CONFIG_KEY = "reading_tab_intros";
const INTRO_SYSTEM =
  "You write visitor-facing intro copy for a personal blog's reading lists. Output only the paragraph requested, with book titles in <em> tags.";

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
    return {
      entries: (results || []).map(formatReadingSample),
      months: [currentYm, previousYm],
    };
  }

  if (tab === "mustReads") {
    const { results: allRows } = await dbAll(
      db,
      "SELECT title, author FROM reading_favorites ORDER BY title COLLATE NOCASE ASC, id ASC"
    );
    const titles = (allRows || []).map((row) => row.title);
    return {
      count: titles.length,
      titles,
    };
  }

  return null;
}

export async function generateReadingTabIntro(env, db, tab, samples, currentIntro) {
  if (!anthropicConfigured(env)) {
    return { intro: null, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const prompt = buildReadingTabIntroPrompt(tab, samples, currentIntro);
  let result;
  try {
    result = await runAnthropicText(env, {
      system: INTRO_SYSTEM,
      user: prompt,
      maxTokens: 1024,
    });
  } catch (err) {
    return { intro: null, reason: err?.message || "Anthropic API request failed" };
  }

  if (db) {
    await logAnthropicUsage(db, {
      feature: "reading-tab-intro",
      context: tab,
      result,
    });
  }

  const raw = extractAnthropicText(result);
  const intro = normalizeReadingTabIntro(raw);
  if (intro.length < 80) {
    return {
      intro: null,
      reason: raw ? `Model output too short (${intro.length} chars)` : "Empty model output",
      rawPreview: truncate(raw, 200),
    };
  }
  if (introsAreSimilar(intro, currentIntro)) {
    return {
      intro: null,
      reason: "Model echoed the previous intro",
      rawPreview: truncate(intro, 200),
    };
  }
  return { intro, rawPreview: truncate(intro, 200) };
}

function truncate(text, max = 160) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export async function refreshReadingTabIntro(env, db, tab, triggerRebuild) {
  if (!READING_TAB_KEYS.includes(tab)) {
    return { tab, saved: false, reason: "Unknown tab" };
  }

  try {
    const samples = await fetchTabSamples(db, tab);
    const intros = await loadReadingTabIntros(db);
    const currentIntro = intros[tab];
    const generated = await generateReadingTabIntro(env, db, tab, samples, currentIntro);
    if (!generated.intro) {
      console.error(`reading tab intro refresh skipped (${tab}):`, generated.reason, generated.rawPreview || "");
      return { tab, saved: false, reason: generated.reason, rawPreview: generated.rawPreview };
    }

    await saveReadingTabIntro(db, tab, generated.intro);
    if (typeof triggerRebuild === "function") {
      await triggerRebuild(env);
    }
    return { tab, saved: true, preview: generated.rawPreview };
  } catch (err) {
    const reason = err?.message || String(err);
    console.error(`reading tab intro refresh failed (${tab}):`, reason);
    return { tab, saved: false, reason };
  }
}

export function scheduleReadingTabIntroRefresh(ctx, env, db, tab, triggerRebuild) {
  if (!ctx?.waitUntil || !tab) return;
  ctx.waitUntil(refreshReadingTabIntro(env, db, tab, triggerRebuild));
}
