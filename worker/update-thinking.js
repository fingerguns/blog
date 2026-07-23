import { bookshopAffiliateUrl, isbnFromBookshopUrl } from "../scripts/lib/bookshop-affiliate.mjs";
import {
  buildLatestCoverLookup,
  inheritLatestCover,
} from "../scripts/lib/reading-cover-inherit.mjs";
import { thinkingSlugFromDate } from "../scripts/lib/thinking-slug.mjs";
import { escHtml } from "../scripts/lib/html.mjs";
import { coalesceImageParagraphsHtml } from "../scripts/lib/coalesce-images.mjs";
import { addHashtagFacets } from "../scripts/lib/linkify.mjs";
import { renderThinkingContentHtml } from "../scripts/lib/thinking-html.mjs";
import {
  scheduleSectionHintRefresh,
  refreshSectionHint,
  loadSectionHints,
  SECTION_NAMES,
} from "./section-hints.mjs";
import { serveMedia } from "./media.mjs";
import { createR2PresignedPutUrl } from "./r2-presign.mjs";
import { thinkingVideoPosterKey, uploadVideoPosterToR2 } from "./video-poster.mjs";

/**
 * Cloudflare Worker: admin API for rommy.blog
 *
 * Content is stored in Cloudflare D1. Static site is rebuilt via Pages deploy hook.
 *
 * Secrets (wrangler secret put):
 *   ADMIN_PASSWORD        — shared password for /admin/
 *   PAGES_DEPLOY_HOOK     — Cloudflare Pages deploy hook URL
 *   MICROBLOG_TOKEN       — Micropub token (optional)
 *   BLUESKY_HANDLE        — Bluesky handle (optional)
 *   BLUESKY_APP_PASSWORD  — Bluesky app password (optional)
 *   MASTODON_ACCESS_TOKEN — Mastodon access token (optional; see /settings/applications)
 *   MASTODON_INSTANCE     — Mastodon instance URL, default https://mas.to (optional)
 *   GITHUB_TOKEN          — optional fallback to trigger GitHub workflow_dispatch
 *
 * Direct video upload (presigned PUT to R2 — optional):
 *   R2_ACCOUNT_ID         — Cloudflare account ID
 *   R2_ACCESS_KEY_ID      — R2 S3 API token access key
 *   R2_SECRET_ACCESS_KEY    — R2 S3 API token secret
 *   Apply bucket CORS: wrangler r2 bucket cors set rommy-blog-media --file=r2-cors.json
 *
 * Workers AI (section hover tooltips — auto-regenerated on content changes):
 *   Enable Workers AI in Cloudflare dashboard; [ai] binding in wrangler.toml
 *
 * R2 (photos, audio, video on THINKING):
 *   Enable R2 in Cloudflare dashboard, then: wrangler r2 bucket create rommy-blog-media
 *   Enable public access on the bucket and set MEDIA_PUBLIC_URL in wrangler.toml [vars]
 *
 * Syndication of audio/video (Thinking posts):
 *   micro.blog  — audio and video URLs are passed via Micropub `audio[]` / `video[]` properties,
 *                 so micro.blog and downstream podcast/RSS readers render a native player.
 *   Mastodon    — audio and video files are uploaded as native media attachments (up to 40 MB).
 *                 Falls back to a link-in-text post when the file is too large or unavailable.
 *   Bluesky     — MP4 and MOV (iPhone) video both play natively via Bluesky's video-
 *                 processing service (video.bsky.app), which transcodes server-side.
 *                 Audio posts use a link card (Bluesky has no native audio support).
 *                 Video falls back to a link card when native upload, processing, or
 *                 createRecord fails.
 *   All media   — when a native player is attached, the Thinking permalink is also included in
 *                 the post text (Bluesky cannot combine a link card embed with media embeds).
 */

const SITE_URL = "https://rommy.blog";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_BLUESKY_IMAGE_BYTES = 2_000_000;
const MAX_BLUESKY_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_MASTODON_MEDIA_BYTES = 40 * 1024 * 1024;
const MAX_MASTODON_CHARS = 500;
const MAX_THINKING_PHOTOS = 4;
const DEFAULT_MASTODON_INSTANCE = "https://mas.to";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_AUDIO_TYPES = new Set(["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/mpeg", "audio/mp3"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v"]);
const IMAGE_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const AUDIO_EXT = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
};
const VIDEO_EXT = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
};
const SITE_TITLE = "rommy.blog";
const SITE_AUTHOR = "Rommy Ghaly";
const GA_ID = "G-L1CC5F3DP8";
const GA_SNIPPET = `    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>\n    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;

const AUTH_MAX_FAILURES = 5;
const AUTH_WINDOW_SEC = 15 * 60;
const AUTH_LOCKOUT_SEC = 15 * 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/media/")) {
      return serveMedia(request, env);
    }

    const allowedOrigins = (env.ALLOWED_ORIGINS || "https://rommy.blog")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const origin = request.headers.get("Origin") || "";
    const corsOrigin = resolveCorsOrigin(origin, allowedOrigins);

    const cors = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { ...cors, "Cache-Control": "no-store" },
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    if (!env.ADMIN_PASSWORD || !env.DB) {
      return json({ error: "Worker is not configured" }, 500, cors);
    }

    let payload;
    try {
      payload = await parseRequest(request);
    } catch (err) {
      return json({ error: err.message || "Invalid request body" }, 400, cors);
    }

    const { password, action } = payload;
    const db = env.DB;
    const clientIp = getClientIp(request);

    if (typeof password !== "string") {
      return json({ error: "Missing password" }, 400, cors);
    }

    try {
      await checkAuthRateLimit(db, clientIp);
    } catch (err) {
      if (err instanceof RateLimitError) {
        return json(
          { error: err.message },
          429,
          cors,
          { "Retry-After": String(err.retryAfterSec) }
        );
      }
      throw err;
    }

    if (!verifyAdminPassword(password, env.ADMIN_PASSWORD)) {
      await recordAuthFailure(db, clientIp);
      return json({ error: "Invalid password" }, 401, cors);
    }

    await clearAuthFailures(db, clientIp);

    if (action === "verify") {
      return json({ ok: true }, 200, cors);
    }

    if (action === "refresh-section-hints") {
      const section =
        typeof payload.section === "string" ? payload.section.trim() : "";
      const sections = section && SECTION_NAMES.includes(section) ? [section] : [...SECTION_NAMES];
      for (const name of sections) {
        await refreshSectionHint(env, db, name, null);
      }
      await triggerRebuild(env);
      return json({ ok: true, hints: await loadSectionHints(db) }, 200, cors);
    }

    if (action === "thinking") {
      return handleThinking(payload, db, cors, env, ctx);
    }

    if (action === "thinking-video-upload-url") {
      return handleThinkingVideoUploadUrl(payload, cors, env);
    }

    if (action === "list-thinking") {
      return handleListThinking(db, cors);
    }

    if (action === "post") {
      return handlePost(payload, db, cors, env, ctx);
    }

    if (action === "reading") {
      return handleReading(payload, db, cors, env, ctx);
    }

    if (action === "list-reading") {
      return handleListReading(db, cors);
    }

    if (action === "delete-reading") {
      return handleDeleteReading(payload, db, cors, env, ctx);
    }

    if (action === "reading-cover-candidates") {
      return handleReadingCoverCandidates(payload, cors, env);
    }

    if (action === "update-reading-cover") {
      return handleUpdateReadingCover(payload, db, cors, env);
    }

    if (action === "reading-favorite") {
      return handleReadingFavorite(payload, db, cors, env, ctx);
    }

    if (action === "list-reading-favorites") {
      return handleListReadingFavorites(db, cors);
    }

    if (action === "delete-reading-favorite") {
      return handleDeleteReadingFavorite(payload, db, cors, env, ctx);
    }

    if (action === "update-reading-favorite-cover") {
      return handleUpdateReadingFavoriteCover(payload, db, cors, env);
    }

    if (action === "sharing") {
      return handleSharing(payload, db, cors, env, ctx);
    }

    if (action === "upload-media") {
      return handleUploadMedia(payload, cors, env);
    }

    if (action === "fetch-title") {
      return handleFetchTitle(payload, cors);
    }

    if (action === "list-drafts") {
      return handleListDrafts(db, cors);
    }

    if (action === "save-draft") {
      return handleSaveDraft(payload, db, cors);
    }

    if (action === "load-draft") {
      return handleLoadDraft(payload, db, cors);
    }

    if (action === "delete-draft") {
      return handleDeleteDraft(payload, db, cors);
    }

    if (action === "fetch-post") {
      return handleFetchPost(payload, db, cors);
    }

    if (action === "edit-post") {
      return handleEditPost(payload, db, cors, env, ctx);
    }

    if (action === "delete-post") {
      return handleDeletePost(payload, db, cors, env, ctx);
    }

    if (action === "delete-thinking") {
      return handleDeleteThinking(payload, db, cors, env, ctx);
    }

    return json({ error: "Unknown action" }, 400, cors);
  },
};

// ─── Auth hardening ───────────────────────────────────────────────────────────

function resolveCorsOrigin(origin, allowedOrigins) {
  if (!origin) return allowedOrigins[0];
  if (allowedOrigins.includes(origin)) return origin;
  if (/^https:\/\/([a-z0-9-]+\.)*rommy-blog\.pages\.dev$/i.test(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return allowedOrigins[0];
}

class RateLimitError extends Error {
  constructor(retryAfterSec) {
    super("Too many failed login attempts. Try again in about 15 minutes.");
    this.retryAfterSec = retryAfterSec;
  }
}

function getClientIp(request) {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

function verifyAdminPassword(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.length !== b.length) {
    let sink = 0;
    for (let i = 0; i < a.length; i++) sink |= a[i] ^ a[i];
    return false;
  }
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

async function ensureAuthRateTable(db) {
  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS auth_rate_limit (
      ip TEXT PRIMARY KEY,
      fail_count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    )`
  );
}

async function checkAuthRateLimit(db, ip) {
  await ensureAuthRateTable(db);
  const now = Math.floor(Date.now() / 1000);
  const row = await dbFirst(
    db,
    "SELECT fail_count, window_start, locked_until FROM auth_rate_limit WHERE ip = ?",
    ip
  );
  if (!row) return;
  if (row.locked_until > now) {
    throw new RateLimitError(row.locked_until - now);
  }
  if (now - row.window_start > AUTH_WINDOW_SEC) {
    await dbRun(db, "DELETE FROM auth_rate_limit WHERE ip = ?", ip);
  }
}

