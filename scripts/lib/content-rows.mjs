/**
 * How content rows are read out of D1 and shaped for the renderers — shared
 * by the build (scripts/d1-client.mjs, over the HTTP API) and the live overlay
 * (worker/live-overlay.mjs, over the D1 binding), so both hand the renderers
 * identical objects.
 */

export const CONTENT_COLUMNS = {
  thinking:
    "slug, text, media_url, media_alt, media_type, media_urls, content_html, datetime, microblog_url, location_label",
  post: "slug, title, summary, body_html, date, datetime, created_at, updated_at",
  reading: "id, ym, title, url, added_at, cover_url, author",
  favorite: "id, title, url, added_at, cover_url, author",
  linklog: "id, url, title, date, datetime, tags",
};

/** Parse media_urls JSON; fall back to single media_url for legacy rows. */
export function parseMediaUrls(raw, mediaUrl) {
  if (raw) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) {
        return parsed.filter((u) => typeof u === "string" && u).slice(0, 4);
      }
    } catch {
      /* ignore */
    }
  }
  if (mediaUrl) return [mediaUrl];
  return [];
}

export const shapeThinkingRow = (r) => ({
  slug: r.slug,
  text: r.text || "",
  media_url: r.media_url || "",
  media_alt: r.media_alt || "",
  media_type: r.media_type || "",
  media_urls: parseMediaUrls(r.media_urls, r.media_url),
  content_html: r.content_html || "",
  datetime: r.datetime,
  microblog_url: r.microblog_url || "",
  location_label: r.location_label || "",
});

export const shapePostRow = (p) => ({
  slug: p.slug,
  title: p.title,
  summary: p.summary,
  body_html: p.body_html,
  date: p.date,
  datetime: p.datetime,
});

export const shapeReadingRow = (r) => ({
  id: r.id,
  ym: r.ym,
  title: r.title,
  url: r.url,
  added_at: r.added_at,
  cover_url: r.cover_url || "",
  author: r.author || "",
});

export const shapeFavoriteRow = (r, genres = []) => ({
  id: r.id,
  title: r.title,
  url: r.url,
  added_at: r.added_at,
  cover_url: r.cover_url || "",
  author: r.author || "",
  genres,
});

export const shapeLinklogRow = (l) => ({
  id: l.id,
  url: l.url,
  title: l.title,
  date: l.date,
  datetime: l.datetime,
  tags: (l.tags || "").split(/\s+/).filter(Boolean),
});
