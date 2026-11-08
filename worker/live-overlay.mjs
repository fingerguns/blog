/**
 * Live publishing: serve rommy.blog's static pages with anything published
 * since their build already in them.
 *
 * The site is still built by Pages from D1; that rebuild takes a minute or
 * two. Every content write also records a row in content_changes
 * (content-changes.mjs), and every built page carries the newest change id
 * its build had seen — its watermark, in an X-Live-Watermark header and a
 * <meta name="live-watermark">. This module sits on the HTML routes in front
 * of Pages and, when there are changes above a page's watermark, applies
 * them as the page streams through:
 *
 *   - a deleted item is removed,
 *   - an edited item is replaced,
 *   - a new item is placed where the build would have put it,
 *   - the homepage's short lists are re-rendered whole from D1,
 *   - a new or edited permalink is filled into the /_live/ template the
 *     build wrote, and a deleted one is a 404.
 *
 * Everything is rendered by the build's own renderers (scripts/lib/render/),
 * fed from the same D1 rows and build_cache entries, so an item looks the
 * same before and after the rebuild. Once the rebuild lands, its watermark
 * covers the changes and pages pass through untouched.
 *
 * Any failure serves the static page as it is: the overlay is only ever a
 * head start on the rebuild, never a dependency.
 */
import {
  CONTENT_KIND,
  collapseChanges,
  datedItemSort,
  datetimeSort,
  liveKey,
  monthKeyET,
  readingSort,
  readWatermark,
  sortsAbove,
  withLiveAttrs,
} from "../scripts/lib/live-changes.mjs";
import {
  CONTENT_COLUMNS,
  shapeFavoriteRow,
  shapeLinklogRow,
  shapePostRow,
  shapeReadingRow,
  shapeThinkingRow,
} from "../scripts/lib/content-rows.mjs";
import { CACHE_NAMESPACES } from "../scripts/lib/build-cache-namespaces.mjs";
import { bookshopAffiliateUrl, bookshopAffiliateIdFromEnv } from "../scripts/lib/bookshop-affiliate.mjs";
import { coverForReadingEntryFrom } from "../scripts/lib/reading-cover-inherit.mjs";
import { applyReadingFavoritesOverrides } from "../scripts/lib/reading-favorites-apply.mjs";
import readingFavoritesOverrides from "../data/reading-favorites.json";
import {
  hasThinking,
  monthLabelET,
  renderThinkingHtml,
  thinkingGridItemHtml,
  thinkingGridMonthHtml,
  thinkingItemFromRow,
  thinkingListEntryHtml,
  thinkingPostMetaHtml,
  thinkingSlug,
} from "../scripts/lib/render/thinking.mjs";
import {
  readingGridItemHtml,
  readingGridMonthHtml,
  readingMonthLabel,
  renderLinklogArchiveItem,
  renderLinklogItem,
  renderPostItem,
  renderReadingFavoriteItem,
  renderReadingItem,
} from "../scripts/lib/render/lists.mjs";
import {
  fillLiveTemplate,
  LIVE_TEMPLATE_PATHS,
  postPermalinkParts,
  thinkingPermalinkParts,
} from "../scripts/lib/render/pages.mjs";
import { changesSince, latestChangeId } from "./content-changes.mjs";
import { viewPathFor, withoutConditionals, withViewCount } from "./page-views.mjs";

const SITE_HOST = "rommy.blog";
const HOME_LIST_SIZE = 5; // MAX_PER_SECTION in scripts/build.mjs
const THINKING_FILTER_SEGMENTS = new Set(["images", "videos", "audio", "youtube", "music", "text"]);

/** Whether this request is one the overlay may need to touch. */
export function isLiveRoute(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const url = new URL(request.url);
  if (url.hostname !== SITE_HOST) return false;
  return /^\/($|thinking(\/|$)|posts\/|writing(\/|$)|reading(\/|$)|sharing(\/|$))/.test(url.pathname);
}

/**
 * A rommy.blog request that the overlay routes catch but that is neither a
 * page to overlay nor the API or media, such as /thinking-composer.js under
 * the rommy.blog/thinking* route. It goes to Pages untouched.
 */