async function recordAuthFailure(db, ip) {
  await ensureAuthRateTable(db);
  const now = Math.floor(Date.now() / 1000);
  const row = await dbFirst(
    db,
    "SELECT fail_count, window_start, locked_until FROM auth_rate_limit WHERE ip = ?",
    ip
  );

  if (!row || now - row.window_start > AUTH_WINDOW_SEC) {
    await dbRun(
      db,
      `INSERT INTO auth_rate_limit (ip, fail_count, window_start, locked_until)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(ip) DO UPDATE SET fail_count = 1, window_start = excluded.window_start, locked_until = 0`,
      ip,
      now
    );
    return;
  }

  const fails = row.fail_count + 1;
  const lockedUntil =
    fails >= AUTH_MAX_FAILURES ? now + AUTH_LOCKOUT_SEC : row.locked_until || 0;

  await dbRun(
    db,
    "UPDATE auth_rate_limit SET fail_count = ?, locked_until = ? WHERE ip = ?",
    fails,
    lockedUntil,
    ip
  );
}

async function clearAuthFailures(db, ip) {
  await ensureAuthRateTable(db);
  await dbRun(db, "DELETE FROM auth_rate_limit WHERE ip = ?", ip);
}

// ─── D1 helpers ───────────────────────────────────────────────────────────────

async function dbRun(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function dbFirst(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function dbAll(db, sql, ...params) {
  return db.prepare(sql).bind(...params).all();
}

async function triggerRebuild(env) {
  if (env.PAGES_DEPLOY_HOOK) {
    await fetch(env.PAGES_DEPLOY_HOOK, { method: "POST" }).catch(() => {});
    return;
  }
  // Fallback: GitHub workflow dispatch
  if (env.GITHUB_TOKEN) {
    const owner = env.GITHUB_OWNER || "fingerguns";
    const repo = env.GITHUB_REPO || "blog";
    const branch = env.GITHUB_BRANCH || "main";
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/build.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "rommy-blog-admin-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: branch }),
      }
    ).catch(() => {});
  }
}

async function savePostVersion(db, slug, title, summary, bodyHtml) {
  await dbRun(
    db,
    "INSERT INTO post_versions (slug, title, summary, body_html, edited_at) VALUES (?, ?, ?, ?, ?)",
    slug,
    title,
    summary,
    bodyHtml,
    new Date().toISOString()
  );
}

// ─── Request parsing ─────────────────────────────────────────────────────────

async function parseRequest(request) {
  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    const photoEntries = fd
      .getAll("photo")
      .concat(fd.getAll("photo[]"))
      .filter(
        (f) => f && typeof f === "object" && "arrayBuffer" in f && f.size > 0
      );
    const blueskyEntries = fd
      .getAll("photo_bluesky")
      .concat(fd.getAll("photo_bluesky[]"))
      .filter(
        (f) => f && typeof f === "object" && "arrayBuffer" in f && f.size > 0
      );
    const audio = fd.get("audio");
    const video = fd.get("video");
    return {
      password: fd.get("password"),
      action: fd.get("action"),
      folder: String(fd.get("folder") || "writing"),
      text: String(fd.get("text") || ""),
      photos: photoEntries.slice(0, MAX_THINKING_PHOTOS),
      photo_bluesky_list: blueskyEntries.slice(0, MAX_THINKING_PHOTOS),
      // Back-compat single fields for other actions (e.g. upload-photo)
      photo: photoEntries[0] || null,
      photo_bluesky: blueskyEntries[0] || null,
      audio:
        audio && typeof audio === "object" && "arrayBuffer" in audio && audio.size > 0
          ? audio
          : null,
      video:
        video && typeof video === "object" && "arrayBuffer" in video && video.size > 0
          ? video
          : null,
      video_poster: (() => {
        const poster = fd.get("video_poster");
        return poster &&
          typeof poster === "object" &&
          "arrayBuffer" in poster &&
          poster.size > 0
          ? poster
          : null;
      })(),
    };
  }
  return request.json();
}

// ─── Thinking ────────────────────────────────────────────────────────────────

function isLinkOnlyThinkingMedia(mediaType) {
  return mediaType === "audio" || mediaType === "video";
}

function thinkingSyndicationPrefix(mediaType) {
  if (mediaType === "video") return "Video: ";
  if (mediaType === "audio") return "Audio: ";
  return "";
}

function thinkingLinkSyndicationText(text, postUrl, mediaType) {
  const prefix = thinkingSyndicationPrefix(mediaType);
  if (text) return `${prefix}${text}\n\n${postUrl}`;
  return `${prefix}${postUrl}`;
}

/** Append the Thinking permalink when a native media attachment is also present. */
function thinkingSyndicationTextWithPermalink(text, postUrl) {
  const t = (text || "").trim();
  if (t.includes(postUrl)) return t;
  if (t) return `${t}\n\n${postUrl}`;
  return postUrl;
}

function thinkingBlueskySyndicationText(text, postUrl, mediaType) {
  const prefix = thinkingSyndicationPrefix(mediaType);
  if (text) return `${prefix}${text}`;
  return `${prefix}${postUrl}`;
}

function thinkingMediaLabel(mediaType) {
  if (mediaType === "video") return "Video";
  if (mediaType === "audio") return "Audio";
  return "Note";
}

function thinkingBlueskyLinkCard(postUrl, text, mediaType) {
  return {
    uri: postUrl,
    title: text.slice(0, 100).trim() || thinkingMediaLabel(mediaType),
    description: `${mediaType === "video" ? "Video" : "Audio"} on rommy.blog`,
    thumb: null,
  };
}

/**
 * Bluesky's video-processing service (video.bsky.app) accepts MP4 and MOV
 * (QuickTime) directly and transcodes server-side. Other formats (e.g. m4v)
 * still fall back to a link card since they're not in Bluesky's accepted list.
 */
function blueskySupportsNativeVideo(mimeType) {
  return mimeType === "video/mp4" || mimeType === "video/quicktime";
}

