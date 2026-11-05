/**
 * List-item renderers for Writing, Reading and Sharing, shared by the build
 * and the live overlay (worker/live-overlay.mjs). Anything the build decides
 * from its own lookups — the affiliate link, the cover, the unfurl — is
 * passed in, so the Worker can supply the same values from D1.
 */
import { escHtml } from "../html.mjs";
import { safeSlug, stripHashtags, toETDate, linkDomain } from "./format.mjs";

export const renderPostItem = (p, absolute = false) =>
  `          <li>
            <span class="post-date">${escHtml(toETDate(p))}</span>
            <a href="${absolute ? `/posts/${escHtml(safeSlug(p.slug))}/` : `posts/${escHtml(safeSlug(p.slug))}/`}">${escHtml(p.title)}</a>
          </li>`;

/** `linkUrl` is the Bookshop affiliate link the build resolved for this book. */
export const renderReadingItem = (r, linkUrl) =>
  `          <li>
            <span class="post-date">${escHtml(r.ym)}</span>
            <a href="${escHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(r.title)}</a>
          </li>`;

export const renderReadingFavoriteItem = (r, linkUrl) => {
  const genreSlugs = Array.isArray(r.genres) ? r.genres.filter(Boolean) : [];
  const genreAttr = genreSlugs.length ? ` data-genres="${escHtml(genreSlugs.join(" "))}"` : "";
  return `          <li${genreAttr}>
            <a href="${escHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(r.title)}</a>
          </li>`;
};

// Reading grid: a storefront-style catalog — bigger cover art, two columns,
// grouped by month like the Thinking grid, title underneath linking out to
// the Bookshop.org page.
export function readingMonthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return "";
  const [, y, mo] = m;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(y), Number(mo) - 1, 1))
  );
}

export function readingGridItemHtml(r, cover, linkUrl, genres = []) {
  const coverInner = cover
    ? `<img src="${escHtml(cover)}" alt="${escHtml(r.title)}" loading="lazy" decoding="async" />`
    : `<span class="reading-grid-cover-fallback">${escHtml(r.title)}</span>`;
  const genreSlugs = Array.isArray(genres) ? genres.filter(Boolean) : [];
  const genreAttr = genreSlugs.length ? ` data-genres="${escHtml(genreSlugs.join(" "))}"` : "";
  return `          <a class="reading-grid-item"${genreAttr} href="${escHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">
    <span class="reading-grid-cover">${coverInner}</span>
    <span class="reading-grid-title">${escHtml(r.title)}</span>
  </a>`;
}

export function readingGridMonthHtml(label, tilesHtml) {
  return `      <section class="reading-grid-month">
        <h2 class="reading-grid-month-label">${escHtml(label)}</h2>
        <div class="reading-grid">
${tilesHtml}
        </div>
      </section>`;
}

export const renderLinklogItem = (l) => {
  const tagSlugs = Array.isArray(l.tags) ? l.tags.filter(Boolean) : [];
  const tagAttr = tagSlugs.length ? ` data-tags="${escHtml(tagSlugs.join(" "))}"` : "";
  return `          <li${tagAttr}>
            <span class="post-date">${escHtml(toETDate(l))}</span>
            <a href="${escHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escHtml(stripHashtags(l.title))}</a>
          </li>`;
};

/** `unfurl` is the link's build_cache "linklog-unfurls" entry, or null. */
export const renderLinklogArchiveItem = (l, unfurl) => {
  const tagSlugs = Array.isArray(l.tags) ? l.tags.filter(Boolean) : [];
  const tagAttr = tagSlugs.length ? ` data-tags="${escHtml(tagSlugs.join(" "))}"` : "";
  const title = stripHashtags(l.title);
  const domain = linkDomain(l.url);
  const sourceLabel = unfurl?.siteName || domain;
  // Unlike Spotify/YouTube thumbnails (stable CDNs) or Thinking/Reading media
  // (R2-native), these images are hotlinked straight from whatever site was
  // shared — if one goes away or starts blocking hotlinking, fail quietly
  // instead of showing a broken-image icon. A sturdier fix would download
  // and cache them into R2 at build time like other site media, but that
  // needs R2 write credentials the build environment doesn't have today
  // (only D1 access does) — worth revisiting if breakage becomes common.
  const imageHtml = unfurl?.image
    ? `<span class="linklog-card-thumb"><img src="${escHtml(unfurl.image)}" alt="" loading="lazy" onerror="this.parentElement.hidden=true" /></span>`
    : "";
  const descHtml = unfurl?.description
    ? `<span class="linklog-card-desc">${escHtml(unfurl.description)}</span>`
    : "";
  return `          <li${tagAttr}>
            <a class="linklog-card" href="${escHtml(l.url)}" target="_blank" rel="noopener noreferrer">
              ${imageHtml}
              <span class="linklog-card-body">
                <span class="linklog-card-title">${escHtml(title)}</span>
                ${descHtml}
                <span class="linklog-card-meta"><span class="post-date">${escHtml(toETDate(l))}</span>${sourceLabel ? ` · ${escHtml(sourceLabel)}` : ""}</span>
              </span>
            </a>
          </li>`;
};
