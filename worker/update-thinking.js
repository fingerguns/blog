import { thinkingSlugFromDate } from "../scripts/lib/thinking-slug.mjs";
import { escHtml } from "../scripts/lib/html.mjs";
import { coalesceImageParagraphsHtml } from "../scripts/lib/coalesce-images.mjs";
import { addHashtagFacets } from "../scripts/lib/linkify.mjs";
import { renderThinkingContentHtml } from "../scripts/lib/thinking-html.mjs";
import { scheduleSectionHintRefresh } from "./section-hints.mjs";

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
 * Workers AI (section hover tooltips — auto-regenerated on content changes):
 *   Enable Workers AI in Cloudflare dashboard; [ai] binding in wrangler.toml
 *
 * R2 (photos on THINKING):
 *   Enable R2 in Cloudflare dashboard, then: wrangler r2 bucket create rommy-blog-media
 *   Enable public access on the bucket and set MEDIA_PUBLIC_URL in wrangler.toml [vars]
 */

const SITE_URL = "https://rommy.blog";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_THINKING_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_THINKING_IMAGE_MP = 5_000_000;
const MAX_BLUESKY_IMAGE_BYTES = 2_000_000;
const MAX_MASTODON_CHARS = 500;
const DEFAULT_MASTODON_INSTANCE = "https://mas.to";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
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
      return new Response(null, { headers: cors });
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

    if (action === "thinking") {
      return handleThinking(payload, db, cors, env, ctx);
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
    const photo = fd.get("photo");
    const photoBluesky = fd.get("photo_bluesky");
    return {
      password: fd.get("password"),
      action: fd.get("action"),
      folder: String(fd.get("folder") || "writing"),
      text: String(fd.get("text") || ""),
      photo:
        photo && typeof photo === "object" && "arrayBuffer" in photo && photo.size > 0
          ? photo
          : null,
      photo_bluesky:
        photoBluesky &&
        typeof photoBluesky === "object" &&
        "arrayBuffer" in photoBluesky &&
        photoBluesky.size > 0
          ? photoBluesky
          : null,
    };
  }
  return request.json();
}

// ─── Thinking ────────────────────────────────────────────────────────────────