async function handleThinking(payload, db, cors, env, ctx) {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const photos = Array.isArray(payload.photos)
    ? payload.photos.filter(Boolean).slice(0, MAX_THINKING_PHOTOS)
    : payload.photo
      ? [payload.photo]
      : [];
  const photoBlueskyList = Array.isArray(payload.photo_bluesky_list)
    ? payload.photo_bluesky_list.filter(Boolean).slice(0, MAX_THINKING_PHOTOS)
    : payload.photo_bluesky
      ? [payload.photo_bluesky]
      : [];
  const audio = payload.audio || null;
  const video = payload.video || null;
  const videoKey =
    typeof payload.video_key === "string" ? payload.video_key.trim() : "";
  const hasPhotos = photos.length > 0;

  if (!text && !hasPhotos && !audio && !video && !videoKey) {
    return json({ error: "Add text, a photo, audio, or video" }, 400, cors);
  }
  if ([hasPhotos, audio, video, videoKey].filter(Boolean).length > 1) {
    return json({ error: "Add photos, audio, or video — not more than one kind" }, 400, cors);
  }
  if (photos.length > MAX_THINKING_PHOTOS) {
    return json({ error: `At most ${MAX_THINKING_PHOTOS} photos per post` }, 400, cors);
  }
  if (text.length > 2000) {
    return json({ error: "Text must be 2000 characters or fewer" }, 400, cors);
  }
  // Bluesky cross-post truncates at 300; admin shows a soft 300-char guide.

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const slug = thinkingSlugFromDate(now);
    const postUrl = `${SITE_URL}/thinking/${slug}/`;

    let mediaUrl = null;
    let mediaUrls = [];
    let mediaAlt = text.slice(0, 1000) || "";
    let mediaType = "";
    let uploadedPhotos = [];
    let blueskyCompressed = false;
    let syndicationPhotos = [];
    // syndicationMedia holds R2 upload metadata for audio/video syndication.
    let syndicationMedia = null;

    if (hasPhotos) {
      for (const photo of photos) {
        const uploaded = await uploadPhotoToR2(env, photo, "thinking");
        uploadedPhotos.push(uploaded);
        syndicationPhotos.push(syndicationPhotoFromUpload(uploaded));
      }
      mediaUrls = uploadedPhotos.map((u) => u.url);
      mediaUrl = mediaUrls[0];
      mediaAlt = text.slice(0, 1000) || "Photo";
      mediaType = "image";
    } else if (audio) {
      const uploaded = await uploadAudioToR2(env, audio);
      mediaUrl = uploaded.url;
      mediaAlt = text.slice(0, 1000) || "Audio";
      mediaType = "audio";
      syndicationMedia = { url: mediaUrl, bytes: uploaded.bytes, mimeType: uploaded.mimeType, key: uploaded.key, size: uploaded.bytes?.byteLength ?? 0, mediaType: "audio", alt: mediaAlt };
    } else if (video) {
      const uploaded = await uploadVideoToR2(env, video);
      if (payload.video_poster) {
        await uploadVideoPosterToR2(env, uploaded.key, payload.video_poster);
      }
      mediaUrl = uploaded.url;
      mediaAlt = text.slice(0, 1000) || "Video";
      mediaType = "video";
      syndicationMedia = { url: mediaUrl, bytes: uploaded.bytes, mimeType: uploaded.mimeType, key: uploaded.key, size: uploaded.bytes?.byteLength ?? 0, mediaType: "video", alt: mediaAlt };
    } else if (videoKey) {
      const uploaded = await finalizeVideoFromR2(env, videoKey, payload.video_mime);
      mediaUrl = uploaded.url;
      mediaAlt = text.slice(0, 1000) || "Video";
      mediaType = "video";
      // bytes is null for presigned uploads; we'll fetch from R2 when needed.
      syndicationMedia = { url: mediaUrl, bytes: null, mimeType: uploaded.mimeType, key: uploaded.key, size: uploaded.size ?? 0, mediaType: "video", alt: mediaAlt };
    }

    let microblogUrl = null;
    let microblogWarning = null;
    if (env.MICROBLOG_TOKEN) {
      try {
        const mbText = mediaType
          ? thinkingSyndicationTextWithPermalink(text, postUrl)
          : text;
        if (mediaType === "audio") {
          // Pass the hosted audio URL via Micropub so micro.blog renders a player.
          microblogUrl = await postToMicroblog(env.MICROBLOG_TOKEN, mbText, null, mediaUrl, null);
        } else if (mediaType === "video") {
          // Pass the hosted video URL via Micropub so micro.blog renders a player.
          microblogUrl = await postToMicroblog(env.MICROBLOG_TOKEN, mbText, null, null, mediaUrl);
        } else if (mediaType === "image") {
          microblogUrl = await postToMicroblog(env.MICROBLOG_TOKEN, mbText, syndicationPhotos);
        } else {
          microblogUrl = await postToMicroblog(env.MICROBLOG_TOKEN, text);
        }
      } catch (mbErr) {
        microblogWarning = formatServiceWarning("micro.blog", mbErr.message);
      }
    }

    let blueskyUri = null;
    let blueskyWarning = null;
    if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
      try {
        let blueskyImages = null;
        if (uploadedPhotos.length) {
          blueskyImages = [];
          for (let i = 0; i < uploadedPhotos.length; i++) {
            const uploaded = uploadedPhotos[i];
            const prepared = await prepareBlueskyImage(
              {
                bytes: uploaded.bytes,
                mimeType: uploaded.mimeType,
                alt: mediaAlt,
                aspectRatio: uploaded.aspectRatio,
              },
              photoBlueskyList[i] || null
            );
            blueskyImages.push(prepared.image);
            if (prepared.compressed) blueskyCompressed = true;
          }
        }

        // Try native video for MP4 and MOV — Bluesky's video service transcodes both.
        let blueskyVideo = null;
        if (
          mediaType === "video" &&
          syndicationMedia &&
          blueskySupportsNativeVideo(syndicationMedia.mimeType)
        ) {
          const videoBytes = await getMediaBytesForSyndication(env, syndicationMedia, MAX_BLUESKY_VIDEO_BYTES);
          if (videoBytes) {
            blueskyVideo = { bytes: videoBytes, mimeType: syndicationMedia.mimeType, alt: mediaAlt };
          }
        }

        // Always prepare a link card for audio/video so Bluesky still posts when native
        // upload fails (MOV, Worker timeout, or createRecord rejecting the video embed).
        let blueskyLinkCard = null;
        if (isLinkOnlyThinkingMedia(mediaType)) {
          blueskyLinkCard = thinkingBlueskyLinkCard(postUrl, text, mediaType);
        } else if (!blueskyImages && [...text].length > 300) {
          const urlMatch = text.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            const extractedUrl = urlMatch[0].replace(/[.,;:!?)"']+$/, "");
            blueskyLinkCard = await fetchLinkCard(extractedUrl);
          }
          if (!blueskyLinkCard) {
            blueskyLinkCard = {
              uri: postUrl,
              title: text.slice(0, 100).trim(),
              description: text.length > 100 ? text.slice(100, 280).trim() : "",
              thumb: null,
            };
          }
        }

        // Text: link-card fallback for audio (and oversized video); permalink in text when
        // a native image/video embed is present (Bluesky allows only one embed per post).
        const blueskyText =
          isLinkOnlyThinkingMedia(mediaType) && !blueskyVideo
            ? thinkingBlueskySyndicationText(text, postUrl, mediaType)
            : mediaType
              ? thinkingSyndicationTextWithPermalink(text, postUrl)
              : text;

        blueskyUri = await postToBluesky(
          env.BLUESKY_HANDLE,
          env.BLUESKY_APP_PASSWORD,
          blueskyText,
          blueskyImages,
          blueskyLinkCard,
          blueskyVideo
        );
      } catch (bsErr) {
        blueskyWarning = formatServiceWarning("Bluesky", bsErr.message);
      }
    }

    let mastodonUrl = null;
    let mastodonWarning = null;
    if (env.MASTODON_ACCESS_TOKEN) {
      const mastodonInstance = (env.MASTODON_INSTANCE || DEFAULT_MASTODON_INSTANCE).replace(/\/$/, "");
      try {
        let mastodonMedia = null;
        let mastodonText;

        if (mediaType === "image" && uploadedPhotos.length) {
          mastodonMedia = uploadedPhotos.map((u) => ({
            bytes: u.bytes,
            mimeType: u.mimeType,
            alt: mediaAlt,
            mediaType: "image",
          }));
          mastodonText = thinkingSyndicationTextWithPermalink(text, postUrl);
        } else if ((mediaType === "audio" || mediaType === "video") && syndicationMedia) {
          const mediaBytes = await getMediaBytesForSyndication(env, syndicationMedia, MAX_MASTODON_MEDIA_BYTES);
          if (mediaBytes) {
            mastodonMedia = { bytes: mediaBytes, mimeType: syndicationMedia.mimeType, alt: mediaAlt, mediaType };
            mastodonText = thinkingSyndicationTextWithPermalink(text, postUrl);
          } else {
            // File too large or unavailable; fall back to link-in-text.
            mastodonText = thinkingLinkSyndicationText(text, postUrl, mediaType);
          }
        } else {
          mastodonText = text;
        }

        mastodonUrl = await postToMastodon(mastodonInstance, env.MASTODON_ACCESS_TOKEN, mastodonText, mastodonMedia);
      } catch (msErr) {
        mastodonWarning = formatServiceWarning("Mastodon", msErr.message);
      }
    }

    const mediaUrlsJson =
      mediaType === "image" && mediaUrls.length > 1 ? JSON.stringify(mediaUrls) : null;
    const contentHtml = renderThinkingContentHtml(
      text,
      mediaUrl,
      mediaAlt,
      mediaType,
      SITE_URL,
      { mediaUrls: mediaType === "image" ? mediaUrls : [] }
    );
    await dbRun(
      db,
      `INSERT INTO thinking_posts (slug, text, media_url, media_alt, media_type, media_urls, content_html, datetime, microblog_url, bluesky_uri, mastodon_uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         text = excluded.text,
         media_url = excluded.media_url,
         media_alt = excluded.media_alt,
         media_type = excluded.media_type,
         media_urls = excluded.media_urls,
         content_html = excluded.content_html,
         microblog_url = COALESCE(excluded.microblog_url, thinking_posts.microblog_url),
         bluesky_uri = COALESCE(excluded.bluesky_uri, thinking_posts.bluesky_uri),
         mastodon_uri = COALESCE(excluded.mastodon_uri, thinking_posts.mastodon_uri),
         datetime = excluded.datetime`,
      slug,
      text,
      mediaUrl,
      mediaAlt,
      mediaType || null,
      mediaUrlsJson,
      contentHtml,
      nowIso,
      microblogUrl,
      blueskyUri,
      mastodonUrl,
      nowIso
    );

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Thinking", triggerRebuild);

    return json(
      {
        ok: true,
        text,
        mediaUrl,
        mediaUrls: mediaUrls.length ? mediaUrls : undefined,
        microblogWarning,
        blueskyWarning,
        blueskyCompressed,
        mastodonWarning,
      },
      200,
      cors
    );
  } catch (err) {
    return json({ error: formatServiceError("rommy.blog", err.message) }, 500, cors);
  }
}

async function handleListThinking(db, cors) {
  const { results: rows } = await dbAll(
    db,
    `SELECT slug, text, content_html, media_type, datetime, microblog_url
     FROM thinking_posts
     ORDER BY datetime DESC
     LIMIT 50`
  );
  const items = (rows || []).map((row) => ({
    slug: row.slug,
    datetime: row.datetime,
    label: thinkingArchiveLabel(row),
    microblog_url: row.microblog_url || "",
  }));
  return json({ ok: true, items }, 200, cors);
}

function thinkingArchiveLabel(row) {
  const text = (row.text || "").trim();
  if (text) return text;
  if (row.media_type === "audio") return "Audio note";
  if (row.media_type === "video") return "Video note";
  const plain = String(row.content_html || "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain || row.slug;
}

function formatServiceError(service, message) {
  const msg = message || "Something went wrong.";
  if (msg.startsWith(`${service}:`) || msg.startsWith(`${service} —`)) return msg;
  return `${service}: ${msg}`;
}

function formatServiceWarning(service, message) {
  const msg = message || "Post failed.";
  if (msg.startsWith(`${service}:`) || msg.startsWith(`${service} —`)) return msg;
  return `${service}: ${msg}`;
}

async function prepareBlueskyImage(image, compressedFile = null) {
  if (compressedFile) {
    const bytes = await compressedFile.arrayBuffer();
    const mimeType = compressedFile.type || "image/jpeg";
    return {
      image: {
        bytes,
        mimeType,
        alt: image.alt,
        aspectRatio: await imageAspectRatio(bytes, mimeType),
      },
      compressed: true,
    };
  }

  if (image.bytes.byteLength <= MAX_BLUESKY_IMAGE_BYTES) {
    return { image, compressed: false };
  }

  try {
    const compressed = await compressImageForBluesky(image.bytes, image.mimeType);
    return { image: { ...image, ...compressed }, compressed: true };
  } catch {
    throw new Error(
      "Photo is over Bluesky’s 2 MB limit and could not be compressed. rommy.blog and micro.blog were still updated."
    );
  }
}

async function compressImageUnderByteLimit(bytes, mimeType, maxBytes) {
  if (bytes.byteLength <= maxBytes) {
    return {
      bytes,
      mimeType,
      aspectRatio: await imageAspectRatio(bytes, mimeType),
      compressed: false,
    };
  }

  if (mimeType === "image/gif") {
    throw new Error("GIF must be 5 MB or smaller.");
  }

  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("Photo processing is unavailable in this environment.");
  }

  const blob = new Blob([bytes], { type: mimeType });
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("Could not process this photo. Try exporting as JPEG and uploading again.");
  }

  try {
    let w = bitmap.width;
    let h = bitmap.height;
    const qualities = [0.92, 0.85, 0.78, 0.72, 0.65, 0.58, 0.5, 0.42];

    while (w >= 1 && h >= 1) {
      for (const quality of qualities) {
        const out = await encodeJpegFromBitmap(bitmap, w, h, quality);
        if (out.byteLength <= maxBytes) {
          return {
            bytes: out,
            mimeType: "image/jpeg",
            aspectRatio: { width: w, height: h },
            compressed: true,
          };
        }
      }
      if (w === 1 && h === 1) break;
      w = Math.max(1, Math.round(w * 0.9));
      h = Math.max(1, Math.round(h * 0.9));
    }

    throw new Error("Could not compress photo under 5 MB.");
  } finally {
    bitmap.close();
  }
}

async function compressImageForBluesky(bytes, mimeType) {
  // Canvas re-encoding would flatten an animated GIF to a static frame; fail
  // instead so the caller falls back to skipping the Bluesky image cleanly.
  if (mimeType === "image/gif") {
    throw new Error("GIF is too large for Bluesky.");
  }
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas unavailable");
  }

  const blob = new Blob([bytes], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    const maxDim = 2000;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }

    const dimScales = [1, 0.85, 0.7, 0.55];
    const qualities = [0.82, 0.72, 0.62, 0.52, 0.42];

    for (const dimScale of dimScales) {
      const cw = Math.max(1, Math.round(w * dimScale));
      const ch = Math.max(1, Math.round(h * dimScale));
      for (const quality of qualities) {
        const out = await encodeJpegFromBitmap(bitmap, cw, ch, quality);
        if (out.byteLength <= MAX_BLUESKY_IMAGE_BYTES) {
          return {
            bytes: out,
            mimeType: "image/jpeg",
            aspectRatio: { width: cw, height: ch },
          };
        }
      }
    }
    throw new Error("Could not compress under 2 MB");
  } finally {
    bitmap.close();
  }
}