export function isSitePassthrough(request) {
  const url = new URL(request.url);
  return url.hostname === SITE_HOST && !/^\/(api|media)\//.test(url.pathname);
}

/**
 * Serve a page from Pages with the changes since its build applied, and —
 * on a permalink — its view count (worker/page-views.mjs), added after the
 * overlay's edge cache so a cached copy never freezes the number.
 */
export async function serveLive(request, env, ctx) {
  if (viewPathFor(request)) request = withoutConditionals(request);
  const res = await overlaid(request, env, ctx);
  return withViewCount(request, res, env);
}

async function overlaid(request, env, ctx) {
  let origin = await fetch(request);
  try {
    // A browser revalidating its copy gets a bodiless 304 from Pages, which
    // would keep it on the stale page. Fetch in full when there is news.
    if (origin.status === 304 && env.DB) {
      const watermark = Number(origin.headers.get("X-Live-Watermark"));
      if (!Number.isFinite(watermark) || (await latestChangeId(env.DB)) > watermark) {
        const headers = new Headers(request.headers);
        headers.delete("If-None-Match");
        headers.delete("If-Modified-Since");
        origin = await fetch(new Request(request, { headers }));
      }
    }
    return await overlay(request, origin, env, ctx);
  } catch (err) {
    console.error("live overlay failed; serving the static page", err);
    return tagged(origin, "error");
  }
}

function tagged(res, status) {
  const out = new Response(res.body, res);
  out.headers.set("X-Live-Overlay", status);
  if (status === "applied") {
    // The bytes are no longer the static file's.
    out.headers.delete("Content-Length");
    out.headers.delete("ETag");
  }
  return out;
}

function isHtml(res) {
  return res.ok && (res.headers.get("content-type") || "").includes("text/html");
}

/**
 * Which kinds of change can alter a page at this path. Kept tight on
 * purpose: on the Workers Free plan (10 ms CPU) rewriting a large page is
 * the expensive part, so a page no change can touch is never parsed.
 */
function kindsForPath(pathname) {
  if (pathname === "/") {
    return new Set([CONTENT_KIND.THINKING, CONTENT_KIND.POST, CONTENT_KIND.READING, CONTENT_KIND.LINKLOG]);
  }
  if (/^\/thinking(\/|$)/.test(pathname)) return new Set([CONTENT_KIND.THINKING]);
  if (/^\/writing(\/|$)/.test(pathname)) return new Set([CONTENT_KIND.POST]);
  if (/^\/reading(\/|$)/.test(pathname)) return new Set([CONTENT_KIND.READING, CONTENT_KIND.FAVORITE]);
  if (/^\/sharing(\/|$)/.test(pathname)) return new Set([CONTENT_KIND.LINKLOG]);
  return new Set();
}

// Overlaid pages are kept in the edge cache, keyed by the page, the build it
// came from and the newest change, so only the first view per data centre
// after a change pays to render it; a newer change is a new key, never a
// stale hit. The lifetime only bounds how long an unused copy lingers.
const OVERLAY_CACHE_TTL_SECONDS = 600;

function overlayCacheKey(url, watermark, latest, source) {
  const etag = source.headers.get("ETag") || "";
  const key = new URL("https://rommy.blog/__live/page");
  key.searchParams.set("p", url.pathname + url.search);
  key.searchParams.set("w", String(watermark));
  key.searchParams.set("c", String(latest));
  key.searchParams.set("e", etag);
  return key.toString();
}

/** Serve from, or fill, the overlay cache. `render` returns a Response or null. */
async function viaOverlayCache(request, key, ctx, render) {
  const cache = caches.default;
  if (request.method === "GET") {
    const hit = await cache.match(key);
    if (hit) {
      const out = new Response(hit.body, hit);
      out.headers.delete("Cache-Control");
      out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
      out.headers.set("X-Live-Cache", "HIT");
      return out;
    }
  }
  const res = await render();
  if (!res || request.method !== "GET" || !ctx) return res;
  const [forClient, forCache] = res.body ? res.body.tee() : [null, null];
  const stored = new Response(forCache, res);
  stored.headers.set("Cache-Control", `public, max-age=${OVERLAY_CACHE_TTL_SECONDS}`);
  ctx.waitUntil(cache.put(key, stored).catch(() => {}));
  const out = new Response(forClient, res);
  out.headers.set("X-Live-Cache", "MISS");
  return out;
}

