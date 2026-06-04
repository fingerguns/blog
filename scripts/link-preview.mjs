/**
 * Fetch Open Graph metadata at build time and render link preview cards.
 */

const PREVIEW_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 250_000;
const USER_AGENT = "rommy-blog-builder/1.0";

const INTERNAL_HOSTS = new Set([
  "rommy.blog",
  "www.rommy.blog",
  "rommy.micro.blog",
  "rommy-blog.pages.dev",
]);

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isPreviewableUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (INTERNAL_HOSTS.has(normalizeHost(u.hostname))) return false;
    if (/\.(png|jpe?g|gif|webp|svg|avif|mp4|mp3|pdf)(\?|$)/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractUrlsFromPlainText(text) {
  const urls = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const clean = m[0].replace(/[.,;:!?)"']+$/, "");
    if (isPreviewableUrl(clean)) urls.push(clean);
  }
  return [...new Set(urls)];
}

export function extractUrlsFromHtml(html) {
  const urls = [];
  const re = /href=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const clean = m[1].replace(/[.,;:!?)"']+$/, "");
    if (isPreviewableUrl(clean)) urls.push(clean);
  }
  return [...new Set(urls)];
}

function resolveUrl(maybeRelative, pageUrl) {
  if (!maybeRelative) return "";
  try {
    return new URL(maybeRelative, pageUrl).href;
  } catch {
    return maybeRelative;
  }
}

function readMetaContent(html, attr, key) {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`,
    "i"
  );
  const m = html.match(re);
  return (m && (m[1] || m[2])) ? decodeHtmlEntities(m[1] || m[2]).trim() : "";
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseOpenGraph(html, pageUrl) {
  const title =
    readMetaContent(html, "property", "og:title") ||
    readMetaContent(html, "name", "twitter:title") ||
    (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim();
  const description =
    readMetaContent(html, "property", "og:description") ||
    readMetaContent(html, "name", "description") ||
    readMetaContent(html, "name", "twitter:description");
  const image = resolveUrl(
    readMetaContent(html, "property", "og:image") ||
      readMetaContent(html, "name", "twitter:image"),
    pageUrl
  );
  const siteName =
    readMetaContent(html, "property", "og:site_name") || new URL(pageUrl).hostname;

  if (!title && !description && !image) return null;

  return {
    url: pageUrl,
    title: title.slice(0, 140),
    description: description.slice(0, 220),
    image,
    siteName: siteName.slice(0, 80),
  };
}

export async function fetchLinkPreview(url, cache) {
  if (cache.has(url)) return cache.get(url);
  if (!isPreviewableUrl(url)) {
    cache.set(url, null);
    return null;
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    });
    if (!res.ok) {
      cache.set(url, null);
      return null;
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      cache.set(url, null);
      return null;
    }
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("utf-8", { fatal: false }).decode(
      buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf
    );
    const preview = parseOpenGraph(html, url);
    cache.set(url, preview);
    return preview;
  } catch {
    cache.set(url, null);
    return null;
  }
}

export function renderLinkPreviewCard(preview, escHtml) {
  if (!preview?.url) return "";
  const img = preview.image
    ? `<img class="link-preview-card__image" src="${escHtml(preview.image)}" alt="" loading="lazy" decoding="async" />`
    : "";
  const site = preview.siteName
    ? `<span class="link-preview-card__site">${escHtml(preview.siteName)}</span>`
    : "";
  const desc = preview.description
    ? `<span class="link-preview-card__desc">${escHtml(preview.description)}</span>`
    : "";
  return `<aside class="link-preview-card">
  <a class="link-preview-card__link" href="${escHtml(preview.url)}" target="_blank" rel="noopener noreferrer">${img}<span class="link-preview-card__body">${site}<span class="link-preview-card__title">${escHtml(preview.title || preview.url)}</span>${desc}</span></a>
</aside>`;
}

export async function appendPreviewsForUrls(urls, cache, escHtml, seen = new Set()) {
  let html = "";
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const preview = await fetchLinkPreview(url, cache);
    if (preview) html += renderLinkPreviewCard(preview, escHtml);
  }
  return html;
}

export async function enrichHtmlWithLinkPreviews(html, cache, escHtml) {
  if (!html?.trim()) return html || "";
  if (html.includes("link-preview-card")) return html;
  const urls = extractUrlsFromHtml(html);
  const cards = await appendPreviewsForUrls(urls, cache, escHtml);
  return cards ? `${html}\n${cards}` : html;
}

export async function appendPreviewsForPlainText(text, cache, escHtml) {
  const urls = extractUrlsFromPlainText(text);
  return appendPreviewsForUrls(urls, cache, escHtml);
}
