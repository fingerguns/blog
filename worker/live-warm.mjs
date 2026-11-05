/**
 * Warm the build's lookup caches for a post that has just been written, so
 * the live overlay renders it finished — link cards, Spotify art, a landscape
 * photo at its own shape, a video's grid poster — rather than plain until the
 * rebuild fetches them.
 *
 * Each entry goes into the same D1 build_cache namespace, under the same key
 * and in the same JSON encoding the build uses (scripts/build.mjs), so the
 * rebuild finds it already done. Run in ctx.waitUntil after the write; the
 * overlay picks each entry up on the next page view, since it renders from
 * D1 every time. Never throws.
 */
import { CACHE_NAMESPACES } from "../scripts/lib/build-cache-namespaces.mjs";
import { fetchLinkUnfurl } from "../scripts/lib/link-unfurl.mjs";
import { imageSizeFromBytes } from "../scripts/lib/image-size.mjs";
import { singlePhotoUrl, unfurlableUrls } from "../scripts/lib/thinking-html.mjs";
import { upgradeSpotifyImageUrl, videoPosterKeyFromVideoUrl } from "../scripts/lib/media-url.mjs";
import { spotifyEmbedFromHtml, videoSrcFromHtml } from "../scripts/lib/render/thinking.mjs";

const SITE_URL = "https://rommy.blog";
const PHOTO_HEADER_BYTES = 64 * 1024; // as scripts/lib/image-size.mjs reads

async function cachedKeys(db, namespace, keys) {
  if (keys.length === 0) return new Set();
  const { results } = await db
    .prepare(`SELECT key FROM build_cache WHERE namespace = ? AND key IN (${keys.map(() => "?").join(", ")})`)
    .bind(namespace, ...keys)
    .all();
  return new Set((results || []).map((r) => r.key));
}

async function putCache(db, namespace, key, value) {
  await db
    .prepare(
      `INSERT INTO build_cache (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(namespace, key, JSON.stringify(value === undefined ? null : value), new Date().toISOString())
    .run();
}

/** R2 key behind a rommy.blog/media/ URL, or "" for anything else. */
function mediaKeyFromUrl(url) {
  const prefix = `${SITE_URL}/media/`;
  return String(url || "").startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : "";
}

async function spotifyThumbnail(type, id) {
  try {
    const pageUrl = `https://open.spotify.com/${type}/${id}`;
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(pageUrl)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.thumbnail_url === "string" ? upgradeSpotifyImageUrl(data.thumbnail_url) : null;
  } catch {
    return null;
  }
}

export async function warmThinkingCaches(env, { text, mediaUrl, mediaType, mediaUrls = [], contentHtml }) {
  const db = env.DB;
  if (!db) return;
  try {
    // Link cards. A miss is cached as false and not retried, as in the build.
    const urls = unfurlableUrls(text);
    const haveUnfurls = await cachedKeys(db, CACHE_NAMESPACES.THINKING_UNFURLS, urls);
    await Promise.all(
      urls
        .filter((u) => !haveUnfurls.has(u))
        .map(async (u) => putCache(db, CACHE_NAMESPACES.THINKING_UNFURLS, u, (await fetchLinkUnfurl(u)) || false))
    );

    // Spotify art. The build caches only hits (a miss retries next build).
    const embed = spotifyEmbedFromHtml(contentHtml);
    if (embed) {
      const key = `${embed.type}:${embed.id}`;
      if (!(await cachedKeys(db, CACHE_NAMESPACES.SPOTIFY_THUMBNAILS, [key])).has(key)) {
        const thumb = await spotifyThumbnail(embed.type, embed.id);
        if (thumb) await putCache(db, CACHE_NAMESPACES.SPOTIFY_THUMBNAILS, key, thumb);
      }
    }

    // A single photo's shape, read from the start of the file in R2.
    const photo = singlePhotoUrl(mediaUrl, mediaType, SITE_URL, mediaUrls);
    const photoKey = mediaKeyFromUrl(photo);
    if (photo && photoKey && env.MEDIA && !(await cachedKeys(db, CACHE_NAMESPACES.THINKING_PHOTO_SIZES, [photo])).has(photo)) {
      const object = await env.MEDIA.get(photoKey, { range: { offset: 0, length: PHOTO_HEADER_BYTES } });
      const size = object ? imageSizeFromBytes(new Uint8Array(await object.arrayBuffer())) : null;
      await putCache(db, CACHE_NAMESPACES.THINKING_PHOTO_SIZES, photo, size || false);
    }

    // Whether a video has its grid poster yet (the build rechecks misses).
    const videoSrc = videoSrcFromHtml(contentHtml);
    const posterKey = videoPosterKeyFromVideoUrl(videoSrc, SITE_URL);
    if (videoSrc && posterKey && env.MEDIA) {
      await putCache(db, CACHE_NAMESPACES.VIDEO_POSTERS, videoSrc, Boolean(await env.MEDIA.head(posterKey)));
    }
  } catch (err) {
    console.error("live warm: Thinking caches", err);
  }
}

export async function warmLinklogCache(env, url) {
  const db = env.DB;
  if (!db || !url) return;
  try {
    if ((await cachedKeys(db, CACHE_NAMESPACES.LINKLOG_UNFURLS, [url])).has(url)) return;
    await putCache(db, CACHE_NAMESPACES.LINKLOG_UNFURLS, url, (await fetchLinkUnfurl(url)) || false);
  } catch (err) {
    console.error("live warm: Sharing card", err);
  }
}
