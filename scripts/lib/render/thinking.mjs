/**
 * Thinking renderers, shared by the build (scripts/build.mjs) and the live
 * overlay in the Worker (worker/live-overlay.mjs), so a note placed on a page
 * before the rebuild is byte-for-byte the note the rebuild will write.
 *
 * Everything here is pure: no Node built-ins, no module-level state. What
 * the build used to read from its own scope arrives as a context object:
 *
 *   ctx.base              site origin, no trailing slash
 *   ctx.thinkingUnfurls   build_cache "thinking-unfurls"   { url: unfurl|false }
 *   ctx.spotifyThumbnails build_cache "spotify-thumbnails" { "type:id": url }
 *   ctx.videoPosters      build_cache "video-posters"      { videoSrc: bool }
 *   ctx.photoSize(url)    {width, height} | null, from "thinking-photo-sizes"
 */
import { escHtml } from "../html.mjs";
import { renderThinkingContentHtml, unfurlableUrls } from "../thinking-html.mjs";
import { thinkingGridThumbUrl, videoPosterKeyFromVideoUrl } from "../media-url.mjs";
import { thinkingSlugFromIso } from "../thinking-slug.mjs";
import { formatMbDate, stripHtml, linkDomain } from "./format.mjs";
import { fallbackUnfurlFromUrl, isUnfurlMiss, unfurlHit } from "../link-unfurl.mjs";

