/**
 * Fetch Open Graph preview data (title, image, description, site name) for an
 * arbitrary external URL, for rendering unfurled cards on the Sharing
 * archive page and beneath Thinking notes. Regex-based meta tag extraction — no HTML parser dependency,
 * good enough for the handful of standard tags we care about.
 */
const FETCH_TIMEOUT_MS = 8000;
const MAX_CONTENT_LENGTH = 3 * 1024 * 1024;

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
        "user-agent": "Mozilla/5.0 (compatible; fingergunsbot/1.0; +https://fingerguns.blog)",
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
