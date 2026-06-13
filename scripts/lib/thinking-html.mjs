import { escHtml } from "./html.mjs";

export function renderThinkingContentHtml(text, mediaUrl, mediaAlt) {
  const t = (text || "").trim();
  const parts = [];
  if (t) {
    for (const para of t.split(/\n\n+/).filter(Boolean)) {
      parts.push(`<p>${escHtml(para).replace(/\n/g, "<br>")}</p>`);
    }
  }
  if (mediaUrl) {
    parts.push(
      `<img src="${escHtml(mediaUrl)}" alt="${escHtml(mediaAlt || "Photo")}" loading="lazy" decoding="async" />`
    );
  }
  return parts.join("\n");
}
