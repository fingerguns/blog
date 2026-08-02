export const GRID_THUMB_WIDTH = 512;

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

/** R2 key for a native video's grid poster JPEG (paired with the .mov/.mp4). */
export function videoPosterKeyFromVideoUrl(url, siteUrl = "https://rommy.blog") {
  if (!url) return "";
  const normalized = toSiteMediaUrl(url, siteUrl);
  try {
    const u = new URL(normalized);
    const key = u.pathname.replace(/^\/media\//, "");
    if (/^thinking\/video\/.+\.(mp4|mov|m4v)$/i.test(key)) {
      return key.replace(/\.(mp4|mov|m4v)$/i, "-poster.jpg");
    }
  } catch {
    /* ignore invalid URLs */
  }
  return "";
}

/** Largest common Spotify CDN size for album/track art (640×640). */
const SPOTIFY_ALBUM_ART_LARGE = "ab67616d0000b273";
/** Largest common Spotify CDN size for podcast/show art (640×640). */
const SPOTIFY_SHOW_ART_LARGE = "ab6765630000f1bd";

/** Upgrade Spotify oEmbed / cache URLs to the largest CDN variant. */
export function upgradeSpotifyImageUrl(url) {
  if (!url || !/spotifycdn\.com\/image\//i.test(url)) return url;
  if (/ab67616d0000/i.test(url)) {
    return url.replace(/ab67616d0000[0-9a-f]{4}/i, SPOTIFY_ALBUM_ART_LARGE);
  }
  if (/ab6765630000/i.test(url)) {
    return url.replace(/ab6765630000[0-9a-f]{4}/i, SPOTIFY_SHOW_ART_LARGE);
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
  if (/spotifycdn\.com\/image\//i.test(url)) {
    return upgradeSpotifyImageUrl(url);
  }
  if (/i\.ytimg\.com\/vi\/[^/]+\/(default|mqdefault|hqdefault|sddefault)\.jpg/i.test(url)) {
    return url.replace(/\/(default|mqdefault|hqdefault|sddefault)\.jpg/i, "/sddefault.jpg");
  }
  return url;
}
