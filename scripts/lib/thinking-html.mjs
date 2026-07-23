import { escHtml } from "./html.mjs";
import { linkifyThinkingEscapedHtml } from "./linkify.mjs";
import { toSiteMediaUrl } from "./media-url.mjs";
import { extractYouTubeEmbeds, parseYouTubeUrl } from "./youtube.mjs";
import { extractSpotifyEmbeds, parseSpotifyUrl } from "./spotify.mjs";

const SPOTIFY_EMBED_HEIGHT = 152;
const URL_RE = /https?:\/\/[^\s<>"]+/g;

function isEmbeddableUrl(rawUrl) {
  const clean = String(rawUrl).replace(/[.,;:!?)"']+$/, "");
  return Boolean(parseYouTubeUrl(clean) || parseSpotifyUrl(clean));
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

function renderPhotoGallery(urls, mediaAlt) {
  const alt = escHtml(mediaAlt || "Photo");
  if (urls.length === 1) {
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
  const t = stripEmbeddableUrls(raw);
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
      const inner = linkifyThinkingEscapedHtml(escHtml(para).replace(/\n/g, "<br>"));
      parts.push(`<p>${inner}</p>`);
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
    // Appending #t=0.001 causes iOS Safari (and other mobile browsers) to seek
    // to the first frame and render it as the thumbnail instead of a blank box.
    parts.push(
      `<video class="thinking-video" controls preload="${videoPreload}" playsinline src="${escHtml(resolvedUrl)}#t=0.001">${escHtml(mediaAlt || "Video")}</video>`
    );
  } else if (photoUrls.length) {
    parts.push(renderPhotoGallery(photoUrls, mediaAlt));
  }
  return parts.join("\n");
}