async function overlay(request, origin, env, ctx) {
  if (!env.DB) return origin;
  const url = new URL(request.url);
  const target = permalinkTarget(url.pathname);
  const page = isHtml(origin);
  // A note or post published since the build has no page of its own yet, so
  // Pages answers its URL with a 404 (or a fallback). Only a permalink can be
  // conjured from nothing; anything else that isn't a page passes through.
  if (!page && !target) return origin;

  // The watermark comes from the page, or from the permalink template when
  // there is no page — the template is part of the same deploy.
  let template = null;
  let source = origin;
  if (!page) {
    template = await fetch(new URL(LIVE_TEMPLATE_PATHS[target.kind], url.origin));
    if (!isHtml(template)) return origin;
    source = template;
  }

  // The fast path: the page is at least as new as the newest change.
  const latest = await latestChangeId(env.DB);
  const header = source.headers.get("X-Live-Watermark");
  let watermark = header == null || header === "" ? NaN : Number(header);
  if (!Number.isFinite(watermark)) watermark = readWatermark(await source.clone().text());
  const unchanged = () => (page ? tagged(origin, "none") : origin);
  if (latest <= watermark) return unchanged();

  const changes = collapseChanges(await changesSince(env.DB, watermark));
  if (changes.size === 0) return unchanged();
  const key = overlayCacheKey(url, watermark, latest, source);

  // A permalink only ever changes with its own item.
  if (target) {
    if (!changes.has(liveKey(target.kind, target.key))) return unchanged();
    const permalink = await viaOverlayCache(request, key, ctx, () =>
      permalinkResponse(url, target, changes, env, template)
    );
    return permalink || unchanged();
  }

  // A list page only changes with the kinds it lists.
  const kinds = kindsForPath(url.pathname);
  const relevant = new Map([...changes].filter(([, c]) => kinds.has(c.kind)));
  if (relevant.size === 0) return unchanged();

  return viaOverlayCache(request, key, ctx, async () => {
    const plan = await buildPlan(url, relevant, env);
    return plan ? tagged(applyPlan(origin, plan), "applied") : null;
  }).then((res) => res || unchanged());
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function all(db, sql, ...params) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

function placeholders(n) {
  return Array.from({ length: n }, () => "?").join(", ");
}

async function siteInfo(db) {
  const rows = await all(db, "SELECT key, value FROM site_config WHERE key IN ('title', 'url')");
  const site = {};
  for (const row of rows) {
    try {
      site[row.key] = JSON.parse(row.value);
    } catch {
      site[row.key] = row.value;
    }
  }
  const title = site.title || "rommy.blog";
  const base = String(site.url || "https://rommy.blog").replace(/\/$/, "");
  return { title, base };
}

/** The build_cache entries the renderers read, as the build loads them. */
async function loadCaches(db, namespaces) {
  const out = Object.fromEntries(namespaces.map((ns) => [ns, {}]));
  if (namespaces.length === 0) return out;
  const rows = await all(
    db,
    `SELECT namespace, key, value FROM build_cache WHERE namespace IN (${placeholders(namespaces.length)})`,
    ...namespaces
  );
  for (const row of rows) {
    try {
      out[row.namespace][row.key] = JSON.parse(row.value);
    } catch {
      /* a malformed entry renders as a miss, as it does in the build */
    }
  }
  return out;
}

async function rowsByKey(db, kind, keys) {
  if (keys.length === 0) return new Map();
  const spec = {
    [CONTENT_KIND.THINKING]: ["thinking_posts", "slug", shapeThinkingRow],
    [CONTENT_KIND.POST]: ["posts", "slug", shapePostRow],
    [CONTENT_KIND.READING]: ["reading", "id", shapeReadingRow],
    [CONTENT_KIND.FAVORITE]: ["reading_favorites", "id", (r) => r],
    [CONTENT_KIND.LINKLOG]: ["linklog", "id", shapeLinklogRow],
  }[kind];
  const [table, column, shape] = spec;
  const rows = await all(
    db,
    `SELECT ${CONTENT_COLUMNS[kind]} FROM ${table} WHERE ${column} IN (${placeholders(keys.length)})`,
    ...keys
  );
  if (kind === CONTENT_KIND.FAVORITE) return new Map((await shapeFavorites(db, rows)).map((r) => [String(r.id), r]));
  return new Map(rows.map((r) => [String(r[column]), shape(r)]));
}

/** Must Reads rows with their genres and data/reading-favorites.json applied, as the build has them. */
async function shapeFavorites(db, rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  let genreRows = [];
  try {
    genreRows = await all(
      db,
      `SELECT rfg.favorite_id, rg.slug FROM reading_favorite_genres rfg
       JOIN reading_genres rg ON rg.id = rfg.genre_id
       WHERE rfg.favorite_id IN (${placeholders(ids.length)})
       ORDER BY rfg.favorite_id ASC, rfg.rank ASC`,
      ...ids
    );
  } catch {
    genreRows = [];
  }
  const genres = new Map();
  for (const g of genreRows) genres.set(g.favorite_id, [...(genres.get(g.favorite_id) || []), g.slug]);
  const shaped = rows.map((r) => shapeFavoriteRow(r, genres.get(r.id) || []));
  return applyReadingFavoritesOverrides(shaped, readingFavoritesOverrides);
}

/** Renderer context (see scripts/lib/render/thinking.mjs) built from build_cache. */
function renderContext(site, caches) {
  const sizes = caches[CACHE_NAMESPACES.THINKING_PHOTO_SIZES] || {};
  const frames = caches[CACHE_NAMESPACES.VIDEO_FRAMES] || {};
  return {
    base: site.base,
    thinkingUnfurls: caches[CACHE_NAMESPACES.THINKING_UNFURLS] || {},
    spotifyThumbnails: caches[CACHE_NAMESPACES.SPOTIFY_THUMBNAILS] || {},
    videoPosters: caches[CACHE_NAMESPACES.VIDEO_POSTERS] || {},
    photoSize: (u) => sizes[u] || null,
    videoFrame: (u) => frames[u] || null,
  };
}

const THINKING_CACHES = [
  CACHE_NAMESPACES.THINKING_UNFURLS,
  CACHE_NAMESPACES.SPOTIFY_THUMBNAILS,
  CACHE_NAMESPACES.VIDEO_POSTERS,
  CACHE_NAMESPACES.THINKING_PHOTO_SIZES,
  CACHE_NAMESPACES.VIDEO_FRAMES,
];

// ─── Permalinks ───────────────────────────────────────────────────────────────

function permalinkTarget(pathname) {
  const thinking = /^\/thinking\/([^/]+)\/?$/.exec(pathname);
  if (thinking && !THINKING_FILTER_SEGMENTS.has(thinking[1])) {
    return { kind: CONTENT_KIND.THINKING, key: decodeURIComponent(thinking[1]) };
  }
  const post = /^\/posts\/([^/]+)\/?$/.exec(pathname);
  if (post) return { kind: CONTENT_KIND.POST, key: decodeURIComponent(post[1]) };
  return null;
}

async function permalinkResponse(url, target, changes, env, template) {
  const change = changes.get(liveKey(target.kind, target.key));
  if (!change) return null;
  if (change.op === "delete") {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Live-Overlay": "applied" },
    });
  }

  const db = env.DB;
  const site = await siteInfo(db);
  const pageCtx = { base: site.base, siteTitle: site.title };
  let parts;
  if (target.kind === CONTENT_KIND.THINKING) {
    const row = (await rowsByKey(db, target.kind, [target.key])).get(target.key);
    if (!row) return null;
    const ctx = renderContext(site, await loadCaches(db, THINKING_CACHES));
    const item = thinkingItemFromRow(row, ctx);
    parts = thinkingPermalinkParts(item, row.slug, item.content_html, pageCtx, ctx);
  } else {
    // The pager needs the neighbours, in the build's order (newest first).
    const posts = (await all(db, `SELECT ${CONTENT_COLUMNS.post} FROM posts ORDER BY datetime DESC`)).map(shapePostRow);
    const i = posts.findIndex((p) => p.slug === target.key);
    if (i === -1) return null;
    parts = postPermalinkParts(posts[i], posts[i - 1] || null, posts[i + 1] || null, pageCtx);
  }

  // The template carries the deployed site's head, CSP, scripts and footer.
  template ||= await fetch(new URL(LIVE_TEMPLATE_PATHS[target.kind], url.origin));
  if (!isHtml(template)) return null;
  const html = fillLiveTemplate(await template.text(), parts);
  const headers = new Headers(template.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.set("X-Live-Overlay", "applied");
  return new Response(html, { status: 200, headers });
}