async function encodeJpegFromBitmap(bitmap, width, height, quality) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return outBlob.arrayBuffer();
}

function syndicationPhotoFromUpload(uploaded) {
  const ext = IMAGE_EXT[uploaded.mimeType] || "jpg";
  return new File([uploaded.bytes], `photo.${ext}`, { type: uploaded.mimeType });
}

/**
 * Returns bytes for a media file that was already uploaded to R2.
 * If `uploaded.bytes` is already in memory, returns those directly.
 * Otherwise fetches from R2 (only if size is within `maxBytes`).
 * Returns null if bytes aren't available or the file is too large.
 */
async function getMediaBytesForSyndication(env, uploaded, maxBytes) {
  if (uploaded.bytes) {
    const len = uploaded.bytes.byteLength ?? uploaded.bytes.length ?? 0;
    return len <= maxBytes ? uploaded.bytes : null;
  }
  if (!uploaded.key || !env.MEDIA) return null;
  const size = uploaded.size || 0;
  if (size > maxBytes) return null;
  try {
    const obj = await env.MEDIA.get(uploaded.key);
    if (!obj) return null;
    return obj.arrayBuffer();
  } catch {
    return null;
  }
}

function blueskyImageError(byteLength, status, body) {
  if (byteLength > MAX_BLUESKY_IMAGE_BYTES) {
    return "Photo is still over the 2 MB limit after compression. rommy.blog and micro.blog were still updated.";
  }
  const lower = String(body).toLowerCase();
  if (
    lower.includes("too large") ||
    lower.includes("maximum") ||
    lower.includes("maxsize") ||
    lower.includes("blob size")
  ) {
    return "Photo is too large (Bluesky max is 2 MB). rommy.blog and micro.blog were still updated.";
  }
  const detail = summarizeApiBody(body);
  return detail
    ? `Could not upload the photo (${status}: ${detail}). rommy.blog and micro.blog were still updated.`
    : `Could not upload the photo (HTTP ${status}). rommy.blog and micro.blog were still updated.`;
}

function summarizeApiBody(body) {
  try {
    const j = JSON.parse(body);
    return j.message || j.error || j.error_description || "";
  } catch {
    const t = String(body).trim();
    return t.length > 120 ? t.slice(0, 117) + "…" : t;
  }
}

async function handleUploadMedia(payload, cors, env) {
  const photo = payload.photo || null;
  if (!photo) {
    return json({ error: "Missing photo" }, 400, cors);
  }
  const folder = payload.folder === "thinking" ? "thinking" : "writing";
  try {
    const uploaded = await uploadPhotoToR2(env, photo, folder);
    return json({ ok: true, url: uploaded.url }, 200, cors);
  } catch (err) {
    return json({ error: formatServiceError("rommy.blog", err.message) }, 500, cors);
  }
}

async function uploadPhotoToR2(env, file, folder = "writing") {
  if (!env.MEDIA) {
    throw new Error("Photo storage is not configured (R2).");
  }
  const publicBase = (env.MEDIA_PUBLIC_URL || "").replace(/\/$/, "");
  if (!publicBase) {
    throw new Error("Photo storage is missing a public URL (MEDIA_PUBLIC_URL).");
  }

  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("Photo must be JPEG, PNG, WebP, or GIF.");
  }
  if (file.size > MAX_PHOTO_INPUT_BYTES) {
    throw new Error("Photo must be 25 MB or smaller.");
  }

  const rawBytes = await file.arrayBuffer();
  const processed = await compressImageUnderByteLimit(rawBytes, mimeType, MAX_IMAGE_BYTES);
  const bytes = processed.bytes;
  const outMime = processed.mimeType;
  const aspectRatio = processed.aspectRatio;

  const ext = IMAGE_EXT[outMime] || "jpg";
  const prefix = folder === "thinking" ? "thinking" : "writing";
  const key = `${prefix}/${toDateStr(new Date())}/${crypto.randomUUID()}.${ext}`;

  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: outMime },
  });

  return {
    url: `${publicBase}/${key}`,
    bytes,
    mimeType: outMime,
    aspectRatio,
  };
}

function resolveAudioMime(file) {
  const type = (file.type || "").toLowerCase().split(";")[0].trim();
  if (type && ALLOWED_AUDIO_TYPES.has(type)) return type;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".aac")) return "audio/mp4";
  return type || "";
}

async function uploadAudioToR2(env, file) {
  if (!env.MEDIA) {
    throw new Error("Audio storage is not configured (R2).");
  }
  const publicBase = (env.MEDIA_PUBLIC_URL || "").replace(/\/$/, "");
  if (!publicBase) {
    throw new Error("Audio storage is missing a public URL (MEDIA_PUBLIC_URL).");
  }

  const mimeType = resolveAudioMime(file);
  if (!mimeType || !ALLOWED_AUDIO_TYPES.has(mimeType)) {
    throw new Error("Audio must be M4A (Voice Memos) or MP3.");
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("Audio must be 25 MB or smaller.");
  }

  const bytes = await file.arrayBuffer();
  const ext = AUDIO_EXT[mimeType] || "m4a";
  const key = `thinking/audio/${toDateStr(new Date())}/${crypto.randomUUID()}.${ext}`;

  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
  });

  return {
    url: `${publicBase}/${key}`,
    bytes,
    mimeType,
    key,
  };
}

function resolveVideoMime(file) {
  const type = (file.type || "").toLowerCase().split(";")[0].trim();
  if (type && ALLOWED_VIDEO_TYPES.has(type)) return type;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".m4v")) return "video/x-m4v";
  return type || "";
}

function resolveVideoMimeFromMeta(mimeType, fileName) {
  const type = (mimeType || "").toLowerCase().split(";")[0].trim();
  if (type && ALLOWED_VIDEO_TYPES.has(type)) return type;
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".m4v")) return "video/x-m4v";
  return type || "";
}

function isValidThinkingVideoKey(key) {
  return /^thinking\/video\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(mp4|mov|m4v)$/i.test(
    key
  );
}

function r2PresignConfigured(env) {
  return !!(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.MEDIA
  );
}

async function handleThinkingVideoUploadUrl(payload, cors, env) {
  if (!r2PresignConfigured(env)) {
    return json({ error: "Direct video upload is not configured." }, 503, cors);
  }

  const mimeType = resolveVideoMimeFromMeta(payload.mimeType, payload.fileName);
  const size = Number(payload.size);

  if (!mimeType || !ALLOWED_VIDEO_TYPES.has(mimeType)) {
    return json({ error: "Video must be MP4 or MOV (iPhone)." }, 400, cors);
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    return json({ error: "Video must be 100 MB or smaller." }, 400, cors);
  }

  const bucket = env.R2_BUCKET_NAME || "rommy-blog-media";
  const publicBase = (env.MEDIA_PUBLIC_URL || "").replace(/\/$/, "");
  if (!publicBase) {
    return json({ error: "Video storage is missing a public URL (MEDIA_PUBLIC_URL)." }, 500, cors);
  }

  const ext = VIDEO_EXT[mimeType] || "mp4";
  const key = `thinking/video/${toDateStr(new Date())}/${crypto.randomUUID()}.${ext}`;
  const posterKey = thinkingVideoPosterKey(key);

  let uploadUrl;
  let posterUploadUrl;
  try {
    uploadUrl = await createR2PresignedPutUrl({
      accountId: env.R2_ACCOUNT_ID,
      bucket,
      key,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      mimeType,
    });
    posterUploadUrl = await createR2PresignedPutUrl({
      accountId: env.R2_ACCOUNT_ID,
      bucket,
      key: posterKey,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      mimeType: "image/jpeg",
    });
  } catch (err) {
    return json(
      { error: err.message || "Could not create upload URL." },
      500,
      cors
    );
  }

  return json(
    {
      ok: true,
      uploadUrl,
      posterUploadUrl,
      key,
      posterKey,
      mediaUrl: `${publicBase}/${key}`,
      mimeType,
    },
    200,
    cors
  );
}

async function finalizeVideoFromR2(env, key, expectedMime) {
  if (!env.MEDIA) {
    throw new Error("Video storage is not configured (R2).");
  }
  const publicBase = (env.MEDIA_PUBLIC_URL || "").replace(/\/$/, "");
  if (!publicBase) {
    throw new Error("Video storage is missing a public URL (MEDIA_PUBLIC_URL).");
  }
  if (!isValidThinkingVideoKey(key)) {
    throw new Error("Invalid video upload.");
  }

  const head = await env.MEDIA.head(key);
  if (!head) {
    throw new Error("Video upload not found. Try uploading again.");
  }
  if (head.size > MAX_VIDEO_BYTES) {
    throw new Error("Video must be 100 MB or smaller.");
  }

  const mimeType =
    resolveVideoMimeFromMeta(expectedMime, key) ||
    (head.httpMetadata?.contentType || "").toLowerCase().split(";")[0].trim();
  if (!mimeType || !ALLOWED_VIDEO_TYPES.has(mimeType)) {
    throw new Error("Video must be MP4 or MOV (iPhone).");
  }

  return {
    url: `${publicBase}/${key}`,
    bytes: null,
    mimeType,
    key,
    size: head.size,
  };
}

async function uploadVideoToR2(env, file) {
  if (!env.MEDIA) {
    throw new Error("Video storage is not configured (R2).");
  }
  const publicBase = (env.MEDIA_PUBLIC_URL || "").replace(/\/$/, "");
  if (!publicBase) {
    throw new Error("Video storage is missing a public URL (MEDIA_PUBLIC_URL).");
  }

  const mimeType = resolveVideoMime(file);
  if (!mimeType || !ALLOWED_VIDEO_TYPES.has(mimeType)) {
    throw new Error("Video must be MP4 or MOV (iPhone).");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("Video must be 100 MB or smaller.");
  }

  const bytes = await file.arrayBuffer();
  const ext = VIDEO_EXT[mimeType] || "mp4";
  const key = `thinking/video/${toDateStr(new Date())}/${crypto.randomUUID()}.${ext}`;

  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
  });

  return {
    url: `${publicBase}/${key}`,
    bytes,
    mimeType,
    key,
  };
}

