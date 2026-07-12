import { escHtml } from "./html.mjs";
import { linkifyThinkingEscapedHtml } from "./linkify.mjs";
import { toSiteMediaUrl } from "./media-url.mjs";

export function inferMediaType(mediaUrl, mediaType) {
  if (mediaType === "audio" || mediaType === "image" || mediaType === "video") return mediaType;
  if (!mediaUrl) return "";
  const lower = mediaUrl.toLowerCase();
  if (/\.(m4a|mp3|aac)(\?|$)/.test(lower)) return "audio";
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) return "video";
  if (mediaUrl) return "image";
  return "";
}

export function renderThinkingContentHtml(text, mediaUrl, mediaAlt, mediaType = "", siteUrl = "") {
  const t = (text || "").trim();
  const type = inferMediaType(mediaUrl, mediaType);
  const resolvedUrl = siteUrl ? toSiteMediaUrl(mediaUrl, siteUrl) : mediaUrl;
  const parts = [];
  if (t) {
    for (const para of t.split(/\n\n+/).filter(Boolean)) {
      const inner = linkifyThinkingEscapedHtml(escHtml(para).replace(/\n/g, "<br>"));
      parts.push(`<p>${inner}</p>`);
    }
  }
  if (resolvedUrl && type === "audio") {
    parts.push(
      `<audio class="thinking-audio" controls preload="metadata" playsinline>` +
        `<source src="${escHtml(resolvedUrl)}" type="audio/mp4">` +
        `${escHtml(mediaAlt || "Audio")}</audio>`
    );
  } else if (resolvedUrl && type === "video") {
    parts.push(
      `<video class="thinking-video" controls preload="metadata" playsinline src="${escHtml(resolvedUrl)}">${escHtml(mediaAlt || "Video")}</video>`
    );
  } else if (resolvedUrl) {
    parts.push(
      `<img class="thinking-photo" src="${escHtml(resolvedUrl)}" alt="${escHtml(mediaAlt || "Photo")}" loading="lazy" decoding="async" />`
    );
  }
  return parts.join("\n");
}