// ─── Lists ────────────────────────────────────────────────────────────────────

/**
 * How each live list renders one item. `sort` and `html` must match what
 * scripts/build.mjs writes for the same list, attribute for attribute.
 * Grouped lists (the grids) also say which month an item belongs to.
 */
function listRenderers(ctx, linkFor, coverFor, linklogUnfurls) {
  return {
    writing: {
      kind: CONTENT_KIND.POST,
      sort: (p) => datedItemSort(p),
      html: (p) => renderPostItem(p, true, { withBody: true }),
    },
    linklog: {
      kind: CONTENT_KIND.LINKLOG,
      sort: (l) => datedItemSort(l),
      html: (l) => renderLinklogArchiveItem(l, linklogUnfurls[l.url] ?? null),
    },
    reading: {
      kind: CONTENT_KIND.READING,
      sort: (r) => readingSort(r),
      html: (r) => renderReadingItem(r, linkFor(r)),
    },
    "reading-grid": {
      kind: CONTENT_KIND.READING,
      sort: (r) => readingSort(r),
      group: (r) => readingMonthLabel(r.ym),
      groupSort: (r) => r.ym,
      html: (r) => readingGridItemHtml(r, coverFor(r), linkFor(r), []),
      groupHtml: (label, tiles, groupSort) => readingGridMonthHtml(label, tiles, groupSort),
    },
    favorites: {
      kind: CONTENT_KIND.FAVORITE,
      sort: (r) => r.title,
      html: (r) => renderReadingFavoriteItem(r, linkFor(r)),
    },
    "favorites-grid": {
      kind: CONTENT_KIND.FAVORITE,
      sort: (r) => r.title,
      html: (r) => readingGridItemHtml(r, coverFor(r), linkFor(r), r.genres),
    },
    thinking: {
      kind: CONTENT_KIND.THINKING,
      sort: (row) => datetimeSort(row.datetime),
      html: (row) => thinkingListEntryHtml(thinkingItemFromRow(row, ctx), ctx),
    },
    "thinking-grid": {
      kind: CONTENT_KIND.THINKING,
      sort: (row) => datetimeSort(row.datetime),
      group: (row) => monthLabelET(row.datetime),
      groupSort: (row) => monthKeyET(row.datetime),
      html: (row) => thinkingGridItemHtml(thinkingItemFromRow(row, ctx), ctx),
      groupHtml: (label, tiles, groupSort) => thinkingGridMonthHtml(label, tiles, groupSort),
    },
  };
}