async function imageAspectRatio(bytes, mimeType) {
  try {
    const blob = new Blob([bytes], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const ratio = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return ratio;
  } catch {
    return { width: 1, height: 1 };
  }
}

async function postToMicroblog(token, content, photoFiles = null, audioUrl = null, videoUrl = null) {
  const photos = Array.isArray(photoFiles)
    ? photoFiles.filter(Boolean)
    : photoFiles
      ? [photoFiles]
      : [];

  if (photos.length) {
    const fd = new FormData();
    fd.append("h", "entry");
    if (content) fd.append("content", content);
    for (let i = 0; i < photos.length; i++) {
      const photoFile = photos[i];
      const mimeType = photoFile.type || "image/jpeg";
      const bytes = await photoFile.arrayBuffer();
      fd.append(
        "photo[]",
        new Blob([bytes], { type: mimeType }),
        `photo${i + 1}.${IMAGE_EXT[mimeType] || "jpg"}`
      );
    }

    const res = await fetch("https://micro.blog/micropub", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `micropub request failed (${res.status})${summarizeApiBody(err) ? ": " + summarizeApiBody(err) : ""}`
      );
    }
    return micropubPostUrl(res);
  }

  // Pass hosted audio or video URL via Micropub properties so micro.blog
  // renders a native player in the feed rather than a plain link.
  if (audioUrl || videoUrl) {
    const fd = new FormData();
    fd.append("h", "entry");
    if (content) fd.append("content", content);
    if (audioUrl) fd.append("audio[]", audioUrl);
    if (videoUrl) fd.append("video[]", videoUrl);
    const res = await fetch("https://micro.blog/micropub", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `micropub request failed (${res.status})${summarizeApiBody(err) ? ": " + summarizeApiBody(err) : ""}`
      );
    }
    return micropubPostUrl(res);
  }

  const res = await fetch("https://micro.blog/micropub", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ h: "entry", content }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `micropub request failed (${res.status})${summarizeApiBody(err) ? ": " + summarizeApiBody(err) : ""}`
    );
  }
  return micropubPostUrl(res);
}

function micropubPostUrl(res) {
  const location = res.headers.get("Location");
  if (location) return location;
  return null;
}

async function blueskySession(handle, appPassword) {
  const sessionRes = await fetch(
    "https://bsky.social/xrpc/com.atproto.server.createSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    }
  );
  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    const detail = summarizeApiBody(err);
    throw new Error(
      detail ? `Sign-in failed (${sessionRes.status}: ${detail})` : `Sign-in failed (HTTP ${sessionRes.status}).`
    );
  }
  return sessionRes.json();
}

/**
 * Bluesky's video-processing service needs a service-auth token whose `aud` is the
 * account's actual PDS DID (not video.bsky.app). Resolve it from the DID document,
 * falling back to bsky.social — the host the rest of this file already talks to.
 */
async function resolveBlueskyPdsAud(did) {
  try {
    if (typeof did === "string" && did.startsWith("did:plc:")) {
      const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
      if (res.ok) {
        const doc = await res.json();
        const pds = Array.isArray(doc.service)
          ? doc.service.find((s) => s.id === "#atproto_pds")
          : null;
        if (pds?.serviceEndpoint) {
          const host = new URL(pds.serviceEndpoint).host;
          if (host) return `did:web:${host}`;
        }
      }
    }
  } catch {}
  return "did:web:bsky.social";
}

async function blueskyServiceAuthToken(accessJwt, aud, lxm, ttlSec = 1800) {
  const url = new URL("https://bsky.social/xrpc/com.atproto.server.getServiceAuth");
  url.searchParams.set("aud", aud);
  url.searchParams.set("lxm", lxm);
  url.searchParams.set("exp", String(Math.floor(Date.now() / 1000) + ttlSec));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessJwt}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bluesky service auth failed (${summarizeApiBody(err) || res.status})`);
  }
  const { token } = await res.json();
  return token;
}

async function blueskyUploadVideoToService(serviceToken, did, mimeType, bytes, fileName) {
  const uploadUrl = new URL("https://video.bsky.app/xrpc/app.bsky.video.uploadVideo");
  uploadUrl.searchParams.set("did", did);
  uploadUrl.searchParams.set("name", fileName);
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": mimeType,
    },
    body: bytes,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok && !data?.blob) {
    throw new Error(data?.message || `Bluesky video upload failed (HTTP ${res.status}).`);
  }
  return data;
}

async function blueskyPollVideoJob(jobId, deadlineMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const res = await fetch(
        `https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`
      );
      const data = await res.json().catch(() => null);
      const status = data?.jobStatus;
      if (status?.blob) return status.blob;
      if (status?.state === "JOB_STATE_FAILED") return null;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

async function fetchLinkCard(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const reader = res.body.getReader();
    let html = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (bytes < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.length;
      if (html.includes("</head>")) break;
    }
    reader.cancel();

    const ogProp = (prop) => {
      const m =
        html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
      return m ? m[1] : "";
    };
    const title =
      ogProp("title") || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "");
    const description = ogProp("description");
    const thumb = ogProp("image");

    const decode = (s) =>
      s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

    return { uri: url, title: decode(title), description: decode(description), thumb };
  } catch {
    return null;
  }
}

async function postToBluesky(handle, appPassword, content, image = null, linkCard = null, video = null) {
  const { accessJwt, did } = await blueskySession(handle, appPassword);

  const LINK_URL = `${SITE_URL}/thinking/`;
  const MAX = 300;
  const graphemes = [...content];
  let text = content;
  let facets = [];

  if (graphemes.length > MAX) {
    const suffix = `\u2026 ${LINK_URL}`;
    const maxContent = MAX - [...suffix].length;
    const truncated = graphemes.slice(0, maxContent).join("");
    text = truncated + suffix;
    const enc = new TextEncoder();
    const byteStart = enc.encode(truncated + "\u2026 ").length;
    const byteEnd = byteStart + enc.encode(LINK_URL).length;
    facets.push({
      $type: "app.bsky.richtext.facet",
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: LINK_URL }],
    });
  }

  const enc = new TextEncoder();
  const urlRe = /https?:\/\/[^\s\u2026]+/g;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?)"']+$/, "");
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(url).length;
    const already = facets.some((f) => f.index.byteStart === byteStart);
    if (!already) {
      facets.push({
        $type: "app.bsky.richtext.facet",
        index: { byteStart, byteEnd },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
      });
    }
  }

  addHashtagFacets(text, facets, enc);

  const images = Array.isArray(image) ? image.filter(Boolean) : image ? [image] : [];

  let embed;
  if (images.length) {
    const embedImages = [];
    for (const img of images.slice(0, MAX_THINKING_PHOTOS)) {
      const byteLength = img.bytes?.byteLength ?? 0;
      const blobRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessJwt}`,
          "Content-Type": img.mimeType,
        },
        body: img.bytes,
      });
      if (!blobRes.ok) {
        const err = await blobRes.text();
        throw new Error(blueskyImageError(byteLength, blobRes.status, err));
      }
      const { blob } = await blobRes.json();
      embedImages.push({
        alt: img.alt || "",
        image: blob,
        aspectRatio: img.aspectRatio,
      });
    }
    embed = {
      $type: "app.bsky.embed.images",
      images: embedImages,
    };
  } else if (video) {
    embed = await blueskyVideoEmbed(accessJwt, video, did);
  }

  if (!embed && linkCard) {
    embed = await blueskyExternalEmbed(accessJwt, linkCard);
  }

  let created;
  try {
    created = await blueskyCreatePost(accessJwt, did, text, facets, embed);
  } catch (err) {
    // Native video embed can fail at createRecord (e.g. unprocessed blob). Retry link card.
    if (video && linkCard && embed?.$type === "app.bsky.embed.video") {
      const fallbackEmbed = await blueskyExternalEmbed(accessJwt, linkCard);
      created = await blueskyCreatePost(accessJwt, did, text, facets, fallbackEmbed);
    } else {
      throw err;
    }
  }
  return created.uri || null;
}

/**
 * Uploads video through Bluesky's dedicated video-processing service, which accepts
 * MP4 and MOV (QuickTime) directly and transcodes server-side. This is what lets
 * iPhone MOV videos play natively inline instead of falling back to a link card.
 */
async function blueskyVideoEmbed(accessJwt, video, did) {
  try {
    const aud = await resolveBlueskyPdsAud(did);
    const serviceToken = await blueskyServiceAuthToken(
      accessJwt,
      aud,
      "com.atproto.repo.uploadBlob"
    );
    const ext = VIDEO_EXT[video.mimeType] || "mp4";
    const initial = await blueskyUploadVideoToService(
      serviceToken,
      did,
      video.mimeType,
      video.bytes,
      `thinking.${ext}`
    );
    const blob = initial?.blob || (initial?.jobId ? await blueskyPollVideoJob(initial.jobId) : null);
    if (!blob) return null;
    return {
      $type: "app.bsky.embed.video",
      video: blob,
      alt: video.alt || "",
    };
  } catch {
    return null;
  }
}

