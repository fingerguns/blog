import { escHtml } from "./html.mjs";
import { linkifyThinkingEscapedHtml } from "./linkify.mjs";
import { toSiteMediaUrl, videoFrameUrlFromVideoUrl } from "./media-url.mjs";
import { extractYouTubeEmbeds, parseYouTubeUrl } from "./youtube.mjs";
import { extractSpotifyEmbeds, parseSpotifyUrl } from "./spotify.mjs";

const SPOTIFY_EMBED_HEIGHT = 152;
const URL_RE = /https?:\/\/[^\s<>"]+/g;

function isEmbeddableUrl(rawUrl) {
  const clean = String(rawUrl).replace(/[.,;:!?)"']+$/, "");
  return Boolean(parseYouTubeUrl(clean) || parseSpotifyUrl(clean));
}

// Quotes: the composer's Quote button stores a quote as its own paragraph
// with every line starting "> " (plain Markdown), so the D1 text stays text.
// rommy.blog draws it as a blockquote; cross-posts get “curly quotes”.
const QUOTE_LINE_RE = /^[ \t]*>[ \t]?/;

/** True when every non-empty line of a paragraph starts with ">". */
export function isQuoteParagraph(para) {
  const lines = String(para || "").split("\n").filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => QUOTE_LINE_RE.test(l));
}

/** A quote paragraph's text without its "> " markers. */
export function unquoteParagraph(para) {
  return String(para || "")
    .split("\n")
    .map((l) => l.replace(QUOTE_LINE_RE, ""))
    .join("\n")
    .trim();
}

function splitParagraphs(text) {
  return String(text || "").split(/(\n[ \t]*\n+)/);
}

/** The note's text with quote markers removed (for plain-text snippets). */
export function stripQuoteMarkers(text) {
  return splitParagraphs(text)
    .map((chunk, i) => (i % 2 === 0 && isQuoteParagraph(chunk) ? unquoteParagraph(chunk) : chunk))
    .join("");
}

const QUOTE_MARKS_RE = /^["“”«»]/;

/**
 * The note's text as Bluesky, Mastodon and Micro.blog get it: each quote
 * paragraph becomes “…”, left alone if the quote already opens with its own quote mark.
 */
export function thinkingQuotesForSyndication(text) {
  return splitParagraphs(text)
    .map((chunk, i) => {
      if (i % 2 !== 0 || !isQuoteParagraph(chunk)) return chunk;
      const body = unquoteParagraph(chunk);
      if (!body) return "";
      return QUOTE_MARKS_RE.test(body) ? body : `“${body}”`;
    })
    .join("");
}

/** Most link cards a single note will show; past this the cards outweigh the note. */
export const MAX_UNFURLS_PER_NOTE = 3;

/**
 * The links in a note that get an unfurl card: every http(s) URL in the text,
 * in order, de-duplicated, minus YouTube/Spotify links (those already render
 * as native players). Trailing punctuation is trimmed exactly as linkifyUrls
 * trims it, so the card and the inline link point at the same address.
 */
export function unfurlableUrls(text) {
  const seen = new Set();
  for (const raw of String(text || "").match(URL_RE) || []) {
    const clean = raw.replace(/[.,;:!?)"']+$/, "");
    if (isEmbeddableUrl(clean) || seen.has(clean)) continue;
    seen.add(clean);
    if (seen.size === MAX_UNFURLS_PER_NOTE) break;
  }
  return [...seen];
}

// A URL that ends a line, with any sentence punctuation after it.
const TRAILING_URL_RE = /(^|\s)(https?:\/\/[^\s<>"]+?)([.,;:!?]*)\s*$/;

/**
 * Remove the links that already show as a preview card from the end of each
 * line, so a note does not print a URL above its own card. `isUnfurled(url)`
 * says whether `url` got a card. Only a run of links at the end of a line
 * goes: one mid-sentence ("read https://… today") stays, since the sentence
 * needs it. A line left empty is dropped.
 */
export function stripUnfurledUrls(text, isUnfurled) {
  if (!text || typeof isUnfurled !== "function") return String(text || "");
  return String(text)
    .split("\n")
    .flatMap((line) => {
      let out = line;
      for (;;) {
        const m = out.match(TRAILING_URL_RE);
        if (!m || !isUnfurled(m[2])) break;
        out = out.slice(0, m.index + m[1].length).trimEnd();
      }
      return out.trim() || !line.trim() ? [out] : [];
    })
    .join("\n")
    .trim();
}

/** Remove URLs that render as native YouTube/Spotify embeds from plain post text. */
export function stripEmbeddableUrls(text) {
  if (!text) return "";
  return String(text)
    .replace(URL_RE, (url) => (isEmbeddableUrl(url) ? "" : url))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function inferMediaType(mediaUrl, mediaType) {
  if (mediaType === "audio" || mediaType === "image" || mediaType === "video") return mediaType;
  if (!mediaUrl) return "";
  const lower = mediaUrl.toLowerCase();
  if (/\.(m4a|mp3|aac)(\?|$)/.test(lower)) return "audio";
  if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(lower)) return "video";
  if (mediaUrl) return "image";
  return "";
}

function resolvePhotoUrls(mediaUrl, mediaUrls, siteUrl) {
  let urls = [];
  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    urls = mediaUrls.filter((u) => typeof u === "string" && u);
  } else if (mediaUrl) {
    urls = [mediaUrl];
  }
  urls = urls.slice(0, 4);
  if (siteUrl) {
    return urls.map((u) => toSiteMediaUrl(u, siteUrl));
  }
  return urls;
}

/**
 * The resolved URL of a note's photo when it has exactly one, else "". The
 * build uses it to know which photos to measure, so it must resolve URLs
 * exactly as renderThinkingContentHtml does — the cache is keyed by it.
 */
/**
 * The resolved URL of a note's native video, or "". Like singlePhotoUrl, it
 * resolves exactly as renderThinkingContentHtml does, because the build keys
 * the "video-frames" cache by it.
 */
export function nativeVideoUrl(mediaUrl, mediaType, siteUrl = "") {
  if (!mediaUrl || inferMediaType(mediaUrl, mediaType) !== "video") return "";
  return siteUrl ? toSiteMediaUrl(mediaUrl, siteUrl) : mediaUrl;
}

export function singlePhotoUrl(mediaUrl, mediaType, siteUrl = "", mediaUrls = []) {
  if (inferMediaType(mediaUrl, mediaType) !== "image") return "";
  const urls = resolvePhotoUrls(mediaUrl, mediaUrls, siteUrl);
  return urls.length === 1 ? urls[0] : "";
}

function isLandscape(size) {
  return Boolean(size && size.width > 0 && size.height > 0 && size.width > size.height);
}

function renderPhotoGallery(urls, mediaAlt, photoSize) {
  const alt = escHtml(mediaAlt || "Photo");
  if (urls.length === 1) {
    // A landscape photo fills the column at its own aspect ratio; portrait and
    // square photos (and any whose size is unknown) keep the square crop at
    // two-thirds width. width/height on the <img> let the browser reserve the
    // box before the file arrives.
    const size = typeof photoSize === "function" ? photoSize(urls[0]) : null;
    if (isLandscape(size)) {
      return (
        `<button type="button" class="thinking-photo-tile thinking-photo-tile--single thinking-photo-tile--landscape" data-gallery-index="0" aria-label="View photo">` +
          `<img class="thinking-photo" src="${escHtml(urls[0])}" alt="${alt}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async" />` +
        `</button>`
      );
    }
    return (
      `<button type="button" class="thinking-photo-tile thinking-photo-tile--single" data-gallery-index="0" aria-label="View photo">` +
        `<img class="thinking-photo" src="${escHtml(urls[0])}" alt="${alt}" loading="lazy" decoding="async" />` +
      `</button>`
    );
  }
  const tiles = urls
    .map(
      (url, i) =>
        `<button type="button" class="thinking-photo-tile" data-gallery-index="${i}" aria-label="View photo ${i + 1} of ${urls.length}">` +
          `<img class="thinking-photo" src="${escHtml(url)}" alt="${alt}" loading="lazy" decoding="async" />` +
        `</button>`
    )
    .join("");
  return `<div class="thinking-photo-grid" data-gallery>${tiles}</div>`;
}

function renderYouTubeEmbed({ id, start }) {
  const src = `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`;
  return (
    `<div class="thinking-youtube">` +
      `<iframe src="${escHtml(src)}" title="YouTube video player" loading="lazy" ` +
        `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
        `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>` +
    `</div>`
  );
}

function renderSpotifyEmbed({ type, id }) {
  const src = `https://open.spotify.com/embed/${type}/${id}`;
  return (
    `<div class="thinking-spotify thinking-spotify--${type}">` +
      `<iframe src="${escHtml(src)}" title="Spotify embed" loading="lazy" height="${SPOTIFY_EMBED_HEIGHT}" ` +
        `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` +
    `</div>`
  );
}

export function renderThinkingContentHtml(
  text,
  mediaUrl,
  mediaAlt,
  mediaType = "",
  siteUrl = "",
  options = {}
) {
  const raw = (text || "").trim();
  const t = stripEmbeddableUrls(stripUnfurledUrls(raw, options.isUnfurled));
  const type = inferMediaType(mediaUrl, mediaType);
  const photoUrls = type === "image" ? resolvePhotoUrls(mediaUrl, options.mediaUrls, siteUrl) : [];
  const resolvedUrl =
    !photoUrls.length && mediaUrl
      ? siteUrl
        ? toSiteMediaUrl(mediaUrl, siteUrl)
        : mediaUrl
      : photoUrls[0] || "";
  const videoPreload = options.videoPreload === "auto" ? "auto" : "metadata";
  const parts = [];
  if (t) {
    for (const para of t.split(/\n\n+/).filter(Boolean)) {
      const quote = isQuoteParagraph(para);
      const body = quote ? unquoteParagraph(para) : para;
      if (!body.trim()) continue;
      const inner = linkifyThinkingEscapedHtml(escHtml(body).replace(/\n/g, "<br>"));
      parts.push(quote ? `<blockquote class="thinking-quote"><p>${inner}</p></blockquote>` : `<p>${inner}</p>`);
    }
  }
  if (raw) {
    for (const embed of extractYouTubeEmbeds(raw)) {
      parts.push(renderYouTubeEmbed(embed));
    }
    for (const embed of extractSpotifyEmbeds(raw)) {
      parts.push(renderSpotifyEmbed(embed));
    }
  }
  if (resolvedUrl && type === "audio") {
    parts.push(
      `<audio class="thinking-audio" controls preload="metadata" playsinline>` +
        `<source src="${escHtml(resolvedUrl)}" type="audio/mp4">` +
        `${escHtml(mediaAlt || "Audio")}</audio>`
    );
  } else if (resolvedUrl && type === "video") {
    // With a full-frame still (`<uuid>-frame.jpg`, measured into the
    // "video-frames" cache), the thumbnail is that image and the box is sized
    // from its width and height before any video loads, so nothing is fetched
    // until play is pressed. Mobile Safari skips `preload` in Low Power and Low
    // Data modes and caps how many videos a page may load, which used to leave
    // feed videos with no frame, no size and no usable play button.
    // Without one, #t=0.001 asks the browser to seek to the first frame and
    // draw it as the thumbnail, which it may or may not do.
    const frame = options.videoFrame?.(resolvedUrl);
    const frameUrl = frame ? videoFrameUrlFromVideoUrl(resolvedUrl, siteUrl || undefined) : "";
    const stillAttrs = frameUrl
      ? ` poster="${escHtml(frameUrl)}" width="${frame.width}" height="${frame.height}"`
      : "";
    parts.push(
      `<video class="thinking-video" controls preload="${frameUrl ? "none" : videoPreload}" playsinline${stillAttrs} src="${escHtml(resolvedUrl)}#t=0.001">${escHtml(mediaAlt || "Video")}</video>`
    );
  } else if (photoUrls.length) {
    parts.push(renderPhotoGallery(photoUrls, mediaAlt, options.photoSize));
  }
  return parts.join("\n");
}