function keyOf(kind, row) {
  return String(kind === CONTENT_KIND.THINKING || kind === CONTENT_KIND.POST ? row.slug : row.id);
}

/**
 * Everything the rewriter needs: which keys changed and how, each list's
 * rendered upserts, and replacement contents for the homepage lists.
 * Returns null when nothing on this page can be affected.
 */
async function buildPlan(url, changes, env) {
  const db = env.DB;
  const kinds = new Set([...changes.values()].map((c) => c.kind));
  const upsertKeys = {};
  for (const c of changes.values()) {
    if (c.op === "upsert") (upsertKeys[c.kind] ||= []).push(c.key);
  }

  const site = await siteInfo(db);
  const namespaces = [
    ...(kinds.has(CONTENT_KIND.THINKING) ? THINKING_CACHES : []),
    ...(kinds.has(CONTENT_KIND.LINKLOG) ? [CACHE_NAMESPACES.LINKLOG_UNFURLS] : []),
    ...(kinds.has(CONTENT_KIND.READING) || kinds.has(CONTENT_KIND.FAVORITE) ? [CACHE_NAMESPACES.READING_COVERS] : []),
  ];
  const caches = await loadCaches(db, namespaces);
  const ctx = renderContext(site, caches);
  const affiliateId = bookshopAffiliateIdFromEnv(env);
  const linkFor = (r) => bookshopAffiliateUrl(r.url, affiliateId);
  const covers = caches[CACHE_NAMESPACES.READING_COVERS] || {};
  const coverFor = (r) => coverForReadingEntryFrom(r, covers);
  const renderers = listRenderers(ctx, linkFor, coverFor, caches[CACHE_NAMESPACES.LINKLOG_UNFURLS] || {});

  // Rendered upserts per list, kept in list order.
  const rows = {};
  for (const [kind, keys] of Object.entries(upsertKeys)) rows[kind] = await rowsByKey(db, kind, keys);
  const items = {};
  for (const [name, r] of Object.entries(renderers)) {
    const found = rows[r.kind];
    if (!found) continue;
    items[name] = [...found.entries()].map(([key, row]) => {
      const sort = r.sort(row);
      const lk = liveKey(r.kind, key);
      return {
        key: lk,
        sort,
        group: r.group ? r.group(row) : null,
        groupSort: r.groupSort ? r.groupSort(row) : null,
        html: withLiveAttrs(r.html(row), lk, sort),
      };
    });
  }

  const ops = new Map([...changes.values()].map((c) => [liveKey(c.kind, c.key), c.op]));
  const replace = url.pathname === "/" ? await homeLists(db, kinds, ctx, linkFor) : {};
  return { ops, items, renderers, replace };
}

