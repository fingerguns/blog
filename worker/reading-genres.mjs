import { anthropicConfigured, extractAnthropicText, runAnthropicText } from "../scripts/lib/anthropic.mjs";
import {
  buildGenreAssignmentPrompt,
  parseGenreAssignmentResponse,
  slugifyGenreLabel,
} from "../scripts/lib/reading-genres.mjs";

const GENRE_SYSTEM =
  "You assign literary genre tags to books for a personal reading list. Output only valid JSON as requested.";

async function dbRun(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function dbFirst(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function dbAll(db, sql, ...params) {
  return db.prepare(sql).bind(...params).all();
}

export async function loadAllGenres(db) {
  const { results } = await dbAll(
    db,
    "SELECT id, slug, label FROM reading_genres ORDER BY label COLLATE NOCASE ASC, id ASC"
  );
  return results || [];
}

export async function loadGenresForFavorite(db, favoriteId) {
  const { results } = await dbAll(
    db,
    `SELECT rg.id, rg.slug, rg.label, rfg.rank
     FROM reading_favorite_genres rfg
     JOIN reading_genres rg ON rg.id = rfg.genre_id
     WHERE rfg.favorite_id = ?
     ORDER BY rfg.rank ASC`,
    favoriteId
  );
  return results || [];
}

export async function ensureGenre(db, label) {
  const trimmed = String(label || "").trim();
  if (!trimmed) {
    throw new Error("Genre label is required");
  }

  const slug = slugifyGenreLabel(trimmed);
  if (!slug) {
    throw new Error("Genre label could not be slugified");
  }

  const existing = await dbFirst(db, "SELECT id, slug, label FROM reading_genres WHERE slug = ?", slug);
  if (existing) return existing;

  const now = new Date().toISOString();
  await dbRun(
    db,
    "INSERT INTO reading_genres (slug, label, created_at) VALUES (?, ?, ?)",
    slug,
    trimmed,
    now
  );

  const created = await dbFirst(db, "SELECT id, slug, label FROM reading_genres WHERE slug = ?", slug);
  if (!created) {
    throw new Error(`Failed to create genre "${trimmed}"`);
  }
  return created;
}

export async function assignGenresToFavorite(db, favoriteId, tags) {
  await dbRun(db, "DELETE FROM reading_favorite_genres WHERE favorite_id = ?", favoriteId);

  for (const tag of tags) {
    const genre = await ensureGenre(db, tag.label);
    await dbRun(
      db,
      "INSERT INTO reading_favorite_genres (favorite_id, genre_id, rank) VALUES (?, ?, ?)",
      favoriteId,
      genre.id,
      tag.rank
    );
  }
}

async function loadFavoriteBook(db, favoriteId) {
  return dbFirst(
    db,
    "SELECT id, title, author FROM reading_favorites WHERE id = ?",
    favoriteId
  );
}

export async function evaluateAndAssignGenres(env, db, favoriteId) {
  if (!anthropicConfigured(env)) {
    return { favoriteId, saved: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const book = await loadFavoriteBook(db, favoriteId);
  if (!book) {
    return { favoriteId, saved: false, reason: "Favorite not found" };
  }

  const existingGenres = await loadAllGenres(db);
  const prompt = buildGenreAssignmentPrompt(book, existingGenres);

  let result;
  try {
    result = await runAnthropicText(env, {
      system: GENRE_SYSTEM,
      user: prompt,
      maxTokens: 512,
    });
  } catch (err) {
    return { favoriteId, saved: false, reason: err?.message || "Anthropic API request failed" };
  }

  try {
    const tags = parseGenreAssignmentResponse(extractAnthropicText(result));
    await assignGenresToFavorite(db, favoriteId, tags);
    return {
      favoriteId,
      saved: true,
      title: book.title,
      tags: tags.map((t) => t.label),
    };
  } catch (err) {
    return {
      favoriteId,
      saved: false,
      reason: err?.message || "Failed to parse or save genre tags",
    };
  }
}

export async function pruneOrphanGenres(db) {
  const before = await loadAllGenres(db);
  await dbRun(
    db,
    "DELETE FROM reading_genres WHERE id NOT IN (SELECT genre_id FROM reading_favorite_genres)"
  );
  const after = await loadAllGenres(db);
  const removed = before.length - after.length;
  return { removed, remaining: after.length };
}

export async function refreshReadingFavoriteGenres(env, db, favoriteId, triggerRebuild) {
  try {
    const result = await evaluateAndAssignGenres(env, db, favoriteId);
    if (!result.saved) {
      console.error(`reading genre assignment skipped (${favoriteId}):`, result.reason || "unknown");
      return result;
    }

    if (typeof triggerRebuild === "function") {
      await triggerRebuild(env);
    }
    return result;
  } catch (err) {
    const reason = err?.message || String(err);
    console.error(`reading genre assignment failed (${favoriteId}):`, reason);
    return { favoriteId, saved: false, reason };
  }
}

export async function refreshReadingGenrePrune(env, db, triggerRebuild) {
  try {
    const result = await pruneOrphanGenres(db);
    if (result.removed > 0 && typeof triggerRebuild === "function") {
      await triggerRebuild(env);
    }
    return result;
  } catch (err) {
    const reason = err?.message || String(err);
    console.error("reading genre prune failed:", reason);
    return { removed: 0, reason };
  }
}

export function scheduleReadingGenreAssignment(ctx, env, db, favoriteId, triggerRebuild) {
  if (!ctx?.waitUntil || !favoriteId) return;
  ctx.waitUntil(refreshReadingFavoriteGenres(env, db, favoriteId, triggerRebuild));
}

export function scheduleReadingGenrePrune(ctx, env, db, triggerRebuild) {
  if (!ctx?.waitUntil) return;
  ctx.waitUntil(refreshReadingGenrePrune(env, db, triggerRebuild));
}

export async function backfillReadingGenres(env, db, triggerRebuild) {
  const { results: untagged } = await dbAll(
    db,
    `SELECT rf.id, rf.title, rf.author
     FROM reading_favorites rf
     LEFT JOIN reading_favorite_genres rfg ON rfg.favorite_id = rf.id AND rfg.rank = 1
     WHERE rfg.favorite_id IS NULL
     ORDER BY rf.title COLLATE NOCASE ASC, rf.id ASC`
  );

  const books = untagged || [];
  const results = [];

  for (const book of books) {
    const result = await evaluateAndAssignGenres(env, db, book.id);
    results.push(result);
    if (!result.saved) {
      console.error(`backfill skipped "${book.title}":`, result.reason || "unknown");
    }
  }

  const pruned = await pruneOrphanGenres(db);

  if (typeof triggerRebuild === "function" && results.some((r) => r.saved)) {
    await triggerRebuild(env);
  }

  return {
    processed: books.length,
    saved: results.filter((r) => r.saved).length,
    skipped: results.filter((r) => !r.saved),
    pruned,
    results,
  };
}