async function handleThinking(payload, db, cors, env, ctx) {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const photo = payload.photo || null;

  if (!text && !photo) {
    return json({ error: "Add text or a photo" }, 400, cors);
  }
  if (text.length > 2000) {
    return json({ error: "Text must be 2000 characters or fewer" }, 400, cors);
  }
  // Bluesky cross-post truncates at 300; admin shows a soft 300-char guide.

  try {
    let mediaUrl = null;
    let mediaAlt = text.slice(0, 1000) || "";
    let uploadedForBluesky = null;
    let blueskyCompressed = false;
    let syndicationPhoto = photo;

    if (photo) {
      const uploaded = await uploadPhotoToR2(env, photo, "thinking");
      mediaUrl = uploaded.url;
      mediaAlt = text.slice(0, 1000) || "Photo";
      syndicationPhoto = syndicationPhotoFromUpload(uploaded);
      uploadedForBluesky = {
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType,
        alt: mediaAlt,
        aspectRatio: uploaded.aspectRatio,
      };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const slug = thinkingSlugFromDate(now);

    let microblogUrl = null;
    let microblogWarning = null;
    if (env.MICROBLOG_TOKEN) {
      try {
        microblogUrl = await postToMicroblog(env.MICROBLOG_TOKEN, text, syndicationPhoto);
      } catch (mbErr) {
        microblogWarning = formatServiceWarning("micro.blog", mbErr.message);
      }
    }

    let blueskyUri = null;
    let blueskyWarning = null;
    if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
      try {
        let blueskyImage = null;
        if (uploadedForBluesky) {
          const prepared = await prepareBlueskyImage(
            uploadedForBluesky,
            payload.photo_bluesky
          );
          blueskyImage = prepared.image;
          blueskyCompressed = prepared.compressed;
        }
        let blueskyLinkCard = null;
        if (!blueskyImage && [...text].length > 300) {
          const urlMatch = text.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            const extractedUrl = urlMatch[0].replace(/[.,;:!?)"']+$/, "");
            blueskyLinkCard = await fetchLinkCard(extractedUrl);
          }
          if (!blueskyLinkCard) {
            blueskyLinkCard = {
              uri: `${SITE_URL}/thinking/${slug}/`,
              title: text.slice(0, 100).trim(),
              description: text.length > 100 ? text.slice(100, 280).trim() : "",
              thumb: null,
            };
          }
        }
        blueskyUri = await postToBluesky(
          env.BLUESKY_HANDLE,
          env.BLUESKY_APP_PASSWORD,
          text,
          blueskyImage,
          blueskyLinkCard
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
        const mastodonImage = uploadedForBluesky
          ? { bytes: uploadedForBluesky.bytes, mimeType: uploadedForBluesky.mimeType, alt: uploadedForBluesky.alt }
          : null;
        mastodonUrl = await postToMastodon(mastodonInstance, env.MASTODON_ACCESS_TOKEN, text, mastodonImage);
      } catch (msErr) {
        mastodonWarning = formatServiceWarning("Mastodon", msErr.message);
      }
    }

    const contentHtml = renderThinkingContentHtml(text, mediaUrl, mediaAlt);
    await dbRun(
      db,
      `INSERT INTO thinking_posts (slug, text, media_url, media_alt, content_html, datetime, microblog_url, bluesky_uri, mastodon_uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         text = excluded.text,
         media_url = excluded.media_url,
         media_alt = excluded.media_alt,
         content_html = excluded.content_html,
         microblog_url = COALESCE(excluded.microblog_url, thinking_posts.microblog_url),
         bluesky_uri = COALESCE(excluded.bluesky_uri, thinking_posts.bluesky_uri),
         mastodon_uri = COALESCE(excluded.mastodon_uri, thinking_posts.mastodon_uri),
         datetime = excluded.datetime`,
      slug,
      text,
      mediaUrl,
      mediaAlt,
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
    `SELECT slug, text, content_html, datetime, microblog_url
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

async function compressImageForBluesky(bytes, mimeType) {
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

function fitDimensionsUnderMegapixels(width, height, maxMp) {
  const mp = width * height;
  if (mp <= maxMp) return { width, height };
  const scale = Math.sqrt(maxMp / mp);
  let w = Math.max(1, Math.round(width * scale));
  let h = Math.max(1, Math.round(height * scale));
  while (w * h > maxMp) {
    if (w >= h && w > 1) w--;
    else if (h > 1) h--;
    else break;
  }
  return { width: w, height: h };
}

async function encodeJpegUnderByteLimit(bitmap, width, height, maxBytes) {
  const qualities = [0.92, 0.85, 0.78, 0.72, 0.65, 0.58, 0.5, 0.42];
  let w = width;
  let h = height;

  while (w >= 1 && h >= 1) {
    for (const quality of qualities) {
      const out = await encodeJpegFromBitmap(bitmap, w, h, quality);
      if (out.byteLength <= maxBytes) {
        return { bytes: out, width: w, height: h };
      }
    }
    if (w === 1 && h === 1) break;
    w = Math.max(1, Math.round(w * 0.9));
    h = Math.max(1, Math.round(h * 0.9));
  }

  throw new Error("Could not compress photo under 5 MB.");
}

async function processThinkingPhoto(bytes, mimeType) {
  if (bytes.byteLength > MAX_THINKING_INPUT_BYTES) {
    throw new Error("Photo must be 20 MB or smaller.");
  }

  if (mimeType === "image/gif") {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("GIF must be 5 MB or smaller.");
    }
    const aspectRatio = await imageAspectRatio(bytes, mimeType);
    if (aspectRatio.width * aspectRatio.height > MAX_THINKING_IMAGE_MP) {
      throw new Error("GIF must be 5 megapixels or smaller.");
    }
    return { bytes, mimeType, aspectRatio };
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
    const { width: w, height: h } = bitmap;
    const { width: cw, height: ch } = fitDimensionsUnderMegapixels(w, h, MAX_THINKING_IMAGE_MP);
    const needsResize = cw !== w || ch !== h;
    const needsByteLimit = bytes.byteLength > MAX_IMAGE_BYTES;

    if (!needsResize && !needsByteLimit) {
      return { bytes, mimeType, aspectRatio: { width: w, height: h } };
    }

    const encoded = await encodeJpegUnderByteLimit(bitmap, cw, ch, MAX_IMAGE_BYTES);
    return {
      bytes: encoded.bytes,
      mimeType: "image/jpeg",
      aspectRatio: { width: encoded.width, height: encoded.height },
    };
  } finally {
    bitmap.close();
  }
}

function syndicationPhotoFromUpload(uploaded) {
  const ext = IMAGE_EXT[uploaded.mimeType] || "jpg";
  return new File([uploaded.bytes], `photo.${ext}`, { type: uploaded.mimeType });
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

  let bytes = await file.arrayBuffer();
  let outMime = mimeType;
  let aspectRatio;

  if (folder === "thinking") {
    const processed = await processThinkingPhoto(bytes, mimeType);
    bytes = processed.bytes;
    outMime = processed.mimeType;
    aspectRatio = processed.aspectRatio;
  } else {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Photo must be 5 MB or smaller for rommy.blog.");
    }
    aspectRatio = await imageAspectRatio(bytes, mimeType);
  }

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

async function postToMicroblog(token, content, photoFile = null) {
  if (photoFile) {
    const mimeType = photoFile.type || "image/jpeg";
    const bytes = await photoFile.arrayBuffer();
    const fd = new FormData();
    fd.append("h", "entry");
    if (content) fd.append("content", content);
    fd.append(
      "photo",
      new Blob([bytes], { type: mimeType }),
      `photo.${IMAGE_EXT[mimeType] || "jpg"}`
    );

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

async function postToBluesky(handle, appPassword, content, image = null, linkCard = null) {
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

  let embed;
  if (image) {
    const byteLength = image.bytes?.byteLength ?? 0;

    const blobRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "Content-Type": image.mimeType,
      },
      body: image.bytes,
    });
    if (!blobRes.ok) {
      const err = await blobRes.text();
      throw new Error(blueskyImageError(byteLength, blobRes.status, err));
    }
    const { blob } = await blobRes.json();
    embed = {
      $type: "app.bsky.embed.images",
      images: [
        {
          alt: image.alt || "",
          image: blob,
          aspectRatio: image.aspectRatio,
        },
      ],
    };
  } else if (linkCard) {
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
    embed = {
      $type: "app.bsky.embed.external",
      external: {
        uri: linkCard.uri,
        title: linkCard.title,
        description: linkCard.description,
        ...(thumb ? { thumb } : {}),
      },
    };
  }

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
  const created = await postRes.json();
  return created.uri || null;
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

async function postToMastodon(instanceUrl, accessToken, content, image = null) {
  let mediaId = null;
  if (image) {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([image.bytes], { type: image.mimeType }),
      `photo.${IMAGE_EXT[image.mimeType] || "jpg"}`
    );
    if (image.alt) fd.append("description", image.alt.slice(0, 1500));
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
    mediaId = mediaData.id;
  }

  const chars = [...content];
  let status = content;
  if (chars.length > MAX_MASTODON_CHARS) {
    const suffix = `… ${SITE_URL}/thinking/`;
    const maxContent = MAX_MASTODON_CHARS - [...suffix].length;
    status = chars.slice(0, maxContent).join("") + suffix;
  }

  const body = { status };
  if (mediaId) body.media_ids = [mediaId];

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
      `New post: ${postUrl}`,
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
  const { title, url, ym } = body;

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

  const entry = { ym: month, title: title.trim(), url: url.trim() };

  try {
    await dbRun(
      db,
      "INSERT INTO reading (ym, title, url, added_at) VALUES (?, ?, ?, ?)",
      entry.ym,
      entry.title,
      entry.url,
      now.toISOString()
    );

    const { microblogWarning, blueskyWarning, mastodonWarning } = await syndicateText(
      env,
      `Now reading: ${entry.url}`,
      entry.url
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
      "SELECT id, ym, title, url, added_at FROM reading ORDER BY added_at DESC"
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
    headers: { ...cors, "Content-Type": "application/json", ...extraHeaders },
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
