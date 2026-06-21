import { escHtml } from "./html.mjs";
import { linkifyThinkingEscapedHtml } from "./linkify.mjs";

export function renderThinkingContentHtml(text, mediaUrl, mediaAlt) {
  const t = (text || "").trim();
  const parts = [];
  if (t) {
    for (const para of t.split(/\n\n+/).filter(Boolean)) {
      const inner = linkifyThinkingEscapedHtml(escHtml(para).replace(/\n/g, "<br>"));
      parts.push(`<p>${inner}</p>`);
    }
  }
  if (mediaUrl) {
    parts.push(
      `<img class="thinking-photo" src="${escHtml(mediaUrl)}" alt="${escHtml(mediaAlt || "Photo")}" loading="lazy" decoding="async" />`
    );
  }
  return parts.join("\n");
}
