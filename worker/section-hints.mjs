import {
  DEFAULT_SECTION_HINTS,
  SECTION_NAMES,
  buildSectionHintPrompt,
  mergeSectionHints,
  normalizeSectionHint,
} from "../scripts/lib/section-hints.mjs";

export { SECTION_NAMES };

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SAMPLE_LIMIT = 18;

async function dbRun(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function dbFirst(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function dbAll(db, sql, ...params) {
  return db.prepare(sql).bind(...params).all();
}

function truncate(text, max = 160) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<img[^>]*>/gi, "[photo]")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadSectionHints(db) {
  const row = await dbFirst(db, "SELECT value FROM site_config WHERE key = ?", "section_hints");
  if (!row?.value) return { ...DEFAULT_SECTION_HINTS };
  try {
    return mergeSectionHints(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_SECTION_HINTS };
  }
}

export async function saveSectionHint(db, section, hint) {
  const current = await loadSectionHints(db);
  current[section] = hint;
  await dbRun(
    db,
    "INSERT OR REPLACE INTO site_config (key, value) VALUES (?, ?)",
    "section_hints",
    JSON.stringify(current)
  );
}

async function fetchSectionSamples(db, section) {
  if (section === "Thinking") {
    const { results } = await dbAll(
      db,
      "SELECT text, content_html FROM thinking_posts ORDER BY datetime DESC LIMIT ?",
      SAMPLE_LIMIT
    );
    return (results || []).map((row) => {
      const text = (row.text || "").trim();
      if (text) return truncate(text);
      const html = String(row.content_html || "");
      if (/class="thinking-video"/.test(html)) return "(video)";
      if (/class="thinking-audio"/.test(html)) return "(audio)";
      if (/class="thinking-spotify/.test(html)) return "(Spotify)";
      if (/class="thinking-youtube"/.test(html)) return "(YouTube)";
      if (/<img/i.test(html)) return "(photo)";
      return truncate(stripHtml(html)) || "(media)";
    });
  }

  if (section === "Writing") {
    const { results } = await dbAll(
      db,
      "SELECT title, summary FROM posts ORDER BY datetime DESC LIMIT ?",
      SAMPLE_LIMIT
    );
    return (results || []).map((row) =>
      row.summary ? `${row.title} — ${truncate(row.summary, 100)}` : row.title
    );
  }

  if (section === "Reading") {
    const { results } = await dbAll(
      db,
      "SELECT title, ym FROM reading ORDER BY ym DESC, added_at DESC, id DESC LIMIT ?",
      SAMPLE_LIMIT
    );
    return (results || []).map((row) => `${row.ym}: ${row.title}`);
  }

  if (section === "Sharing") {
    const { results } = await dbAll(
      db,
      "SELECT title FROM linklog ORDER BY datetime DESC LIMIT ?",
      SAMPLE_LIMIT
    );
    return (results || []).map((row) => truncate(row.title, 120));
  }

  return [];
}

function extractAiText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result?.response === "string") return result.result.response;
  return "";
}

export async function generateSectionHint(env, section, samples, currentHint) {
  if (!env.AI) return null;

  const prompt = buildSectionHintPrompt(section, samples, currentHint);
  const result = await env.AI.run(AI_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You write concise tooltip copy for a personal blog. Output only the paragraph requested.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 220,
  });

  const hint = normalizeSectionHint(extractAiText(result));
  return hint.length >= 40 ? hint : null;
}

export async function refreshSectionHint(env, db, section, triggerRebuild) {
  try {
    const samples = await fetchSectionSamples(db, section);
    const hints = await loadSectionHints(db);
    const next = await generateSectionHint(env, section, samples, hints[section]);
    if (!next) return;

    await saveSectionHint(db, section, next);
    if (typeof triggerRebuild === "function") {
      await triggerRebuild(env);
    }
  } catch (err) {
    console.error(`section hint refresh failed (${section}):`, err?.message || err);
  }
}

export function scheduleSectionHintRefresh(ctx, env, db, section, triggerRebuild) {
  if (!ctx?.waitUntil || !section) return;
  ctx.waitUntil(refreshSectionHint(env, db, section, triggerRebuild));
}
