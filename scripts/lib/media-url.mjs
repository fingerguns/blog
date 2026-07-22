export const GRID_THUMB_WIDTH = 252;

/** Rewrite legacy R2 public URLs to same-origin /media/ paths (iOS audio playback). */
export function toSiteMediaUrl(url, siteUrl = "https://rommy.blog") {
  if (!url) return "";
  try {
    const u = new URL(url);
    const base = siteUrl.replace(/\/$/, "");
    if (u.hostname.endsWith(".r2.dev") && u.pathname.startsWith("/thinking/")) {
      return `${base}/media${u.pathname}`;
    }
    if (u.origin === base && u.pathname.startsWith("/media/")) {
      return url;
    }
  } catch {
    /* ignore invalid URLs */
  }
  return url;
}

/** Small square thumb for Thinking grid tiles (Worker-resized for rommy.blog media). */
export function thinkingGridThumbUrl(url, siteUrl = "https://rommy.blog") {
  if (!url) return "";
  const normalized = toSiteMediaUrl(url, siteUrl);
  try {
    const base = siteUrl.replace(/\/$/, "");
    const u = new URL(normalized);
    const origin = new URL(base).origin;
    if (u.origin === origin) {
      const key = u.pathname.replace(/^\/media\//, "");
      if (/^(thinking|reading)\/.+\.(jpe?g|png|webp|gif)$/i.test(key)) {
        return `${base}/media/thumb/${GRID_THUMB_WIDTH}/${key}`;
      }
    }
  } catch {
    /* ignore invalid URLs */
  }
  if (/spotifycdn\.com\/image\/ab67616d00001e02/i.test(url)) {
    return url.replace(/ab67616d00001e02/i, "ab67616d00004851");
  }
  if (/i\.ytimg\.com\/vi\/[^/]+\/mqdefault\.jpg/i.test(url)) {
    return url.replace(/mqdefault\.jpg/i, "default.jpg");
  }
  return url;
}
