/**
 * List-item renderers for Writing, Reading and Sharing, shared by the build
 * and the live overlay (worker/live-overlay.mjs). Anything the build decides
 * from its own lookups — the affiliate link, the cover, the unfurl — is
 * passed in, so the Worker can supply the same values from D1.
 */
import { escHtml } from "../html.mjs";
import { safeSlug, stripHashtags, toETDate, linkDomain, readingMins, formatDayMonthYear, formatMonthYear } from "./format.mjs";
import { knownSiteName, unfurlHit } from "../link-unfurl.mjs";
import { parseYouTubeUrl } from "../youtube.mjs";

/**
 * A YouTube video's thumbnail, built from its id — YouTube serves one for
 * every video, so a link whose preview fetch failed (YouTube rate-limits
 * scrapers with 429s) still gets its picture. mqdefault is 16:9 with no
 * letterbox bars, unlike hqdefault.
 */
export function youtubeLinkThumbnail(url) {
  const yt = parseYouTubeUrl(url);
  return yt ? `https://i.ytimg.com/vi/${yt.id}/mqdefault.jpg` : "";
}

/**
 * `withBody` is for the /writing/ archive: the post rides along in a
 * <template>, which the browser parses but never renders or fetches media
 * for, so the collapsed list costs nothing extra to display. The archive's
 * expanded (feed) view clones it into place on demand. Its header copies the
 * permalink's (postPageHtml in scripts/build.mjs): the title at the same
 * size, then the date with the read time opposite; the view count is added
 * client-side from /api/views?kind=posts, as the Worker adds it there.
 */
export const renderPostItem = (p, absolute = false, { withBody = false } = {}) => {
  const href = absolute ? `/posts/${escHtml(safeSlug(p.slug))}/` : `posts/${escHtml(safeSlug(p.slug))}/`;
  const date = escHtml(toETDate(p));
  const shown = escHtml(formatDayMonthYear(p));
  return `          <li>
            <span class="post-date">${shown}</span>
            <a href="${href}">${escHtml(p.title)}</a>${
              withBody && p.body_html ? `
            <template class="post-feed-body"><h2 class="post-feed-title"><a href="${href}">${escHtml(p.title)}</a></h2><time class="post-feed-time" datetime="${date}"><span>${shown}</span><span class="reading-time">${readingMins(p.body_html)} min read</span></time><div class="body">${p.body_html}</div></template>` : ""
            }
          </li>`;
};

/** `linkUrl` is the Bookshop affiliate link the build resolved for this book. */
export const renderReadingItem = (r, linkUrl) =>
  `          <li>
            <span class="post-date">${escHtml(formatMonthYear(r.ym))}</span>
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

/**
 * `groupSort`, when given, marks the month for the live overlay: the section
 * carries its place among months and the grid inside is a live list.
 */
export function readingGridMonthHtml(label, tilesHtml, groupSort = null) {
  const sectionAttrs =
    groupSort == null ? "" : ` data-live-group="${escHtml(label)}" data-live-group-sort="${escHtml(groupSort)}"`;
  const gridAttrs =
    groupSort == null ? "" : ` data-live-list="reading-grid" data-live-group="${escHtml(label)}"`;
  return `      <section class="reading-grid-month"${sectionAttrs}>
        <h2 class="reading-grid-month-label">${escHtml(label)}</h2>
        <div class="reading-grid"${gridAttrs}>