export function firstImageFromHtml(html) {
  const m = String(html || "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

export function thinkingSnippet(text, max = 160) {
  const plain = String(text || "").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

// Grid thumbnails: extract the post's photo (src + alt) from its rendered content_html
export function imageSrcAltFromHtml(html) {
  const str = String(html || "");
  const srcM = str.match(/<img[^>]+src=["']([^"']+)["']/i);
  const altM = str.match(/<img[^>]+alt=["']([^"']*)["']/i);
  return { src: srcM ? srcM[1] : "", alt: altM ? altM[1] : "" };
}

// Native video posts render as <video class="thinking-video"> — pull the src so
// the grid can show the first frame as a thumbnail instead of a text card.
export function videoSrcFromHtml(html) {
  const str = String(html || "");
  const m =
    str.match(/<video[^>]+class=["'][^"']*thinking-video[^"']*["'][^>]+src=["']([^"']+)["']/i) ||
    str.match(/<video[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*thinking-video[^"']*["']/i);
  if (!m) return "";
  return m[1].replace(/#t=0\.001$/, "");
}

export function spotifyEmbedFromHtml(html) {
  const str = String(html || "");
  const m = str.match(
    /open\.spotify\.com\/embed\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/i
  );
  if (!m) return null;
  return { type: m[1].toLowerCase(), id: m[2] };
}

export function youtubeIdFromHtml(html) {
  const str = String(html || "");
  const m =
    str.match(/youtube-nocookie\.com\/embed\/([\w-]{11})/i) ||
    str.match(/youtube\.com\/embed\/([\w-]{11})/i);
  return m ? m[1] : null;
}

export function youtubeThumbnailUrl(id, base) {
  return thinkingGridThumbUrl(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, base);
}

// "July 2026" in ET, used to group Thinking grid items by month
export function monthLabelET(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(d);
}

// Grid thumbnails: which non-photo media (if any) a post's rendered
// content_html contains, so the text card can show a small icon badge.
export function thinkingMediaKind(html) {
  const str = String(html || "");
  if (/class="thinking-video"/.test(str)) return "video";
  if (/class="thinking-audio"/.test(str)) return "audio";
  if (/class="thinking-youtube"/.test(str)) return "youtube";
  if (/class="thinking-spotify/.test(str)) return "spotify";
  return "";
}

// Strip media elements (video/audio/embeds) out of content_html before
// computing a text snippet, so their fallback inner text (e.g. "Video")
// never leaks into the grid card when there's no caption.
export function stripMediaMarkup(html) {
  return String(html || "")
    .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, "")
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, "")
    .replace(/<div class="thinking-youtube">[\s\S]*?<\/div>/gi, "")
    .replace(/<div class="thinking-spotify[^"]*">[\s\S]*?<\/div>/gi, "");
}

// Small icon badges for the grid's text-preview cards, indicating the kind
// of media attached (generic play/mic glyphs; brand marks for YouTube/Spotify).
export const THINKING_MEDIA_ICONS = {
  photo: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><path d="M6.25 10a1.25 1.25 0 0 1 1.25-1.25h9a1.25 1.25 0 0 1 1.25 1.25v5.25a1.25 1.25 0 0 1-1.25 1.25h-9A1.25 1.25 0 0 1 6.25 15.25V10z" style="fill:var(--bg)"/><path d="M9.25 10V8.35h3.45l.95 1.65H9.25z" style="fill:var(--bg)"/><circle cx="12" cy="13.25" r="3.35" style="fill:var(--text)"/><circle cx="12" cy="13.25" r="1.45" style="fill:var(--bg)"/></svg>`,
  video: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><rect x="6" y="8.5" width="9" height="7" rx="1.3" style="fill:var(--bg)"/><path d="M15 10 L19.5 8 L19.5 16 L15 14 Z" style="fill:var(--bg)"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><path d="M12 6.5a2.25 2.25 0 0 1 2.25 2.25v3a2.25 2.25 0 0 1-4.5 0v-3A2.25 2.25 0 0 1 12 6.5z" style="fill:var(--bg)"/><path d="M8.25 11.75a3.75 3.75 0 0 0 7.5 0M12 15.5v2M10 17.5h4" style="fill:none;stroke:var(--bg);stroke-width:1.1;stroke-linecap:round"/></svg>`,
  youtube: `<svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" rx="5" fill="#FF0000"/><path d="M11 6.2 19 10l-8 3.8V6.2z" fill="#fff"/></svg>`,
  spotify: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954"/><path d="M6.5 9.7c3.4-1 7.2-.8 10.1.9M7.3 12.6c2.8-.8 6-.6 8.4.7M8.1 15.4c2.3-.6 4.9-.5 6.8.6" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`,
  text: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" font-family="Georgia,'Times New Roman',serif" style="fill:var(--bg)">Tt</text></svg>`,
};

export const THINKING_GRID_KINDS = ["photo", "video", "youtube", "spotify", "audio", "text"];

export function thinkingGridKind(item, spotifyThumbnails = {}) {
  if (imageSrcAltFromHtml(item.content_html).src) return "photo";
  if (videoSrcFromHtml(item.content_html)) return "video";
  const spotifyEmbed = spotifyEmbedFromHtml(item.content_html);
  if (spotifyEmbed) {
    const key = `${spotifyEmbed.type}:${spotifyEmbed.id}`;
    if (spotifyThumbnails[key]) return "spotify";
  }
  if (youtubeIdFromHtml(item.content_html)) return "youtube";
  const mediaKind = thinkingMediaKind(item.content_html);
  if (mediaKind) return mediaKind;
  return "text";
}

export function thinkingGridBadgeHtml(kind) {
  const icon = THINKING_MEDIA_ICONS[kind];
  if (!icon) return "";
  return `<span class="thinking-grid-icon thinking-grid-icon--${kind}" aria-hidden="true">${icon}</span>`;
}

/** A D1 thinking_posts row (as d1-client.mjs shapes it) rendered to note HTML. */
export function thinkingContentHtmlFromRow(p, ctx, options = {}) {
  const fromSource = renderThinkingContentHtml(
    p.text,
    p.media_url,
    p.media_alt,
    p.media_type,
    ctx.base,
    { ...options, mediaUrls: p.media_urls || [], photoSize: ctx.photoSize }
  );
  if (fromSource) return fromSource;
  return p.content_html || "";
}

/** The shape the list, grid and permalink renderers take. */
export function thinkingItemFromRow(p, ctx) {
  return {
    _slug: p.slug,
    _text: p.text || "",
    content_html: thinkingContentHtmlFromRow(p, ctx),
    date_published: p.datetime,
    url: p.microblog_url || "",
    media_type: p.media_type || "",
    location_label: p.location_label || "",
  };
}

export const thinkingSlug = (item) => item._slug || thinkingSlugFromIso(item.date_published);

export function thinkingUnfurlCardHtml(url, ctx) {
  // A page that could not be read still gets a card when its URL says what
  // it is (fallbackUnfurlFromUrl); one not fetched yet gets none.
  const cached = ctx.thinkingUnfurls[url];
  const unfurl = unfurlHit(cached) || (isUnfurlMiss(cached) ? fallbackUnfurlFromUrl(url) : null);
  if (!unfurl) return "";
  const domain = linkDomain(url);
  const title = unfurl.title || domain || url;
  const sourceLabel = unfurl.siteName || domain;
  // Hotlinked like the Sharing cards: an image that fails hides its slot.
  const imageHtml = unfurl.image
    ? `<span class="linklog-card-thumb"><img src="${escHtml(unfurl.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.hidden=true" /></span>`
    : "";
  const descHtml = unfurl.description
    ? `<span class="linklog-card-desc">${escHtml(unfurl.description)}</span>`
    : "";
  const metaHtml =
    sourceLabel && sourceLabel !== title ? `<span class="linklog-card-meta">${escHtml(sourceLabel)}</span>` : "";
  return `<a class="linklog-card" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${imageHtml}<span class="linklog-card-body">${metaHtml}<span class="linklog-card-title">${escHtml(title)}</span>${descHtml}</span></a>`;
}

/** Preview cards for the links in a note's text; "" when there are none. */
export function thinkingUnfurlsHtml(text, ctx) {
  const cards = unfurlableUrls(text).map((url) => thinkingUnfurlCardHtml(url, ctx)).filter(Boolean);
  return cards.length ? `<div class="thinking-unfurls">${cards.join("")}</div>` : "";
}

/** The homepage (and /now/) blurb: the latest note's body and its cards. */
export function renderThinkingHtml(thinking, ctx) {
  const inner = renderThinkingContentHtml(
    thinking?.text,
    thinking?.media_url,
    thinking?.media_alt,
    thinking?.media_type,
    ctx.base,
    { mediaUrls: thinking?.media_urls || [], photoSize: ctx.photoSize }
  );
  if (!inner) return "";
  return `<div class="microblog-body">${inner}</div>${thinkingUnfurlsHtml(thinking?.text, ctx)}`;
}

export function hasThinking(thinking) {
  return !!(
    thinking &&
    ((thinking.text || "").trim() ||
      thinking.media_url ||
      (Array.isArray(thinking.media_urls) && thinking.media_urls.length))
  );
}

export function googleMapsNeighborhoodUrl(label) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
}

export function thinkingPostLocationHtml(item) {
  const label = String(item.location_label || "").trim();
  if (!label) return "";
  const mapsUrl = googleMapsNeighborhoodUrl(label);
  return `<span class="post-meta-sep" aria-hidden="true">·</span><a class="post-location" href="${escHtml(mapsUrl)}" target="_blank" rel="noopener">${escHtml(label)}</a>`;
}

export function thinkingPostMetaHtml(item, slug) {
  return `<p class="post-meta"><time class="post-date" datetime="${escHtml(item.date_published)}"><a href="/thinking/${escHtml(slug)}/">${escHtml(formatMbDate(item.date_published))}</a></time>${thinkingPostLocationHtml(item)}</p>`;
}

/** One note in the /thinking/ list view. */
export function thinkingListEntryHtml(item, ctx) {
  const slug = thinkingSlug(item);
  const kind = thinkingGridKind(item, ctx.spotifyThumbnails);
  return `        <div class="microblog-entry" data-slug="${escHtml(slug)}" data-kind="${escHtml(kind)}" data-microblog-url="${escHtml(item.url || "")}">
          <div class="microblog-body">${item.content_html}</div>${thinkingUnfurlsHtml(item._text, ctx)}
          ${thinkingPostMetaHtml(item, slug)}
        </div>`;
}

// Grid view: same items, grouped by month, one square thumbnail per post
// (photo or video frame when present, else a small text-preview card).
export function thinkingGridItemHtml(item, ctx) {
  const { base, spotifyThumbnails = {}, videoPosters = {} } = ctx;
  const slug = thinkingSlug(item);
  const href = `/thinking/${escHtml(slug)}/`;
  const label = escHtml(formatMbDate(item.date_published));
  const kind = thinkingGridKind(item, spotifyThumbnails);
  const { src, alt } = imageSrcAltFromHtml(item.content_html);
  if (kind === "photo" && src) {
    const thumb = thinkingGridThumbUrl(src, base);
    return `          <a class="thinking-grid-item thinking-grid-photo" data-kind="photo" href="${href}" aria-label="${label}">
            <img data-src="${escHtml(thumb)}" alt="${escHtml(alt || "Photo")}" width="126" height="126" decoding="async" />
            ${thinkingGridBadgeHtml("photo")}
          </a>`;
  }
  if (kind === "video") {
    const videoSrc = videoSrcFromHtml(item.content_html);
    const posterKey = videoPosterKeyFromVideoUrl(videoSrc, base);
    if (posterKey && videoPosters[videoSrc]) {
      const thumb = thinkingGridThumbUrl(`${base}/media/${posterKey}`, base);
      return `          <a class="thinking-grid-item thinking-grid-video" data-kind="video" href="${href}" aria-label="${label}">
            <img data-src="${escHtml(thumb)}" alt="" width="126" height="126" decoding="async" />
            ${thinkingGridBadgeHtml("video")}
          </a>`;
    }
    return `          <a class="thinking-grid-item thinking-grid-video thinking-grid-video--placeholder" data-kind="video" href="${href}" aria-label="${label}">
            ${thinkingGridBadgeHtml("video")}
          </a>`;
  }
  if (kind === "spotify") {
    const spotifyEmbed = spotifyEmbedFromHtml(item.content_html);
    const cover = spotifyThumbnails[`${spotifyEmbed.type}:${spotifyEmbed.id}`];
    if (cover) {
      const thumb = thinkingGridThumbUrl(cover, base);
      return `          <a class="thinking-grid-item thinking-grid-spotify" data-kind="spotify" href="${href}" aria-label="${label}">
            <img data-src="${escHtml(thumb)}" alt="" width="126" height="126" decoding="async" />
            ${thinkingGridBadgeHtml("spotify")}
          </a>`;
    }
  }
  if (kind === "youtube") {
    const youtubeId = youtubeIdFromHtml(item.content_html);
    return `          <a class="thinking-grid-item thinking-grid-youtube" data-kind="youtube" href="${href}" aria-label="${label}">
            <img data-src="${escHtml(youtubeThumbnailUrl(youtubeId, base))}" alt="" width="126" height="126" decoding="async" />
            ${thinkingGridBadgeHtml("youtube")}
      </a>`;
  }
  const snippet =
    thinkingSnippet(stripHtml(stripMediaMarkup(item.content_html)), 280) || "(No text)";
  return `          <a class="thinking-grid-item thinking-grid-text" data-kind="${escHtml(kind)}" href="${href}" aria-label="${label}">
            <span class="thinking-grid-text-body">${escHtml(snippet)}</span>${thinkingGridBadgeHtml(kind)}
          </a>`;
}

/** One month of the grid view: its heading and the tiles under it. */
/**
 * `groupSort`, when given, marks the month for the live overlay: the section
 * carries its place among months and the grid inside is a live list.
 */
export function thinkingGridMonthHtml(label, tilesHtml, groupSort = null) {
  const sectionAttrs =
    groupSort == null ? "" : ` data-live-group="${escHtml(label)}" data-live-group-sort="${escHtml(groupSort)}"`;
  const gridAttrs =
    groupSort == null ? "" : ` data-live-list="thinking-grid" data-live-group="${escHtml(label)}"`;
  return `      <section class="thinking-grid-month"${sectionAttrs}>
        <h2 class="thinking-grid-month-label">${escHtml(label)}</h2>
        <div class="thinking-grid"${gridAttrs}>
${tilesHtml}
        </div>
      </section>`;
}
