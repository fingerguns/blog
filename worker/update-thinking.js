/**
 * Cloudflare Worker: admin API for rommy.blog
 *
 * Content is stored in Cloudflare D1. Static site is rebuilt via Pages deploy hook.
 *
 * Secrets (wrangler secret put):
 *   ADMIN_PASSWORD       — shared password for /admin/
 *   PAGES_DEPLOY_HOOK    — Cloudflare Pages deploy hook URL
 *   MICROBLOG_TOKEN      — Micropub token (optional)
 *   BLUESKY_HANDLE       — Bluesky handle (optional)
 *   BLUESKY_APP_PASSWORD — Bluesky app password (optional)
 *   GITHUB_TOKEN         — optional fallback to trigger GitHub workflow_dispatch
 */

const SITE_URL = "https://rommy.blog";
const SITE_TITLE = "rommy.blog";
const SITE_AUTHOR = "Rommy Ghaly";
const GA_ID = "G-L1CC5F3DP8";
const GA_SNIPPET = `    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>\n    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;

export default {
  async fetch(request, env, ctx) {
    const allowedOrigins = (env.ALLOWED_ORIGINS || "https://rommy.blog")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const origin = request.headers.get("Origin") || "";
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

    const cors = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    if (!env.ADMIN_PASSWORD || !env.DB) {
      return json({ error: "Worker is not configured" }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const { password, action } = body;

    if (typeof password !== "string") {
      return json({ error: "Missing password" }, 400, cors);
    }

    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: "Invalid password" }, 401, cors);
    }

    if (action === "verify") {
      return json({ ok: true }, 200, cors);
    }

    const db = env.DB;

    if (action === "thinking") {
      return handleThinking(body, db, cors, env, ctx);
    }

    if (action === "post") {
      return handlePost(body, db, cors, env);
    }

    if (action === "reading") {
      return handleReading(body, db, cors, env);
    }

    if (action === "sharing") {
      return handleSharing(body, db, cors, env);
    }

    if (action === "fetch-title") {
      return handleFetchTitle(body, cors);
    }

    if (action === "list-drafts") {
      return handleListDrafts(db, cors);
    }

    if (action === "save-draft") {
      return handleSaveDraft(body, db, cors);
    }

    if (action === "load-draft") {
      return handleLoadDraft(body, db, cors);
    }

    if (action === "delete-draft") {
      return handleDeleteDraft(body, db, cors);
    }

    if (action === "fetch-post") {
      return handleFetchPost(body, db, cors);
    }

    if (action === "edit-post") {
      return handleEditPost(body, db, cors, env);
    }

    if (action === "delete-post") {
      return handleDeletePost(body, db, cors, env);
    }

    return json({ error: "Unknown action" }, 400, cors);
  },
};

// ─── D1 helpers ───────────────────────────────────────────────────────────────

async function dbRun(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function dbFirst(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function dbAll(db, sql, ...params) {
  return db.prepare(sql).bind(...params).all();
}

async function triggerRebuild(env) {
  if (env.PAGES_DEPLOY_HOOK) {
    await fetch(env.PAGES_DEPLOY_HOOK, { method: "POST" }).catch(() => {});
    return;
  }
  // Fallback: GitHub workflow dispatch
  if (env.GITHUB_TOKEN) {
    const owner = env.GITHUB_OWNER || "fingerguns";
    const repo = env.GITHUB_REPO || "blog";
    const branch = env.GITHUB_BRANCH || "main";
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/build.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "rommy-blog-admin-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: branch }),
      }
    ).catch(() => {});
  }
}

async function savePostVersion(db, slug, title, summary, bodyHtml) {
  await dbRun(
    db,
    "INSERT INTO post_versions (slug, title, summary, body_html, edited_at) VALUES (?, ?, ?, ?, ?)",
    slug,
    title,
    summary,
    bodyHtml,
    new Date().toISOString()
  );
}

// ─── Thinking ────────────────────────────────────────────────────────────────

async function handleThinking(body, db, cors, env, ctx) {
  const { text } = body;
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "Missing text" }, 400, cors);
  }

  const trimmed = text.trim();
  if (trimmed.length > 2000) {
    return json({ error: "Text must be 2000 characters or fewer" }, 400, cors);
  }

  try {
    const now = new Date().toISOString();
    await dbRun(
      db,
      "INSERT INTO thinking (id, text, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
      trimmed,
      now
    );

    let microblogWarning = null;
    if (env.MICROBLOG_TOKEN) {
      try {
        await postToMicroblog(env.MICROBLOG_TOKEN, trimmed);
      } catch (mbErr) {
        microblogWarning = mbErr.message || "micro.blog post failed";
      }
    }

    let blueskyWarning = null;
    if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
      try {
        await postToBluesky(env.BLUESKY_HANDLE, env.BLUESKY_APP_PASSWORD, trimmed);
      } catch (bsErr) {
        blueskyWarning = bsErr.message || "Bluesky post failed";
      }
    }

    await triggerRebuild(env);
    // Delayed rebuild so /thinking/ catches micro.blog feed update
    if (ctx) {
      ctx.waitUntil(
        new Promise((r) => setTimeout(r, 90000)).then(() => triggerRebuild(env))
      );
    }

    return json({ ok: true, text: trimmed, microblogWarning, blueskyWarning }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

async function postToMicroblog(token, content) {
  const res = await fetch("https://micro.blog/micropub", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ h: "entry", content }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`micro.blog post failed (${res.status}): ${err}`);
  }
}

async function postToBluesky(handle, appPassword, content) {
  const sessionRes = await fetch(
    "https://bsky.social/xrpc/com.atproto.server.createSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    }
  );
  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    throw new Error(`Bluesky auth failed (${sessionRes.status}): ${err}`);
  }
  const { accessJwt, did } = await sessionRes.json();

  const LINK_URL = `${SITE_URL}/thinking/`;
  const MAX = 300;
  const graphemes = [...content];
  let text = content;
  let facets = [];

  if (graphemes.length > MAX) {
    const suffix = `\u2026 ${LINK_URL}`;
    const maxContent = MAX - [...suffix].length;
    const truncated = graphemes.slice(0, maxContent).join("");
    text = truncated + suffix;
    const enc = new TextEncoder();
    const byteStart = enc.encode(truncated + "\u2026 ").length;
    const byteEnd = byteStart + enc.encode(LINK_URL).length;
    facets.push({
      $type: "app.bsky.richtext.facet",
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: LINK_URL }],
    });
  }

  const enc = new TextEncoder();
  const urlRe = /https?:\/\/[^\s\u2026]+/g;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?)"']+$/, "");
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(url).length;
    const already = facets.some((f) => f.index.byteStart === byteStart);
    if (!already) {
      facets.push({
        $type: "app.bsky.richtext.facet",
        index: { byteStart, byteEnd },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
      });
    }
  }

  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    ...(facets.length ? { facets } : {}),
  };

  const postRes = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record }),
    }
  );
  if (!postRes.ok) {
    const err = await postRes.text();
    throw new Error(`Bluesky post failed (${postRes.status}): ${err}`);
  }
}

// ─── New Post ─────────────────────────────────────────────────────────────────

async function handlePost(body, db, cors, env) {
  const { title, summary } = body;
  const rawBody = typeof body.body === "string" ? body.body.trim() : null;
  const paragraphs = Array.isArray(body.paragraphs) ? body.paragraphs : null;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof summary !== "string" || !summary.trim()) {
    return json({ error: "Missing summary" }, 400, cors);
  }
  if (!rawBody && !paragraphs) {
    return json({ error: "Missing body" }, 400, cors);
  }

  const cleanTitle = title.trim();
  const cleanSummary = summary.trim();
  const slug = toSlug(cleanTitle);
  const now = new Date();
  const dateStr = toDateStr(now);
  const datetimeStr = now.toISOString();

  let bodyHtml;
  if (rawBody) {
    bodyHtml = cleanBodyHtml(rawBody);
  } else {
    const cleanParas = paragraphs.map((p) => String(p).trim()).filter(Boolean);
    bodyHtml = cleanParas.map((p) => `<p>${escHtml(p)}</p>`).join("");
  }

  try {
    const existing = await dbFirst(db, "SELECT slug FROM posts WHERE slug = ?", slug);
    if (existing) {
      return json({ error: `A post with slug "${slug}" already exists` }, 409, cors);
    }

    await dbRun(
      db,
      `INSERT INTO posts (slug, title, summary, body_html, date, datetime, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      slug,
      cleanTitle,
      cleanSummary,
      bodyHtml,
      dateStr,
      datetimeStr,
      datetimeStr,
      datetimeStr
    );

    await savePostVersion(db, slug, cleanTitle, cleanSummary, bodyHtml);

    // Clear draft if publishing from one
    if (body.draftId) {
      await dbRun(db, "DELETE FROM drafts WHERE id = ?", body.draftId);
    }

    await triggerRebuild(env);

    return json({ ok: true, slug, url: `${SITE_URL}/posts/${slug}/` }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Post creation failed" }, 500, cors);
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────

async function handleReading(body, db, cors, env) {
  const { title, url, ym } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof url !== "string" || !url.trim()) {
    return json({ error: "Missing url" }, 400, cors);
  }

  const now = new Date();
  const month =
    typeof ym === "string" && /^\d{4}-\d{2}$/.test(ym.trim())
      ? ym.trim()
      : now.toISOString().slice(0, 7);

  const entry = { ym: month, title: title.trim(), url: url.trim() };

  try {
    await dbRun(
      db,
      "INSERT INTO reading (ym, title, url, added_at) VALUES (?, ?, ?, ?)",
      entry.ym,
      entry.title,
      entry.url,
      now.toISOString()
    );

    await triggerRebuild(env);
    return json({ ok: true, entry }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// ─── Sharing ──────────────────────────────────────────────────────────────────

async function handleSharing(body, db, cors, env) {
  const { title, url } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof url !== "string" || !url.trim()) {
    return json({ error: "Missing url" }, 400, cors);
  }

  const now = new Date();
  const dateStr = toDateStr(now);
  const datetimeStr = now.toISOString();

  const entry = {
    url: url.trim(),
    title: title.trim(),
    date: dateStr,
    datetime: datetimeStr,
  };

  try {
    await dbRun(
      db,
      "INSERT INTO linklog (url, title, date, datetime) VALUES (?, ?, ?, ?)",
      entry.url,
      entry.title,
      entry.date,
      entry.datetime
    );

    await triggerRebuild(env);
    return json({ ok: true, entry }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// ─── Fetch Post ──────────────────────────────────────────────────────────────

async function handleFetchPost(body, db, cors) {
  const { slug } = body;
  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const post = await dbFirst(
      db,
      "SELECT title, summary, body_html FROM posts WHERE slug = ?",
      cleanSlug
    );
    if (!post) {
      return json({ error: "Post not found" }, 404, cors);
    }

    return json(
      {
        ok: true,
        title: post.title,
        summary: post.summary,
        body: post.body_html,
      },
      200,
      cors
    );
  } catch (err) {
    return json({ error: err.message || "Post not found" }, 404, cors);
  }
}

// ─── Edit Post ────────────────────────────────────────────────────────────────

async function handleEditPost(body, db, cors, env) {
  const { slug, title, summary } = body;
  const rawBody = typeof body.body === "string" ? body.body.trim() : null;

  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }
  if (!rawBody) {
    return json({ error: "Missing body" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");
  const bodyHtml = cleanBodyHtml(rawBody);

  try {
    const existing = await dbFirst(
      db,
      "SELECT title, summary FROM posts WHERE slug = ?",
      cleanSlug
    );
    if (!existing) {
      return json({ error: "Post not found" }, 404, cors);
    }

    const newTitle = title?.trim() || existing.title;
    const newSummary = summary?.trim() || existing.summary;
    const now = new Date().toISOString();

    // Save version before updating
    const current = await dbFirst(
      db,
      "SELECT title, summary, body_html FROM posts WHERE slug = ?",
      cleanSlug
    );
    await savePostVersion(db, cleanSlug, current.title, current.summary, current.body_html);

    await dbRun(
      db,
      "UPDATE posts SET title = ?, summary = ?, body_html = ?, updated_at = ? WHERE slug = ?",
      newTitle,
      newSummary,
      bodyHtml,
      now,
      cleanSlug
    );

    await triggerRebuild(env);

    return json({ ok: true, url: `${SITE_URL}/posts/${cleanSlug}/` }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Edit failed" }, 500, cors);
  }
}

// ─── Delete Post ──────────────────────────────────────────────────────────────

async function handleDeletePost(body, db, cors, env) {
  const { slug } = body;
  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const existing = await dbFirst(db, "SELECT slug FROM posts WHERE slug = ?", cleanSlug);
    if (!existing) {
      return json({ error: "Post not found" }, 404, cors);
    }

    await dbRun(db, "DELETE FROM post_versions WHERE slug = ?", cleanSlug);
    await dbRun(db, "DELETE FROM posts WHERE slug = ?", cleanSlug);

    await triggerRebuild(env);

    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Delete failed" }, 500, cors);
  }
}

// ─── Drafts (D1) ─────────────────────────────────────────────────────────────

async function handleListDrafts(db, cors) {
  try {
    const { results } = await dbAll(
      db,
      "SELECT id, title, summary, updated_at FROM drafts ORDER BY updated_at DESC"
    );
    return json({ ok: true, drafts: results || [] }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not list drafts" }, 500, cors);
  }
}

async function handleSaveDraft(body, db, cors) {
  const { id, title, summary, body: draftBody } = body;
  const now = new Date().toISOString();

  try {
    if (id) {
      await dbRun(
        db,
        "UPDATE drafts SET title = ?, summary = ?, body_html = ?, updated_at = ? WHERE id = ?",
        title || "",
        summary || "",
        draftBody || "",
        now,
        id
      );
      return json({ ok: true, id }, 200, cors);
    }

    const draftId = crypto.randomUUID();
    await dbRun(
      db,
      "INSERT INTO drafts (id, title, summary, body_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      draftId,
      title || "",
      summary || "",
      draftBody || "",
      now,
      now
    );
    return json({ ok: true, id: draftId }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not save draft" }, 500, cors);
  }
}

async function handleLoadDraft(body, db, cors) {
  const { id } = body;
  if (!id) {
    return json({ error: "Missing draft id" }, 400, cors);
  }

  try {
    const draft = await dbFirst(
      db,
      "SELECT id, title, summary, body_html, updated_at FROM drafts WHERE id = ?",
      id
    );
    if (!draft) {
      return json({ ok: true, draft: null }, 200, cors);
    }
    return json(
      {
        ok: true,
        draft: {
          id: draft.id,
          title: draft.title,
          summary: draft.summary,
          body: draft.body_html,
          updated_at: draft.updated_at,
        },
      },
      200,
      cors
    );
  } catch (err) {
    return json({ error: err.message || "Could not load draft" }, 500, cors);
  }
}

async function handleDeleteDraft(body, db, cors) {
  const { id } = body;
  if (!id) {
    return json({ error: "Missing draft id" }, 400, cors);
  }

  try {
    await dbRun(db, "DELETE FROM drafts WHERE id = ?", id);
    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not delete draft" }, 500, cors);
  }
}

// ─── Fetch Title ─────────────────────────────────────────────────────────────

async function handleFetchTitle(body, cors) {
  const { url } = body;
  if (typeof url !== "string" || !url.trim().startsWith("http")) {
    return json({ error: "Invalid url" }, 400, cors);
  }

  try {
    const res = await fetch(url.trim(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return json({ error: `Page returned ${res.status}` }, 502, cors);
    }

    const reader = res.body.getReader();
    let html = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (bytes < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.length;
      if (html.includes("</head>")) break;
    }
    reader.cancel();

    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!match) {
      return json({ error: "No title found" }, 404, cors);
    }

    const title = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    return json({ ok: true, title }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Fetch failed" }, 502, cors);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanBodyHtml(raw) {
  let html = raw.replace(/(<p><br\s*\/?><\/p>)+/g, "").trim();
  html = html.replace(/(<br\s*\/?>\s*){2,}/g, "</p><p>");
  html = html.replace(/<p>\s*(<br\s*\/?>)+/g, "<p>");
  html = html.replace(/(<br\s*\/?>)+\s*<\/p>/g, "</p>");
  html = html.replace(/<p>\s*<\/p>/g, "");
  return html.trim();
}

function toSlug(s) {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toDateStr(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}