${tilesHtml}
        </div>
      </section>`;
}

export const renderLinklogItem = (l) => {
  const tagSlugs = Array.isArray(l.tags) ? l.tags.filter(Boolean) : [];
  const tagAttr = tagSlugs.length ? ` data-tags="${escHtml(tagSlugs.join(" "))}"` : "";
  return `          <li${tagAttr}>
            <span class="post-date">${escHtml(formatDayMonthYear(l))}</span>
            <a href="${escHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escHtml(stripHashtags(l.title))}</a>
          </li>`;
};

/**
 * `cached` is the link's build_cache "linklog-unfurls" entry: card data, a
 * miss (`false` or `{ miss }`), or null. A miss still renders a card — the
 * link's own title is always there — named by publication when known.
 */
export const renderLinklogArchiveItem = (l, cached) => {
  const unfurl = unfurlHit(cached);
  const tagSlugs = Array.isArray(l.tags) ? l.tags.filter(Boolean) : [];
  const tagAttr = tagSlugs.length ? ` data-tags="${escHtml(tagSlugs.join(" "))}"` : "";
  const title = stripHashtags(l.title);
  const domain = linkDomain(l.url);
  const sourceLabel = unfurl?.siteName || knownSiteName(l.url) || domain;
  // Unlike Spotify/YouTube thumbnails (stable CDNs) or Thinking/Reading media
  // (R2-native), these images are hotlinked straight from whatever site was
  // shared — if one goes away or starts blocking hotlinking, fail quietly
  // instead of showing a broken-image icon. A sturdier fix would download
  // and cache them into R2 at build time like other site media, but that
  // needs R2 write credentials the build environment doesn't have today
  // (only D1 access does) — worth revisiting if breakage becomes common.
  // Grid view gives a card with no picture its source's name, set large in
  // the picture's place (.linklog-card-name, hidden in list view). With a
  // picture it waits hidden, and takes over if the picture fails to load.
  // A YouTube link always has a picture: the preview's, else (or if that one
  // fails to load) the thumbnail built from the video id.
  const ytThumb = youtubeLinkThumbnail(l.url);
  const image = unfurl?.image || ytThumb;
  const fallbackAttr = ytThumb && image !== ytThumb ? ` data-fallback="${escHtml(ytThumb)}"` : "";
  const imageHtml = image
    ? `<span class="linklog-card-thumb"><img src="${escHtml(image)}"${fallbackAttr} alt="" loading="lazy" onerror="var f=this.getAttribute('data-fallback');if(f){this.removeAttribute('data-fallback');this.src=f;return;}var t=this.parentElement;t.hidden=true;if(t.nextElementSibling)t.nextElementSibling.hidden=false" /></span>`
    : "";
  const nameHtml = sourceLabel
    ? `<span class="linklog-card-name" aria-hidden="true"${imageHtml ? " hidden" : ""}><span>${escHtml(sourceLabel)}</span></span>`
    : "";
  const descHtml = unfurl?.description
    ? `<span class="linklog-card-desc">${escHtml(unfurl.description)}</span>`
    : "";
  return `          <li${tagAttr}>
            <a class="linklog-card" href="${escHtml(l.url)}" target="_blank" rel="noopener noreferrer">
              ${imageHtml}${nameHtml}
              <span class="linklog-card-body">
                <span class="linklog-card-meta"><span class="post-date">${escHtml(formatDayMonthYear(l))}</span>${sourceLabel ? ` · ${escHtml(sourceLabel)}` : ""}</span>
                <span class="linklog-card-title">${escHtml(title)}</span>
                ${descHtml}
              </span>
            </a>
          </li>`;
};

// Sharing archive months. A link's month comes from its datetime (else noon
// on its date), in US Eastern time like every other date on the site.
function linklogMoment(l) {
  const d = l?.datetime ? new Date(l.datetime) : new Date(`${l?.date}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "November 2026": the heading a link files under on /sharing/. */
export function linklogMonthLabel(l) {
  const d = linklogMoment(l);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(d);
}

/** "2026-11": the month's place among months, for the live overlay. */
export function linklogMonthKey(l) {
  const d = linklogMoment(l);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(d);
}

/**
 * One month of the Sharing archive: a heading over that month's cards. The
 * same markup serves list and grid view (the grid is CSS on the wrapper), and
 * `groupSort`, when given, marks the month for the live overlay as the grids
 * do, so a link shared in a new month grows its own section.
 */
export function linklogMonthHtml(label, itemsHtml, groupSort = null) {
  const sectionAttrs =
    groupSort == null ? "" : ` data-live-group="${escHtml(label)}" data-live-group-sort="${escHtml(groupSort)}"`;
  const listAttrs =
    groupSort == null ? "" : ` data-live-list="linklog" data-live-group="${escHtml(label)}"`;
  return `      <section class="linklog-month"${sectionAttrs}>
        <h2 class="linklog-month-label">${escHtml(label)}</h2>
        <ol class="post-list linklog-archive-list"${listAttrs}>
${itemsHtml}
        </ol>
      </section>`;
}
