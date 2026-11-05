/**
 * Page-level pieces of the two permalink pages — a Thinking note and a
 * Writing post — shared by the build and the live overlay.
 *
 * The pages themselves stay in scripts/build.mjs, which owns their large
 * inline scripts. The build writes each page twice over: once per real item,
 * and once as a template under /_live/ with a LIVE_TOKENS marker in every
 * slot that varies. When the Worker has to serve a permalink the rebuild has
 * not written yet, it fetches that template from the deployed site and fills
 * the slots from the *Parts() functions here — the same functions the build
 * used for the real pages, so both agree on every byte.
 *
 * ctx: { base, siteTitle }
 */
import { escHtml } from "../html.mjs";
import { formatMbDate, readingMins, safeSlug, stripHtml, toETDate } from "./format.mjs";
import { firstImageFromHtml, thinkingSnippet, thinkingPostMetaHtml, thinkingUnfurlsHtml } from "./thinking.mjs";

/** Slot markers for the /_live/ templates. Plain ASCII, untouched by escHtml. */
export const LIVE_TOKENS = {
  title: "__LIVE_TITLE__",
  og: "__LIVE_OG__",
  slug: "__LIVE_SLUG__",
  microblogUrl: "__LIVE_MICROBLOG_URL__",
  crumbIso: "__LIVE_CRUMB_ISO__",
  crumbDate: "__LIVE_CRUMB_DATE__",
  body: "__LIVE_BODY__",
  heading: "__LIVE_HEADING__",
  postUrlJson: "__LIVE_POST_URL_JSON__",
  pager: "__LIVE_PAGER__",
  displayDate: "__LIVE_DISPLAY_DATE__",
  readMins: "__LIVE_READ_MINS__",
};

/** Paths of the templates in the deployed site. */
export const LIVE_TEMPLATE_PATHS = {
  thinking: "/_live/thinking/",
  post: "/_live/post/",
};

/** Fill a template's slots. Values are already-escaped HTML. */
export function fillLiveTemplate(template, parts) {
  let out = String(template);
  for (const [name, token] of Object.entries(LIVE_TOKENS)) {
    if (parts[name] === undefined) continue;
    out = out.split(token).join(String(parts[name]));
  }
  return out;
}

export function defaultOgImage(ctx) {
  return `${ctx.base}/favicon.png`;
}

export function ogMetaTags(ctx, { type = "website", title, description = "", url, image }) {
  const img = image || defaultOgImage(ctx);
  const large = img !== defaultOgImage(ctx);
  const lines = [
    `    <meta property="og:type" content="${type}" />`,
    `    <meta property="og:title" content="${escHtml(title)}" />`,
    `    <meta property="og:url" content="${escHtml(url)}" />`,
    `    <meta property="og:site_name" content="${escHtml(ctx.siteTitle)}" />`,
    `    <meta property="og:image" content="${escHtml(img)}" />`,
    `    <meta name="twitter:card" content="${large ? "summary_large_image" : "summary"}" />`,
    `    <meta name="twitter:title" content="${escHtml(title)}" />`,
  ];
  if (description) {
    lines.push(`    <meta property="og:description" content="${escHtml(description)}" />`);
    lines.push(`    <meta name="description" content="${escHtml(description)}" />`);
    lines.push(`    <meta name="twitter:description" content="${escHtml(description)}" />`);
  }
  if (large) {
    lines.push(`    <meta name="twitter:image" content="${escHtml(img)}" />`);
  }
  return lines.join("\n");
}

export function thinkingOgFromItem(item, ctx) {
  const description = thinkingSnippet(stripHtml(item.content_html));
  const image = firstImageFromHtml(item.content_html) || defaultOgImage(ctx);
  return { description, image };
}

/**
 * The varying slots of a Thinking permalink. `detailContent` is the note's
 * body rendered for its own page (the build preloads video there).
 * `renderCtx` is the full renderer context (for the link cards).
 */
export function thinkingPermalinkParts(item, slug, detailContent, ctx, renderCtx) {
  const iso = item.date_published;
  const pageTitle = `${formatMbDate(iso)} — ${ctx.siteTitle}`;
  const pageUrl = `${ctx.base}/thinking/${slug}/`;
  const og = thinkingOgFromItem(item, ctx);
  return {
    title: escHtml(pageTitle),
    og: ogMetaTags(ctx, { type: "article", title: pageTitle, description: og.description, url: pageUrl, image: og.image }),
    slug: escHtml(slug),
    microblogUrl: escHtml(item.url || ""),
    crumbIso: escHtml(iso),
    crumbDate: escHtml(formatMbDate(iso)),
    body: `<div class="microblog-body">${detailContent}</div>${thinkingUnfurlsHtml(item._text, renderCtx)}
      ${thinkingPostMetaHtml(item, slug)}`,
  };
}

// Previous/next links at the foot of a Writing post, so a reader who finishes
// one essay has somewhere to go besides back to the top. "Older" sits on the
// left and "Newer" on the right, matching reading order through the archive.
export function postPagerHtml(newer, older) {
  if (!newer && !older) return "";
  const link = (q, rel, dir) =>
    q
      ? `<a class="post-pager-${dir}" href="/posts/${safeSlug(q.slug)}/" rel="${rel}"><span class="post-pager-label">${dir === "older" ? "← Older" : "Newer →"}</span><span class="post-pager-title">${escHtml(q.title)}</span></a>`
      : `<span class="post-pager-${dir}"></span>`;
  return `      <nav class="post-pager" aria-label="More writing">
        ${link(older, "prev", "older")}
        ${link(newer, "next", "newer")}
      </nav>`;
}

/** The varying slots of a Writing post page. */
export function postPermalinkParts(p, newer, older, ctx) {
  const slug = safeSlug(p.slug);
  const bodyHtml = p.body_html || "";
  const postUrl = `${ctx.base}/posts/${slug}/`;
  const ogTitle = `${p.title} — ${ctx.siteTitle}`;
  return {
    title: escHtml(ogTitle),
    og: ogMetaTags(ctx, {
      type: "article",
      title: ogTitle,
      description: p.summary || "",
      url: postUrl,
      image: firstImageFromHtml(bodyHtml) || defaultOgImage(ctx),
    }),
    slug: escHtml(slug),
    heading: escHtml(p.title),
    displayDate: escHtml(toETDate(p)),
    readMins: String(readingMins(p.body_html)),
    body: bodyHtml,
    postUrlJson: JSON.stringify(postUrl),
    pager: postPagerHtml(newer, older),
  };
}
