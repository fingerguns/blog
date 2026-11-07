/**
 * Fetch Open Graph preview data (title, image, description, site name) for an
 * arbitrary external URL, for rendering unfurled cards on the Sharing
 * archive page and beneath Thinking notes. Regex-based meta tag extraction — no HTML parser dependency,
 * good enough for the handful of standard tags we care about.
 */
const FETCH_TIMEOUT_MS = 8000;
const MAX_CONTENT_LENGTH = 3 * 1024 * 1024;

/**
 * Open Graph is meant for link-preview crawlers. A self-identified bot
 * (`fingergunsbot` alone) is 403'd by DataDome on news sites — NYTimes
 * included — so the on-site card never appears and the miss is cached as
 * `false`. Keep our name, and add Twitterbot, the token those gates
 * whitelist for preview fetches. Confirmed 2026-11-07: fingergunsbot alone
 * → 403; this string → 200 with og:title.
 */
export const LINK_UNFURL_USER_AGENT =
  "Mozilla/5.0 (compatible; fingergunsbot/1.0; +https://rommy.blog) Twitterbot/1.0";

/** Bumped when the fetch identity changes, so cached scraper-blocks refetch. */
export const UNFURL_FETCHER_ID = "twitterbot-1";

/** Not a URL; stored alongside unfurl entries so a fetcher bump can find it. */
export const UNFURL_FETCHER_CACHE_KEY = "__fetcher";

/**
 * Drop cached misses when the fetch identity has changed, so a site that
 * 403'd the old crawler is tried again. Hits stay. No-op once this fetcher
 * has already run against this cache.
 */
export function invalidateUnfurlMisses(cache, fetcherId = UNFURL_FETCHER_ID) {
  if (!cache || typeof cache !== "object") return cache;
  if (cache[UNFURL_FETCHER_CACHE_KEY] === fetcherId) return cache;
  for (const key of Object.keys(cache)) {
    if (cache[key] === false) delete cache[key];
  }
  cache[UNFURL_FETCHER_CACHE_KEY] = fetcherId;
  return cache;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => safeCodePoint(Number(n), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => safeCodePoint(parseInt(n, 16), m));
}

function safeCodePoint(n, fallback) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}

// A content value is matched up to its own closing quote, so an apostrophe
// inside a double-quoted value ("Don't Look Up") does not end it early.
const CONTENT_ATTR = `content=(?:"([^"]*)"|'([^']*)')`;

function metaTag(html, prop) {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+${CONTENT_ATTR}`, "i"),
    new RegExp(`<meta[^>]+${CONTENT_ATTR}[^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    const value = m && (m[1] ?? m[2]);
    if (value) return decodeEntities(value).trim();
  }
  return null;
}

function titleTag(html) {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const t = m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  return t || null;
}

/**
 * Pull the preview fields out of a fetched page. Returns {title, image,
 * description, siteName} (any may be null), or null if there is nothing to
 * show. Only an http(s) image survives, resolved against the page URL.
 */
export function parseLinkUnfurl(html, url) {
  const title = metaTag(html, "og:title") || metaTag(html, "twitter:title") || titleTag(html);
  const image = metaTag(html, "og:image") || metaTag(html, "twitter:image");
  const description = metaTag(html, "og:description") || metaTag(html, "description");
  const siteName = metaTag(html, "og:site_name");

  let absoluteImage = null;
  if (image) {
    try {
      const resolved = new URL(image, url);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") {
        absoluteImage = resolved.toString();
      }
    } catch {
      absoluteImage = null;
    }
  }

  if (!absoluteImage && !description && !title) return null;

  return {
    title: title ? title.slice(0, 200) : null,
    image: absoluteImage,
    description: description ? description.slice(0, 280) : null,
    siteName: siteName || null,
  };
}

/** Fetch `url` and parse it with parseLinkUnfurl; null on any failure. */
export async function fetchLinkUnfurl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": LINK_UNFURL_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html")) return null;
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > MAX_CONTENT_LENGTH) return null;

    const html = await res.text();
    return parseLinkUnfurl(html, res.url || url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
