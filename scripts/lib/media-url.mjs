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

// A native video's stills live beside it in R2, named after the video file:
// `<uuid>-poster.jpg` is the 512×512 square crop for the grid tile, and
// `<uuid>-frame.jpg` the first frame at the video's own shape, used as the
// <video poster> in the feed and on the permalink.
function videoCompanionKey(url, siteUrl, suffix) {
  if (!url) return "";
  const normalized = toSiteMediaUrl(url, siteUrl);
  try {
    const u = new URL(normalized);
    const key = u.pathname.replace(/^\/media\//, "");
    if (/^thinking\/video\/.+\.(mp4|mov|m4v)$/i.test(key)) {
      return key.replace(/\.(mp4|mov|m4v)$/i, suffix);
    }
  } catch {
    /* ignore invalid URLs */
  }
  return "";
}

function companionUrl(key, siteUrl) {
  return key ? `${String(siteUrl).replace(/\/$/, "")}/media/${key}` : "";
}

/** R2 key for a native video's grid poster JPEG (paired with the .mov/.mp4). */
export function videoPosterKeyFromVideoUrl(url, siteUrl = "https://rommy.blog") {
  return videoCompanionKey(url, siteUrl, "-poster.jpg");
}

/** Public /media/ URL for a native video's grid poster, or "" if `url` is not one. */
export function videoPosterUrlFromVideoUrl(url, siteUrl = "https://rommy.blog") {
  return companionUrl(videoPosterKeyFromVideoUrl(url, siteUrl), siteUrl);
}

/** R2 key for a native video's full-frame still (its <video poster>). */
export function videoFrameKeyFromVideoUrl(url, siteUrl = "https://rommy.blog") {
  return videoCompanionKey(url, siteUrl, "-frame.jpg");
}

/** Public /media/ URL for a native video's full-frame still, or "" if `url` is not one. */
export function videoFrameUrlFromVideoUrl(url, siteUrl = "https://rommy.blog") {
  return companionUrl(videoFrameKeyFromVideoUrl(url, siteUrl), siteUrl);
}

/** Largest common Spotify CDN size for album/track art (640×640). */
const SPOTIFY_ALBUM_ART_LARGE = "ab67616d0000b273";

/** Upgrade Spotify oEmbed / cache URLs to the largest CDN variant. */
export function upgradeSpotifyImageUrl(url) {
  if (!url || !/spotifycdn\.com\/image\//i.test(url)) return url;
  // Album/track art uses a size suffix after ab67616d0000; podcast/show art (ab676563) does not.
  if (/ab67616d0000/i.test(url)) {
    return url.replace(/ab67616d0000[0-9a-f]{4}/i, SPOTIFY_ALBUM_ART_LARGE);
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
  // hqdefault (480×360) is the largest rendition YouTube generates for every
  // video. sddefault and maxresdefault only exist when the source was that big,
  // so asking for them 404s on low-resolution uploads and Shorts — and since
  // nothing verifies these URLs at build time, a 404 is a permanently blank
  // tile. Prefer the smaller size that is always there.
  if (/i\.ytimg\.com\/vi\/[^/]+\/(default|mqdefault|hqdefault|sddefault)\.jpg/i.test(url)) {
    return url.replace(/\/(default|mqdefault|hqdefault|sddefault)\.jpg/i, "/hqdefault.jpg");
  }
  return url;
}
