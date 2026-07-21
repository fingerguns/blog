/** Detect Spotify links in Thinking text so they can render as native embeds. */
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const SPOTIFY_TYPES = new Set(["track", "album", "playlist", "episode", "show", "artist"]);

/** Extract the entity type + id from a Spotify web URL, or null. */
export function parseSpotifyUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "open.spotify.com") return null;

  const segments = u.pathname.split("/").filter(Boolean);
  if (segments[0] && /^intl-[a-z]{2}$/i.test(segments[0])) segments.shift();

  const [type, id] = segments;
  if (!type || !id || !SPOTIFY_TYPES.has(type)) return null;
  if (!/^[A-Za-z0-9]{10,30}$/.test(id)) return null;

  return { type, id };
}

/** Ordered, de-duplicated list of Spotify embeds ({type, id}) found in plain post text. */
export function extractSpotifyEmbeds(text) {
  if (!text) return [];
  const seen = new Set();
  const embeds = [];
  for (const raw of String(text).match(URL_RE) || []) {
    const clean = raw.replace(/[.,;:!?)"']+$/, "");
    const parsed = parseSpotifyUrl(clean);
    if (!parsed) continue;
    const key = `${parsed.type}:${parsed.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    embeds.push(parsed);
  }
  return embeds;
}
