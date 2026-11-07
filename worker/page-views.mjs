/**
 * View counts on the permalink pages. Every Thinking note and Writing post
 * page passes through the live overlay; this is its last step. A page load
 * from a browser adds one to the page's row in D1 `page_views` and the new
 * total is written into the footer — after the neighborhood on a note, after
 * the read time on a post. Crawlers, unfurlers and prefetches are shown the
 * count without adding to it (scripts/lib/page-views.mjs decides).
 *
 * It runs after the overlay's edge cache, never inside it: a cached copy
 * carries no count, so every reader gets the current one. Nothing about the
 * visitor is stored — the row is a path and a number.
 *
 * Any failure here serves the page without a count rather than failing it.
 */
import { formatViews, isCountableView, permalinkViewPath } from "../scripts/lib/page-views.mjs";

const UPSERT_SQL =
  "INSERT INTO page_views (path, views, updated_at) VALUES (?1, 1, ?2) " +
  "ON CONFLICT(path) DO UPDATE SET views = views + 1, updated_at = ?2 RETURNING views";
const SELECT_SQL = "SELECT views FROM page_views WHERE path = ?1";

/** The counter key for this request, or null if it is not a permalink. */
export function viewPathFor(request) {
  return permalinkViewPath(new URL(request.url).pathname);
}

/**
 * The page's conditional headers dropped. A permalink's count changes with
 * every load, so a 304 for the browser's cached copy would show a stale one;
 * the page is small, so it is always sent in full.
 */
export function withoutConditionals(request) {
  if (!request.headers.has("If-None-Match") && !request.headers.has("If-Modified-Since")) return request;
  const headers = new Headers(request.headers);
  headers.delete("If-None-Match");
  headers.delete("If-Modified-Since");
  return new Request(request, { headers });
}

/** Count this load (when it is one) and write the total into the page. */
export async function withViewCount(request, res, env) {
  if (!env.DB || request.method !== "GET" || res.status !== 200) return res;
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const path = viewPathFor(request);
  if (!path) return res;

  let views = 0;
  try {
    const row = isCountableView(request.method, request.headers)
      ? await env.DB.prepare(UPSERT_SQL).bind(path, new Date().toISOString()).first()
      : await env.DB.prepare(SELECT_SQL).bind(path).first();
    views = Number(row?.views) || 0;
  } catch (err) {
    console.error("page views: count failed; serving without it", err);
    return res;
  }
  // A crawler on a page no reader has opened yet: say nothing, not "0 views".
  if (views < 1) return res;

  const label = formatViews(views);
  const rewriter = new HTMLRewriter();
  if (path.startsWith("/posts/")) {
    // Same separator the admin links use when they join this line.
    rewriter.on("article.post > time .reading-time", {
      element(el) {
        el.append(`<span aria-hidden="true"> · </span><span class="post-views">${label}</span>`, { html: true });
      },
    });
  } else {
    rewriter.on("article.post p.post-meta", {
      element(el) {
        el.append(`<span class="post-meta-sep" aria-hidden="true">·</span><span class="post-views">${label}</span>`, {
          html: true,
        });
      },
    });
  }

  const out = new Response(rewriter.transform(res).body, res);
  // The bytes are no longer the file's, and no validator may let a browser
  // keep an old count.
  out.headers.delete("Content-Length");
  out.headers.delete("ETag");
  out.headers.delete("Last-Modified");
  out.headers.set("Cache-Control", "no-cache");
  return out;
}

const THINKING_VIEWS_SQL = "SELECT path, views FROM page_views WHERE path LIKE '/thinking/%' AND views > 0";

/**
 * GET /api/views — every Thinking note's count as `{ "<slug>": views }`, for
 * the /thinking/ archive to fill in client-side. One small D1 read; the
 * archive is the site's largest page, and rewriting it per request would
 * blow the Free plan's 10 ms CPU budget. Public and read-only: it says no
 * more than the permalinks already show. Viewing the archive counts nothing.
 */
export async function handleThinkingViews(env) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=30",
  };
  if (!env.DB) return new Response("{}", { status: 503, headers });
  try {
    const { results = [] } = await env.DB.prepare(THINKING_VIEWS_SQL).all();
    const out = {};
    for (const row of results) {
      const slug = /^\/thinking\/([^/]+)\/$/.exec(row.path)?.[1];
      if (slug) out[slug] = Number(row.views);
    }
    return new Response(JSON.stringify(out), { headers });
  } catch (err) {
    console.error("page views: archive counts failed", err);
    return new Response("{}", { status: 500, headers: { ...headers, "Cache-Control": "no-store" } });
  }
}
