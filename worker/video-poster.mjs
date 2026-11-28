import { videoFrameKeyFromVideoUrl, videoPosterKeyFromVideoUrl } from "../scripts/lib/media-url.mjs";

// Two stills sit beside each Thinking video in R2, both captured in the
// composer from the first frame: `<uuid>-poster.jpg`, a 512×512 square crop
// for the grid tile, and `<uuid>-frame.jpg`, the frame at the video's own
// shape (longest side up to 1280px), which the feed uses as <video poster>.
export function thinkingVideoPosterKey(videoKey) {
  return String(videoKey || "").replace(/\.(mp4|mov|m4v)$/i, "-poster.jpg");
}

export function isValidThinkingVideoPosterKey(key) {
  return /^thinking\/video\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}-poster\.jpg$/i.test(
    String(key || "")
  );
}

/** Store a 512×512 JPEG poster alongside a thinking video in R2. */
export async function uploadVideoPosterToR2(env, videoKey, posterFile) {
  if (!env.MEDIA || !posterFile || posterFile.size <= 0) return null;

  const key = thinkingVideoPosterKey(videoKey);
  if (!isValidThinkingVideoPosterKey(key)) {
    throw new Error("Invalid video poster upload.");
  }
  if (posterFile.size > 512 * 1024) {
    throw new Error("Video poster must be 512 KB or smaller.");
  }

  const mimeType = (posterFile.type || "image/jpeg").toLowerCase().split(";")[0].trim();
  if (mimeType && mimeType !== "image/jpeg" && mimeType !== "image/jpg") {
    throw new Error("Video poster must be JPEG.");
  }

  const bytes = await posterFile.arrayBuffer();
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return key;
}

export function thinkingVideoFrameKey(videoKey) {
  return String(videoKey || "").replace(/\.(mp4|mov|m4v)$/i, "-frame.jpg");
}

export function isValidThinkingVideoFrameKey(key) {
  return /^thinking\/video\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}-frame\.jpg$/i.test(
    String(key || "")
  );
}

/** Store the full-frame JPEG still alongside a thinking video in R2. */
export async function uploadVideoFrameToR2(env, videoKey, frameFile) {
  if (!env.MEDIA || !frameFile || frameFile.size <= 0) return null;

  const key = thinkingVideoFrameKey(videoKey);
  if (!isValidThinkingVideoFrameKey(key)) {
    throw new Error("Invalid video still upload.");
  }
  if (frameFile.size > 1024 * 1024) {
    throw new Error("Video still must be 1 MB or smaller.");
  }

  const mimeType = (frameFile.type || "image/jpeg").toLowerCase().split(";")[0].trim();
  if (mimeType && mimeType !== "image/jpeg" && mimeType !== "image/jpg") {
    throw new Error("Video still must be JPEG.");
  }

  await env.MEDIA.put(key, await frameFile.arrayBuffer(), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return key;
}

/**
 * Thinking videos with a still missing from R2, newest first, for the admin
 * Status tab's "Videos missing stills" list. The composer captures both stills
 * in the browser, and a capture that fails leaves the post with no grid poster
 * and, without the full frame, no blurred backdrop for a portrait clip; the
 * fix is `npm run backfill-video-posters`. Only videos stored in R2 are
 * checked (the stills sit beside them); each costs two R2 HEADs.
 */
export async function thinkingVideosMissingStills(db, media, { limit = 100 } = {}) {
  if (!db || !media) return [];
  const { results = [] } = await db
    .prepare(
      `SELECT slug, datetime, media_url FROM thinking_posts
       WHERE media_type = 'video' ORDER BY datetime DESC LIMIT ?`
    )
    .bind(limit)
    .all();
  const checked = await Promise.all(
    results.map(async (row) => {
      const posterKey = videoPosterKeyFromVideoUrl(row.media_url);
      const frameKey = videoFrameKeyFromVideoUrl(row.media_url);
      if (!posterKey || !frameKey) return null;
      const [poster, frame] = await Promise.all([media.head(posterKey), media.head(frameKey)]);
      const missing = [];
      if (!poster) missing.push("poster");
      if (!frame) missing.push("frame");
      return missing.length ? { slug: row.slug, datetime: row.datetime, missing } : null;
    })
  );
  return checked.filter(Boolean);
}
