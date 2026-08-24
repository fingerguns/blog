import { anthropicConfigured, extractAnthropicText, runAnthropicText } from "../scripts/lib/anthropic.mjs";
import { logAnthropicUsage } from "./anthropic-usage.mjs";
import { buildLinklogTagPrompt, parseLinklogTagResponse } from "../scripts/lib/linklog-tags.mjs";

const TAG_SYSTEM =
  "You assign topic tags to shared links for a personal blog's linklog. Output only valid JSON as requested.";

async function dbRun(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function dbFirst(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function dbAll(db, sql, ...params) {
  return db.prepare(sql).bind(...params).all();
}

async function loadLinklogEntry(db, linklogId) {
  return dbFirst(db, "SELECT id, title, url FROM linklog WHERE id = ?", linklogId);
}

export async function evaluateAndAssignLinklogTags(env, db, linklogId) {
  if (!anthropicConfigured(env)) {
    return { linklogId, saved: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const entry = await loadLinklogEntry(db, linklogId);
  if (!entry) {
    return { linklogId, saved: false, reason: "Link not found" };
  }

  const prompt = buildLinklogTagPrompt(entry);

  let result;
  try {
    result = await runAnthropicText(env, {
      system: TAG_SYSTEM,
      user: prompt,
      maxTokens: 256,
    });
  } catch (err) {
    return { linklogId, saved: false, reason: err?.message || "Anthropic API request failed" };
  }

  await logAnthropicUsage(db, {
    feature: "linklog-tags",
    context: entry.title,
    result,
  });

  try {
    const tags = parseLinklogTagResponse(extractAnthropicText(result));
    await dbRun(db, "UPDATE linklog SET tags = ? WHERE id = ?", tags.join(" "), linklogId);
    return { linklogId, saved: true, title: entry.title, tags };
  } catch (err) {
    return {
      linklogId,
      saved: false,
      reason: err?.message || "Failed to parse or save tags",
    };
  }
}

export async function refreshLinklogTags(env, db, linklogId, triggerRebuild) {
  try {
    const result = await evaluateAndAssignLinklogTags(env, db, linklogId);
    if (!result.saved) {
      console.error(`linklog tag assignment skipped (${linklogId}):`, result.reason || "unknown");
      return result;
    }

    if (typeof triggerRebuild === "function") {
      await triggerRebuild(env);
    }
    return result;
  } catch (err) {
    const reason = err?.message || String(err);
    console.error(`linklog tag assignment failed (${linklogId}):`, reason);
    return { linklogId, saved: false, reason };
  }
}

export function scheduleLinklogTagAssignment(ctx, env, db, linklogId, triggerRebuild) {
  if (!ctx?.waitUntil || !linklogId) return;
  ctx.waitUntil(refreshLinklogTags(env, db, linklogId, triggerRebuild));
}

export async function backfillLinklogTags(env, db, triggerRebuild) {
  const { results: untagged } = await dbAll(
    db,
    `SELECT id, title FROM linklog WHERE tags IS NULL OR TRIM(tags) = '' ORDER BY datetime ASC`
  );

  const links = untagged || [];
  const results = [];

  for (const link of links) {
    const result = await evaluateAndAssignLinklogTags(env, db, link.id);
    results.push(result);
    if (!result.saved) {
      console.error(`linklog tag backfill skipped "${link.title}":`, result.reason || "unknown");
    }
  }

  if (typeof triggerRebuild === "function" && results.some((r) => r.saved)) {
    await triggerRebuild(env);
  }

  return {
    processed: links.length,
    saved: results.filter((r) => r.saved).length,
    skipped: results.filter((r) => !r.saved),
    results,
  };
}
