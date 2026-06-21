/** Bluesky hashtag search pages — rommy.blog links here for #tags in Thinking. */
export const BSKY_HASHTAG_BASE = "https://bsky.app/hashtag/";

export function blueskyHashtagUrl(tag) {
  return `${BSKY_HASHTAG_BASE}${encodeURIComponent(tag)}`;
}

/** Letters/underscore first; up to 64 tag chars (Bluesky rules). */
const HASHTAG_BODY = /#([a-zA-Z_][a-zA-Z0-9_]{0,63})/g;

/** Hashtag must follow start-of-string or whitespace/open-paren (not mid-word). */
const HASHTAG_FACET_RE = /(?:^|[\s(])(#[a-zA-Z_][a-zA-Z0-9_]{0,63})/g;

export function linkifyUrls(html) {
  return html.replace(/https?:\/\/[^\s<>"]+/g, (url) => {
    const clean = url.replace(/[.,;:!?)"']+$/, "");
    const trail = url.slice(clean.length);
    return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>${trail}`;
  });
}

export function linkifyHashtags(html) {
  const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(HASHTAG_BODY, (match, tag) => {
        const href = blueskyHashtagUrl(tag);
        return `<a href="${href}" rel="noopener" target="_blank">${match}</a>`;
      });
    })
    .join("");
}

/** Link bare URLs and #hashtags in escaped Thinking paragraph HTML. */
export function linkifyThinkingEscapedHtml(html) {
  return linkifyHashtags(linkifyUrls(html));
}

function facetOverlaps(facets, byteStart, byteEnd) {
  return facets.some(
    (f) => f.index.byteStart < byteEnd && f.index.byteEnd > byteStart
  );
}

/** Append Bluesky tag facets for #hashtags in plain post text. */
export function addHashtagFacets(text, facets, enc) {
  let m;
  while ((m = HASHTAG_FACET_RE.exec(text)) !== null) {
    let tagWithHash = m[1].replace(/[^\w#]+$/g, "");
    if (tagWithHash.length <= 1) continue;
    const tag = tagWithHash.slice(1);
    if (tag.length > 64) continue;
    const index = m.index + m[0].length - tagWithHash.length;
    const byteStart = enc.encode(text.slice(0, index)).length;
    const byteEnd = byteStart + enc.encode(tagWithHash).length;
    if (facetOverlaps(facets, byteStart, byteEnd)) continue;
    facets.push({
      $type: "app.bsky.richtext.facet",
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }
}