/** The homepage's short lists, re-rendered whole for every kind that changed. */
async function homeLists(db, kinds, ctx, linkFor) {
  const out = {};
  if (kinds.has(CONTENT_KIND.THINKING)) {
    const [row] = (await all(db, `SELECT ${CONTENT_COLUMNS.thinking} FROM thinking_posts ORDER BY datetime DESC LIMIT 1`)).map(
      shapeThinkingRow
    );
    if (row && hasThinking(row)) {
      const item = thinkingItemFromRow(row, ctx);
      out["home-thinking"] = `
          <li>
            <div class="microblog-entry">
              ${renderThinkingHtml(row, ctx)}
              ${thinkingPostMetaHtml(item, thinkingSlug(item))}
            </div>
          </li>
        `;
    }
  }
  const list = (items) => `\n${items.join("\n")}\n        `;
  if (kinds.has(CONTENT_KIND.POST)) {
    const posts = (await all(db, `SELECT ${CONTENT_COLUMNS.post} FROM posts ORDER BY datetime DESC LIMIT ?`, HOME_LIST_SIZE)).map(shapePostRow);
    out["home-writing"] = list(posts.map((p) => renderPostItem(p)));
  }
  if (kinds.has(CONTENT_KIND.READING)) {
    const reading = (
      await all(db, `SELECT ${CONTENT_COLUMNS.reading} FROM reading ORDER BY ym DESC, added_at DESC, id DESC LIMIT ?`, HOME_LIST_SIZE)
    ).map(shapeReadingRow);
    out["home-reading"] = list(reading.map((r) => renderReadingItem(r, linkFor(r))));
  }
  if (kinds.has(CONTENT_KIND.LINKLOG)) {
    const links = (await all(db, `SELECT ${CONTENT_COLUMNS.linklog} FROM linklog ORDER BY datetime DESC LIMIT ?`, HOME_LIST_SIZE)).map(
      shapeLinklogRow
    );
    out["home-linklog"] = list(links.map(renderLinklogItem));
  }
  return out;
}

// ─── Rewriting ────────────────────────────────────────────────────────────────

/** Does an item with sort `a` belong above one with sort `b` in a list ordered `order`? */
function above(order, a, b) {
  if (order === "title") return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }) < 0;
  return sortsAbove(a, b);
}

function inOrder(order, list) {
  return [...list].sort((x, y) => (above(order, x.sort, y.sort) ? -1 : above(order, y.sort, x.sort) ? 1 : 0));
}

/**
 * Apply a plan as the page streams. Lists are walked in document order: an
 * item sitting above the next existing one is inserted before it, the rest
 * are appended at the list's end. An upsert whose item is already on the
 * page (an edit, or a change the build caught mid-run) replaces it in place
 * instead — and because inserts only go before strictly lower sorts, the
 * page's own copy is always reached first.
 */
