/** Merge image-only <p> with the following <p> so floats wrap text (matches admin coalesce). */
export function coalesceImageParagraphsHtml(html) {
  const imgPara =
    /<p>(?:\s*)<img([^>]*class="[^"]*post-photo[^"]*"[^>]*)>(?:\s*(?:\u200b|&#8203;|&ZeroWidthSpace;)?\s*)<\/p>\s*<p>((?:(?!<\/p>).)+)<\/p>/gi;
  let prev = "";
  let out = html;
  while (out !== prev) {
    prev = out;
    out = out.replace(imgPara, "<p><img$1>$2</p>");
  }
  return out;
}
