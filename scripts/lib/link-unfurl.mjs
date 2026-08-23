/**
 * Fetch Open Graph preview data (image, description, site name) for an
 * arbitrary external URL, for rendering unfurled cards on the Sharing
 * archive page. Regex-based meta tag extraction — no HTML parser dependency,
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
    .replace(/&#0?39;/g, "'");
}

function metaTag(html, prop) {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1]);
  }
  return null;
}

/** Returns {image, description, siteName} (any may be null), or null if nothing usable was found. */
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
    const image = metaTag(html, "og:image") || metaTag(html, "twitter:image");
    const description = metaTag(html, "og:description") || metaTag(html, "description");
    const siteName = metaTag(html, "og:site_name");

    let absoluteImage = null;
    if (image) {
      try {
        absoluteImage = new URL(image, url).toString();
      } catch {
        absoluteImage = null;
      }
    }

    if (!absoluteImage && !description) return null;

    return {
      image: absoluteImage,
      description: description ? description.slice(0, 280) : null,
      siteName: siteName || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