function applyPlan(origin, plan) {
  const { ops, items, renderers, replace } = plan;
  const stack = []; // open live lists
  const groupStack = []; // open grouped-grid containers

  const pendingFor = (name, group) => {
    const all = items[name] || [];
    // A new item is only placed in a list it isn't already part of, so skip
    // keys whose op is delete; group filters the grids to one month each.
    return all.filter((it) => ops.get(it.key) === "upsert" && (group == null || it.group === group));
  };

  const rewriter = new HTMLRewriter()
    .on("[data-live-list]", {
      element(el) {
        const name = el.getAttribute("data-live-list");
        if (Object.prototype.hasOwnProperty.call(replace, name)) {
          el.setInnerContent(replace[name], { html: true });
          return;
        }
        if (name.startsWith("home-")) return;
        const order = el.getAttribute("data-live-order") || "desc";
        const group = el.getAttribute("data-live-group");
        const state = { name, order, pending: inOrder(order, pendingFor(name, group)), placed: new Set() };
        stack.push(state);
        // Mark this month as present so the grid does not grow a duplicate.
        if (group != null && groupStack.length) groupStack[groupStack.length - 1].present.add(group);
        el.onEndTag((end) => {
          const rest = state.pending.filter((it) => !state.placed.has(it.key));
          if (rest.length) end.before(`${rest.map((it) => it.html).join("\n")}\n        `, { html: true });
          stack.pop();
        });
      },
    })
    .on("[data-live-key]", {
      element(el) {
        const state = stack[stack.length - 1];
        if (!state) return;
        const key = el.getAttribute("data-live-key");
        const sort = el.getAttribute("data-live-sort") || "";
        const before = [];
        for (const it of state.pending) {
          if (state.placed.has(it.key) || it.key === key) continue;
          if (!above(state.order, it.sort, sort)) break;
          before.push(it.html);
          state.placed.add(it.key);
        }
        if (before.length) el.before(`${before.join("\n")}\n`, { html: true });

        const op = ops.get(key);
        if (op === "delete") {
          el.remove();
        } else if (op === "upsert") {
          const mine = state.pending.find((it) => it.key === key);
          state.placed.add(key);
          // Still on the page but no longer in this list (moved month): drop it.
          if (mine) el.replace(mine.html, { html: true });
          else el.remove();
        }
      },
    })
    .on("[data-live-groups]", {
      element(el) {
        const name = el.getAttribute("data-live-groups");
        const r = renderers[name];
        const state = { name, r, present: new Set(), created: new Set() };
        groupStack.push(state);
        el.onEndTag((end) => {
          const html = newGroups(state, () => true);
          if (html) end.before(`${html}\n      `, { html: true });
          groupStack.pop();
        });
      },
    })
    .on("[data-live-group-sort]", {
      element(el) {
        const state = groupStack[groupStack.length - 1];
        if (!state) return;
        const sort = el.getAttribute("data-live-group-sort") || "";
        // A month newer than this one, with no section of its own yet, goes here.
        const html = newGroups(state, (groupSort) => sortsAbove(groupSort, sort));
        if (html) el.before(`${html}\n`, { html: true });
      },
    });

  /** Sections for months that new items need and the page lacks. */
  function newGroups(state, fits) {
    if (!state.r?.groupHtml) return "";
    const byGroup = new Map();
    for (const it of pendingFor(state.name, null)) {
      if (state.present.has(it.group) || state.created.has(it.group)) continue;
      if (!fits(it.groupSort)) continue;
      const g = byGroup.get(it.group) || { label: it.group, groupSort: it.groupSort, items: [] };
      g.items.push(it);
      byGroup.set(it.group, g);
    }
    const groups = [...byGroup.values()].sort((a, b) => (sortsAbove(a.groupSort, b.groupSort) ? -1 : 1));
    for (const g of groups) state.created.add(g.label);
    return groups
      .map((g) => state.r.groupHtml(g.label, inOrder("desc", g.items).map((it) => it.html).join("\n"), g.groupSort))
      .join("\n");
  }

  return rewriter.transform(origin);
}