async function blueskyExternalEmbed(accessJwt, linkCard) {
  let thumb = null;
  if (linkCard.thumb) {
    try {
      const thumbRes = await fetch(linkCard.thumb);
      if (thumbRes.ok) {
        const thumbBytes = await thumbRes.arrayBuffer();
        const thumbMime = (thumbRes.headers.get("content-type") || "image/jpeg").split(";")[0];
        const blobRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessJwt}`, "Content-Type": thumbMime },
          body: thumbBytes,
        });
        if (blobRes.ok) ({ blob: thumb } = await blobRes.json());
      }
    } catch {}
  }
  return {
    $type: "app.bsky.embed.external",
    external: {
      uri: linkCard.uri,
      title: linkCard.title,
      description: linkCard.description,
      ...(thumb ? { thumb } : {}),
    },
  };
}

async function blueskyCreatePost(accessJwt, did, text, facets, embed) {
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    ...(embed ? { embed } : {}),
    ...(facets.length ? { facets } : {}),
  };

  const postRes = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record }),
    }
  );
  if (!postRes.ok) {
    const err = await postRes.text();
    const detail = summarizeApiBody(err);
    throw new Error(
      detail
        ? `Post failed (${postRes.status}: ${detail})`
        : `Post failed (HTTP ${postRes.status}).`
    );
  }
  return postRes.json();
}

async function syndicateText(env, content, linkUrl = null) {
  let microblogWarning = null;
  let blueskyWarning = null;
  let mastodonWarning = null;

  const linkCard = linkUrl ? await fetchLinkCard(linkUrl) : null;

  if (env.MICROBLOG_TOKEN) {
    try {
      await postToMicroblog(env.MICROBLOG_TOKEN, content);
    } catch (mbErr) {
      microblogWarning = formatServiceWarning("micro.blog", mbErr.message);
    }
  }

  if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
    try {
      await postToBluesky(env.BLUESKY_HANDLE, env.BLUESKY_APP_PASSWORD, content, null, linkCard);
    } catch (bsErr) {
      blueskyWarning = formatServiceWarning("Bluesky", bsErr.message);
    }
  }

  if (env.MASTODON_ACCESS_TOKEN) {
    const mastodonInstance = (env.MASTODON_INSTANCE || DEFAULT_MASTODON_INSTANCE).replace(/\/$/, "");
    try {
      await postToMastodon(mastodonInstance, env.MASTODON_ACCESS_TOKEN, content);
    } catch (msErr) {
      mastodonWarning = formatServiceWarning("Mastodon", msErr.message);
    }
  }

  return { microblogWarning, blueskyWarning, mastodonWarning };
}

async function deleteFromMicroblog(token, url) {
  const res = await fetch("https://micro.blog/micropub", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ action: "delete", url }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `micropub delete failed (${res.status})${summarizeApiBody(err) ? ": " + summarizeApiBody(err) : ""}`
    );
  }
}

async function deleteFromBluesky(handle, appPassword, uri) {
  const { accessJwt } = await blueskySession(handle, appPassword);
  const match = String(uri).match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error("Invalid Bluesky URI");
  }
  const [, repo, collection, rkey] = match;
  const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.deleteRecord", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo, collection, rkey }),
  });
  if (!res.ok) {
    const err = await res.text();
    const detail = summarizeApiBody(err);
    throw new Error(
      detail
        ? `Bluesky delete failed (${res.status}: ${detail})`
        : `Bluesky delete failed (HTTP ${res.status}).`
    );
  }
}

/**
 * Post a status to Mastodon, optionally attaching media file(s).
 * `media` may be a single { bytes, mimeType, alt, mediaType } or an array (images, max 4).
 */
async function postToMastodon(instanceUrl, accessToken, content, media = null) {
  const mediaItems = Array.isArray(media) ? media.filter(Boolean) : media ? [media] : [];
  const mediaIds = [];

  for (const item of mediaItems.slice(0, MAX_THINKING_PHOTOS)) {
    if (!item.bytes) continue;
    const mt = item.mediaType || "image";
    const ext =
      mt === "audio" ? (AUDIO_EXT[item.mimeType] || "m4a") :
      mt === "video" ? (VIDEO_EXT[item.mimeType] || "mp4") :
      (IMAGE_EXT[item.mimeType] || "jpg");
    const fd = new FormData();
    fd.append("file", new Blob([item.bytes], { type: item.mimeType }), `media.${ext}`);
    if (item.alt) fd.append("description", item.alt.slice(0, 1500));
    const mediaRes = await fetch(`${instanceUrl}/api/v1/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: fd,
    });
    if (!mediaRes.ok) {
      const err = await mediaRes.text();
      throw new Error(
        `Media upload failed (${mediaRes.status})${summarizeApiBody(err) ? ": " + summarizeApiBody(err) : ""}`
      );
    }
    const mediaData = await mediaRes.json();
    const mediaId = mediaData.id;

    // Mastodon returns 202 for video/audio uploads that require async transcoding.
    // Poll GET /api/v1/media/:id until `url` is non-null before posting the status,
    // otherwise the status API returns 422 "Media not processed".
    if (mediaRes.status === 202) {
      const POLL_INTERVAL_MS = 2000;
      const POLL_TIMEOUT_MS = 25000;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let ready = !!mediaData.url;
      while (!ready && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(`${instanceUrl}/api/v1/media/${encodeURIComponent(mediaId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          ready = !!pollData.url;
        }
      }
      if (!ready) {
        throw new Error("Media processing timed out — video was not ready in time.");
      }
    }
    mediaIds.push(mediaId);
  }

  const chars = [...content];
  let status = content;
  if (chars.length > MAX_MASTODON_CHARS) {
    const suffix = `… ${SITE_URL}/thinking/`;
    const maxContent = MAX_MASTODON_CHARS - [...suffix].length;
    status = chars.slice(0, maxContent).join("") + suffix;
  }

  const body = { status };
  if (mediaIds.length) body.media_ids = mediaIds;

  const res = await fetch(`${instanceUrl}/api/v1/statuses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    const detail = summarizeApiBody(err);
    throw new Error(
      detail ? `Post failed (${res.status}: ${detail})` : `Post failed (HTTP ${res.status}).`
    );
  }
  const created = await res.json();
  return created.url || null;
}

async function deleteFromMastodon(instanceUrl, accessToken, statusUrl) {
  // Extract the numeric status ID from the URL (last path segment)
  const statusId = statusUrl.split("/").filter(Boolean).pop();
  const res = await fetch(`${instanceUrl}/api/v1/statuses/${encodeURIComponent(statusId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    const detail = summarizeApiBody(err);
    throw new Error(
      detail ? `Delete failed (${res.status}: ${detail})` : `Delete failed (HTTP ${res.status}).`
    );
  }
}

async function handleDeleteThinking(payload, db, cors, env, ctx) {
  const rawSlug = payload.slug;
  if (typeof rawSlug !== "string" || !rawSlug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }
  const slug = rawSlug.trim().replace(/[^0-9-]/g, "");
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(slug)) {
    return json({ error: "Invalid slug" }, 400, cors);
  }

  const microblogUrl =
    typeof payload.microblog_url === "string" ? payload.microblog_url.trim() : "";

  try {
    const row = await dbFirst(
      db,
      "SELECT microblog_url, bluesky_uri, mastodon_uri FROM thinking_posts WHERE slug = ?",
      slug
    );
    if (!row) {
      return json({ error: "Post not found" }, 404, cors);
    }
    const mbUrl = microblogUrl || row.microblog_url || null;
    const blueskyUri = row.bluesky_uri || null;
    const mastodonUri = row.mastodon_uri || null;

    let microblogWarning = null;
    if (env.MICROBLOG_TOKEN && mbUrl) {
      try {
        await deleteFromMicroblog(env.MICROBLOG_TOKEN, mbUrl);
      } catch (mbErr) {
        microblogWarning = formatServiceWarning("micro.blog", mbErr.message);
      }
    } else if (env.MICROBLOG_TOKEN && !mbUrl) {
      microblogWarning = formatServiceWarning(
        "micro.blog",
        "No Micro.blog URL for this post — archive may still list it until the feed updates."
      );
    }

    let blueskyWarning = null;
    let blueskyDeleted = false;
    let blueskySkipped = false;
    if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
      if (blueskyUri) {
        try {
          await deleteFromBluesky(env.BLUESKY_HANDLE, env.BLUESKY_APP_PASSWORD, blueskyUri);
          blueskyDeleted = true;
        } catch (bsErr) {
          blueskyWarning = formatServiceWarning("Bluesky", bsErr.message);
        }
      } else {
        blueskySkipped = true;
      }
    }

    let mastodonWarning = null;
    let mastodonDeleted = false;
    if (env.MASTODON_ACCESS_TOKEN) {
      const mastodonInstance = (env.MASTODON_INSTANCE || DEFAULT_MASTODON_INSTANCE).replace(/\/$/, "");
      if (mastodonUri) {
        try {
          await deleteFromMastodon(mastodonInstance, env.MASTODON_ACCESS_TOKEN, mastodonUri);
          mastodonDeleted = true;
        } catch (msErr) {
          mastodonWarning = formatServiceWarning("Mastodon", msErr.message);
        }
      }
    }

    await dbRun(db, "DELETE FROM thinking_posts WHERE slug = ?", slug);

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Thinking", triggerRebuild);

    return json(
      {
        ok: true,
        microblogWarning,
        blueskyWarning,
        blueskyDeleted,
        blueskySkipped,
        mastodonWarning,
        mastodonDeleted,
      },
      200,
      cors
    );
  } catch (err) {
    return json({ error: err.message || "Delete failed" }, 500, cors);
  }
}

// ─── New Post ─────────────────────────────────────────────────────────────────

async function handlePost(body, db, cors, env, ctx) {
  const { title, summary } = body;
  const rawBody = typeof body.body === "string" ? body.body.trim() : null;
  const paragraphs = Array.isArray(body.paragraphs) ? body.paragraphs : null;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof summary !== "string" || !summary.trim()) {
    return json({ error: "Missing summary" }, 400, cors);
  }
  if (!rawBody && !paragraphs) {
    return json({ error: "Missing body" }, 400, cors);
  }

  const cleanTitle = title.trim();
  const cleanSummary = summary.trim();
  const slug = toSlug(cleanTitle);
  const now = new Date();
  const dateStr = toDateStr(now);
  const datetimeStr = now.toISOString();

  let bodyHtml;
  if (rawBody) {
    bodyHtml = cleanBodyHtml(rawBody);
  } else {
    const cleanParas = paragraphs.map((p) => String(p).trim()).filter(Boolean);
    bodyHtml = cleanParas.map((p) => `<p>${escHtml(p)}</p>`).join("");
  }

  try {
    const existing = await dbFirst(db, "SELECT slug FROM posts WHERE slug = ?", slug);
    if (existing) {
      return json({ error: `A post with slug "${slug}" already exists` }, 409, cors);
    }

    await dbRun(
      db,
      `INSERT INTO posts (slug, title, summary, body_html, date, datetime, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      slug,
      cleanTitle,
      cleanSummary,
      bodyHtml,
      dateStr,
      datetimeStr,
      datetimeStr,
      datetimeStr
    );

    await savePostVersion(db, slug, cleanTitle, cleanSummary, bodyHtml);

    // Clear draft if publishing from one
    if (body.draftId) {
      await dbRun(db, "DELETE FROM drafts WHERE id = ?", body.draftId);
    }

    const postUrl = `${SITE_URL}/posts/${slug}/`;
    const { microblogWarning, blueskyWarning, mastodonWarning } = await syndicateText(
      env,
      `New post: ${cleanTitle}\n\n${postUrl}`,
      postUrl
    );

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Writing", triggerRebuild);

    return json({ ok: true, slug, url: postUrl, microblogWarning, blueskyWarning, mastodonWarning }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Post creation failed" }, 500, cors);
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────

async function handleReading(body, db, cors, env, ctx) {
  const { title, url, ym, cover_url, author } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof url !== "string" || !url.trim()) {
    return json({ error: "Missing url" }, 400, cors);
  }

  const now = new Date();
  const month =
    typeof ym === "string" && /^\d{4}-\d{2}$/.test(ym.trim())
      ? ym.trim()
      : now.toISOString().slice(0, 7);

  const entry = {
    ym: month,
    title: title.trim(),
    url: url.trim(),
    coverUrl: typeof cover_url === "string" && cover_url.trim() ? cover_url.trim() : null,
    author: typeof author === "string" && author.trim() ? author.trim() : null,
  };

  try {
    await dbRun(
      db,
      "INSERT INTO reading (ym, title, url, added_at, cover_url, author) VALUES (?, ?, ?, ?, ?, ?)",
      entry.ym,
      entry.title,
      entry.url,
      now.toISOString(),
      entry.coverUrl,
      entry.author
    );

    const affiliateUrl = bookshopAffiliateUrl(entry.url, env.BOOKSHOP_AFFILIATE_ID);

    const { microblogWarning, blueskyWarning, mastodonWarning } = await syndicateText(
      env,
      `Now reading: ${entry.title}\n\n${affiliateUrl}`,
      affiliateUrl
    );

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Reading", triggerRebuild);
    return json({ ok: true, entry, microblogWarning, blueskyWarning, mastodonWarning }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

async function handleListReading(db, cors) {
  try {
    const { results: rows } = await dbAll(
      db,
      "SELECT id, ym, title, url, added_at, cover_url, author FROM reading ORDER BY ym DESC, added_at DESC, id DESC"
    );
    return json({ ok: true, items: rows || [] }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not list reading entries" }, 500, cors);
  }
}

async function handleDeleteReading(payload, db, cors, env, ctx) {
  const id = payload.id;
  if (!id || typeof id !== "number") {
    return json({ error: "Missing or invalid id" }, 400, cors);
  }

  try {
    const existing = await dbFirst(db, "SELECT id FROM reading WHERE id = ?", id);
    if (!existing) {
      return json({ error: "Reading entry not found" }, 404, cors);
    }

    await dbRun(db, "DELETE FROM reading WHERE id = ?", id);

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Reading", triggerRebuild);

    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Delete failed" }, 500, cors);
  }
}

function normalizeReadingFavoriteUrl(url, env) {
  const trimmed = String(url || "").trim();
  let affiliate = bookshopAffiliateUrl(trimmed, env.BOOKSHOP_AFFILIATE_ID);
  if (affiliate === trimmed && /bookshop\.org/i.test(trimmed)) {
    const isbn = isbnFromBookshopUrl(trimmed);
    if (isbn) {
      affiliate = `https://bookshop.org/a/${env.BOOKSHOP_AFFILIATE_ID || "126485"}/${isbn}`;
    }
  }
  return affiliate;
}

async function handleReadingFavorite(body, db, cors, env, ctx) {
  const { title, url, cover_url, author } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof url !== "string" || !url.trim()) {
    return json({ error: "Missing url" }, 400, cors);
  }

  const now = new Date();
  const entry = {
    title: title.trim(),
    url: normalizeReadingFavoriteUrl(url, env),
    coverUrl: typeof cover_url === "string" && cover_url.trim() ? cover_url.trim() : null,
    author: typeof author === "string" && author.trim() ? author.trim() : null,
  };

  try {
    await dbRun(
      db,
      "INSERT INTO reading_favorites (title, url, cover_url, author, added_at) VALUES (?, ?, ?, ?, ?)",
      entry.title,
      entry.url,
      entry.coverUrl,
      entry.author,
      now.toISOString()
    );

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Reading", triggerRebuild);
    return json({ ok: true, entry }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

async function handleListReadingFavorites(db, cors) {
  try {
    const { results: rows } = await dbAll(
      db,
      "SELECT id, title, url, added_at, cover_url, author FROM reading_favorites ORDER BY title COLLATE NOCASE ASC, id ASC"
    );
    const { results: latestRows } = await dbAll(
      db,
      "SELECT title, url, cover_url FROM reading WHERE cover_url IS NOT NULL AND cover_url != ''"
    );
    const latestCoverLookup = buildLatestCoverLookup(latestRows || [], (entry) => entry.cover_url || null);
    const items = (rows || []).map((row) => {
      const inherited = inheritLatestCover(row, latestCoverLookup);
      return inherited ? { ...row, cover_url: inherited } : row;
    });
    return json({ ok: true, items }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not list reading favorites" }, 500, cors);
  }
}

async function handleDeleteReadingFavorite(payload, db, cors, env, ctx) {
  const id = payload.id;
  if (!id || typeof id !== "number") {
    return json({ error: "Missing or invalid id" }, 400, cors);
  }

  try {
    const existing = await dbFirst(db, "SELECT id FROM reading_favorites WHERE id = ?", id);
    if (!existing) {
      return json({ error: "Favorite not found" }, 404, cors);
    }

    await dbRun(db, "DELETE FROM reading_favorites WHERE id = ?", id);

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Reading", triggerRebuild);

    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Delete failed" }, 500, cors);
  }
}

async function handleUpdateReadingFavoriteCover(payload, db, cors, env) {
  const { id } = payload;
  if (!id || typeof id !== "number") {
    return json({ error: "Missing or invalid id" }, 400, cors);
  }
  const coverUrl =
    typeof payload.cover_url === "string" && payload.cover_url.trim()
      ? payload.cover_url.trim()
      : null;
  const author =
    typeof payload.author === "string" && payload.author.trim() ? payload.author.trim() : null;

  try {
    const existing = await dbFirst(db, "SELECT id FROM reading_favorites WHERE id = ?", id);
    if (!existing) {
      return json({ error: "Favorite not found" }, 404, cors);
    }

    await dbRun(
      db,
      "UPDATE reading_favorites SET cover_url = ?, author = ? WHERE id = ?",
      coverUrl,
      author,
      id
    );
    await triggerRebuild(env);

    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// Book cover candidates: hit Open Library, Apple Books, and Google Books in
// parallel by ISBN (pulled from the Bookshop.org URL's `ean=` param when
// present, else a title search) and return whatever each finds so the admin
// can pick the best one. A plain title search ranks by relevance across
// title+author+etc, so a short/generic title can confidently match a
// completely different, more famous book — only trust a title-search hit if
// its own title basically matches what we searched for.
const normalizeBookTitle = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function bookTitlesMatch(a, b) {
  const na = normalizeBookTitle(a);
  const nb = normalizeBookTitle(b);
  return Boolean(na && nb) && (na === nb || na.includes(nb) || nb.includes(na));
}

// When we know the author, use it as a second check on top of the title
// match — a plain title-only search can still land on a completely
// unrelated book that happens to share the exact same title (e.g. two
// different novels both called "The Murderess"), and the title+author
// combined query only helps when the source actually has *our* book. This
// catches the rest: reject a title match whose own author doesn't overlap
// at all with the one we're looking for.
function bookAuthorsMatch(given, found) {
  if (!given) return true;
  if (!found) return false;
  const words = (s) => normalizeBookTitle(s).split(" ").filter((w) => w.length > 2);
  const givenWords = words(given);
  const foundWords = words(found);
  return givenWords.some((w) => foundWords.includes(w));
}

async function openLibraryCoverCandidate(isbn, title, author) {
  try {
    if (isbn) {
      const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
      if (res.ok) {
        const data = await res.json();
        const coverId = data?.covers?.find((id) => id > 0);
        if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
      }
    }

    // A short/generic title (e.g. "Hill") is much less likely to be
    // swamped by unrelated books once Open Library's distinct title+author
    // fields narrow the search — try that before the plain title-only pass.
    if (author) {
      const res2 = await fetch(
        `https://openlibrary.org/search.json?limit=1&fields=cover_i,title&title=${encodeURIComponent(
          title
        )}&author=${encodeURIComponent(author)}`
      );
      if (res2.ok) {
        const data2 = await res2.json();
        const hit = data2?.docs?.[0];
        if (hit?.cover_i && bookTitlesMatch(title, hit.title)) {
          return `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`;
        }
      }
    }

    const q = isbn ? `isbn:${isbn}` : title;
    const res3 = await fetch(
      `https://openlibrary.org/search.json?limit=1&fields=cover_i,title&q=${encodeURIComponent(q)}`
    );
    if (res3.ok) {
      const data3 = await res3.json();
      const hit = data3?.docs?.[0];
      if (hit?.cover_i && (isbn || bookTitlesMatch(title, hit.title))) {
        return `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`;
      }
    }
  } catch {
    /* ignore — this source just won't offer a candidate */
  }
  return null;
}

// Titles collide across completely unrelated books often enough (e.g. two
// different novels both called "The Murderess") that a title match alone
// doesn't guarantee the right book — so every candidate carries whatever
// author name its source cheaply provides, letting the admin's picker UI
// show it as a sanity check alongside the cover image itself.
async function itunesSearchByTerm(term, title, author) {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?entity=ebook&limit=1&term=${encodeURIComponent(term)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.results?.[0];
    const art = hit?.artworkUrl100;
    if (!art) return null;
    if (!bookTitlesMatch(title, hit.trackName)) return null;
    if (!bookAuthorsMatch(author, hit.artistName)) return null;
    return {
      url: art.replace(/\d+x\d+bb\.(jpg|png)$/, "600x900bb.$1"),
      title: hit.trackName || null,
      author: hit.artistName || null,
    };
  } catch {
    return null;
  }
}

async function itunesTitleSearch(title, author) {
  // Apple's search has no separate author param, so a short/generic title
  // (e.g. "Hill") gets combined into one free-text term with the author —
  // this is exactly what surfaced the correct "Hill" by Jean Giono instead
  // of a page of unrelated "Napoleon Hill" results.
  if (author) {
    const combined = await itunesSearchByTerm(`${title} ${author}`, title, author);
    if (combined) return combined;
  }
  // Plain title-only search carries no author check from Apple's side, so
  // when we do know the author, still require its match here too — this is
  // what keeps a genuine title collision (e.g. two different novels both
  // called "The Murderess") from returning the wrong book.
  return itunesSearchByTerm(title, title, author);
}

async function itunesCoverCandidate(isbn, title, author) {
  if (isbn) {
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?isbn=${isbn}&entity=ebook`);
      if (res.ok) {
        const data = await res.json();
        const hit = data?.results?.[0];
        const art = hit?.artworkUrl100;
        if (art) {
          return {
            url: art.replace(/\d+x\d+bb\.(jpg|png)$/, "600x900bb.$1"),
            title: hit.trackName || null,
            author: hit.artistName || null,
          };
        }
      }
    } catch {
      /* fall through to title search below */
    }
  }
  // Ebook editions almost always carry a different ISBN than the print
  // edition our URL's ISBN came from, so an exact-ISBN miss doesn't mean
  // Apple Books doesn't have it — a title (+ author, if given) search often
  // still finds it.
  return itunesTitleSearch(title, author);
}

async function googleBooksSearchByQuery(q, title, author, apiKey) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.items?.[0];
    const info = hit?.volumeInfo;
    const img = info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail;
    if (!img) return null;
    if (!bookTitlesMatch(title, info?.title)) return null;
    if (!bookAuthorsMatch(author, (info?.authors || []).join(" "))) return null;
    return {
      url: img.replace(/^http:/, "https:").replace(/&zoom=\d/, "&zoom=2"),
      title: info?.title || null,
      author: info?.authors?.[0] || null,
    };
  } catch {
    return null;
  }
}

async function googleBooksTitleSearch(title, author, apiKey) {
  // Google Books supports distinct qualifiers, so a generic title paired
  // with an author narrows the match far more reliably than title alone.
  if (author) {
    const combined = await googleBooksSearchByQuery(
      `intitle:${title} inauthor:${author}`,
      title,
      author,
      apiKey
    );
    if (combined) return combined;
  }
  // Same reasoning as Apple Books: when we do know the author, still check
  // it against the plain title-only result too, to catch title collisions.
  return googleBooksSearchByQuery(`intitle:${title}`, title, author, apiKey);
}

async function googleBooksCoverCandidate(isbn, title, author, apiKey) {
  if (!apiKey) return null;
  if (isbn) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}&key=${apiKey}`
      );
      if (res.ok) {
        const data = await res.json();
        const hit = data?.items?.[0];
        const info = hit?.volumeInfo;
        const img = info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail;
        if (img) {
          return {
            url: img.replace(/^http:/, "https:").replace(/&zoom=\d/, "&zoom=2"),
            title: info?.title || null,
            author: info?.authors?.[0] || null,
          };
        }
      }
    } catch {
      /* fall through to title search below */
    }
  }
  // Same reasoning as Apple Books: the ebook edition Google indexed may
  // carry a different ISBN than our print-edition ISBN, so retry by title
  // (+ author, if given).
  return googleBooksTitleSearch(title, author, apiKey);
}

async function handleReadingCoverCandidates(body, cors, env) {
  const { title, url, author } = body;
  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  const isbn = isbnFromBookshopUrl(url);
  const authorTrimmed = typeof author === "string" && author.trim() ? author.trim() : null;

  const [openlibrary, itunes, google] = await Promise.all([
    openLibraryCoverCandidate(isbn, title.trim(), authorTrimmed),
    itunesCoverCandidate(isbn, title.trim(), authorTrimmed),
    googleBooksCoverCandidate(isbn, title.trim(), authorTrimmed, env.GOOGLE_BOOKS_API_KEY),
  ]);

  const candidates = [];
  if (openlibrary) candidates.push({ source: "Open Library", url: openlibrary, title: null, author: null });
  if (itunes) candidates.push({ source: "Apple Books", ...itunes });
  if (google) candidates.push({ source: "Google Books", ...google });

  return json({ ok: true, candidates }, 200, cors);
}

async function handleUpdateReadingCover(payload, db, cors, env) {
  const { id } = payload;
  if (!id || typeof id !== "number") {
    return json({ error: "Missing or invalid id" }, 400, cors);
  }
  const coverUrl =
    typeof payload.cover_url === "string" && payload.cover_url.trim()
      ? payload.cover_url.trim()
      : null;
  // author is optional here: the "Change cover" flow always sends whatever
  // is in its author field (pre-filled, edited, or blank), so it's saved
  // alongside the cover the same way cover_url is.
  const author =
    typeof payload.author === "string" && payload.author.trim() ? payload.author.trim() : null;

  try {
    const existing = await dbFirst(db, "SELECT id FROM reading WHERE id = ?", id);
    if (!existing) {
      return json({ error: "Reading entry not found" }, 404, cors);
    }

    await dbRun(
      db,
      "UPDATE reading SET cover_url = ?, author = ? WHERE id = ?",
      coverUrl,
      author,
      id
    );
    await triggerRebuild(env);

    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// ─── Sharing ──────────────────────────────────────────────────────────────────

async function handleSharing(body, db, cors, env, ctx) {
  const { title, url } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof url !== "string" || !url.trim()) {
    return json({ error: "Missing url" }, 400, cors);
  }

  const now = new Date();
  const dateStr = toDateStr(now);
  const datetimeStr = now.toISOString();

  const entry = {
    url: url.trim(),
    title: title.trim(),
    date: dateStr,
    datetime: datetimeStr,
  };

  try {
    await dbRun(
      db,
      "INSERT INTO linklog (url, title, date, datetime) VALUES (?, ?, ?, ?)",
      entry.url,
      entry.title,
      entry.date,
      entry.datetime
    );

    const { microblogWarning, blueskyWarning, mastodonWarning } = await syndicateText(
      env,
      `${entry.title}\n\n${entry.url}`,
      entry.url
    );

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Sharing", triggerRebuild);
    return json({ ok: true, entry, microblogWarning, blueskyWarning, mastodonWarning }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// ─── Fetch Post ──────────────────────────────────────────────────────────────

async function handleFetchPost(body, db, cors) {
  const { slug } = body;
  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const post = await dbFirst(
      db,
      "SELECT title, summary, body_html FROM posts WHERE slug = ?",
      cleanSlug
    );
    if (!post) {
      return json({ error: "Post not found" }, 404, cors);
    }

    return json(
      {
        ok: true,
        title: post.title,
        summary: post.summary,
        body: post.body_html,
      },
      200,
      cors
    );
  } catch (err) {
    return json({ error: err.message || "Post not found" }, 404, cors);
  }
}

// ─── Edit Post ────────────────────────────────────────────────────────────────

async function handleEditPost(body, db, cors, env, ctx) {
  const { slug, title, summary } = body;
  const rawBody = typeof body.body === "string" ? body.body.trim() : null;

  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }
  if (!rawBody) {
    return json({ error: "Missing body" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");
  const bodyHtml = cleanBodyHtml(rawBody);

  try {
    const existing = await dbFirst(
      db,
      "SELECT title, summary FROM posts WHERE slug = ?",
      cleanSlug
    );
    if (!existing) {
      return json({ error: "Post not found" }, 404, cors);
    }

    const newTitle = title?.trim() || existing.title;
    const newSummary = summary?.trim() || existing.summary;
    const now = new Date().toISOString();

    // Save version before updating
    const current = await dbFirst(
      db,
      "SELECT title, summary, body_html FROM posts WHERE slug = ?",
      cleanSlug
    );
    await savePostVersion(db, cleanSlug, current.title, current.summary, current.body_html);

    await dbRun(
      db,
      "UPDATE posts SET title = ?, summary = ?, body_html = ?, updated_at = ? WHERE slug = ?",
      newTitle,
      newSummary,
      bodyHtml,
      now,
      cleanSlug
    );

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Writing", triggerRebuild);

    return json({ ok: true, url: `${SITE_URL}/posts/${cleanSlug}/` }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Edit failed" }, 500, cors);
  }
}

// ─── Delete Post ──────────────────────────────────────────────────────────────

async function handleDeletePost(body, db, cors, env, ctx) {
  const { slug } = body;
  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const existing = await dbFirst(db, "SELECT slug FROM posts WHERE slug = ?", cleanSlug);
    if (!existing) {
      return json({ error: "Post not found" }, 404, cors);
    }

    await dbRun(db, "DELETE FROM post_versions WHERE slug = ?", cleanSlug);
    await dbRun(db, "DELETE FROM posts WHERE slug = ?", cleanSlug);

    await triggerRebuild(env);
    scheduleSectionHintRefresh(ctx, env, db, "Writing", triggerRebuild);

    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Delete failed" }, 500, cors);
  }
}

// ─── Drafts (D1) ─────────────────────────────────────────────────────────────

async function handleListDrafts(db, cors) {
  try {
    const { results } = await dbAll(
      db,
      "SELECT id, title, summary, updated_at FROM drafts ORDER BY updated_at DESC"
    );
    return json({ ok: true, drafts: results || [] }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not list drafts" }, 500, cors);
  }
}

async function handleSaveDraft(body, db, cors) {
  const { id, title, summary, body: draftBody } = body;
  const now = new Date().toISOString();

  try {
    if (id) {
      await dbRun(
        db,
        "UPDATE drafts SET title = ?, summary = ?, body_html = ?, updated_at = ? WHERE id = ?",
        title || "",
        summary || "",
        draftBody || "",
        now,
        id
      );
      return json({ ok: true, id }, 200, cors);
    }

    const draftId = crypto.randomUUID();
    await dbRun(
      db,
      "INSERT INTO drafts (id, title, summary, body_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      draftId,
      title || "",
      summary || "",
      draftBody || "",
      now,
      now
    );
    return json({ ok: true, id: draftId }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not save draft" }, 500, cors);
  }
}

async function handleLoadDraft(body, db, cors) {
  const { id } = body;
  if (!id) {
    return json({ error: "Missing draft id" }, 400, cors);
  }

  try {
    const draft = await dbFirst(
      db,
      "SELECT id, title, summary, body_html, updated_at FROM drafts WHERE id = ?",
      id
    );
    if (!draft) {
      return json({ ok: true, draft: null }, 200, cors);
    }
    return json(
      {
        ok: true,
        draft: {
          id: draft.id,
          title: draft.title,
          summary: draft.summary,
          body: draft.body_html,
          updated_at: draft.updated_at,
        },
      },
      200,
      cors
    );
  } catch (err) {
    return json({ error: err.message || "Could not load draft" }, 500, cors);
  }
}

async function handleDeleteDraft(body, db, cors) {
  const { id } = body;
  if (!id) {
    return json({ error: "Missing draft id" }, 400, cors);
  }

  try {
    await dbRun(db, "DELETE FROM drafts WHERE id = ?", id);
    return json({ ok: true }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Could not delete draft" }, 500, cors);
  }
}

// ─── Fetch Title ─────────────────────────────────────────────────────────────

async function handleFetchTitle(body, cors) {
  const { url } = body;
  if (typeof url !== "string" || !url.trim().startsWith("http")) {
    return json({ error: "Invalid url" }, 400, cors);
  }

  try {
    const res = await fetch(url.trim(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return json({ error: `Page returned ${res.status}` }, 502, cors);
    }

    const reader = res.body.getReader();
    let html = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (bytes < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.length;
      if (html.includes("</head>")) break;
    }
    reader.cancel();

    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!match) {
      return json({ error: "No title found" }, 404, cors);
    }

    const title = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    return json({ ok: true, title }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Fetch failed" }, 502, cors);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status, cors, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function cleanBodyHtml(raw) {
  let html = raw.replace(/(<p><br\s*\/?><\/p>)+/g, "").trim();
  html = html.replace(/(<br\s*\/?>\s*){2,}/g, "</p><p>");
  html = html.replace(/<p>\s*(<br\s*\/?>)+/g, "<p>");
  html = html.replace(/(<br\s*\/?>)+\s*<\/p>/g, "</p>");
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = coalesceImageParagraphsHtml(html);
  return html.trim();
}

function toSlug(s) {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toDateStr(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}
