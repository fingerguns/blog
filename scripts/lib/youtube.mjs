/** Detect YouTube links in Thinking text so they can render as native embeds. */
const URL_RE = /https?:\/\/[^\s<>"]+/g;

function parseYouTubeTime(raw) {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || !(m[1] || m[2] || m[3])) return 0;
  const [, h, mnt, s] = m;
  return parseInt(h || 0, 10) * 3600 + parseInt(mnt || 0, 10) * 60 + parseInt(s || 0, 10);
}

/** Extract the 11-char video id + optional start-time (seconds) from a YouTube URL, or null. */
export function parseYouTubeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id = "";
  if (host === "youtu.be") {
    id = u.pathname.slice(1).split("/")[0];
  } else if (host === "youtube.com") {
    if (u.pathname === "/watch") {
      id = u.searchParams.get("v") || "";
    } else if (u.pathname.startsWith("/shorts/")) {
      id = u.pathname.slice("/shorts/".length).split("/")[0];
    } else if (u.pathname.startsWith("/embed/")) {
      id = u.pathname.slice("/embed/".length).split("/")[0];
    } else if (u.pathname.startsWith("/live/")) {
      id = u.pathname.slice("/live/".length).split("/")[0];
    } else {
      return null;
    }
  } else {
    return null;
  }
  if (!/^[\w-]{11}$/.test(id)) return null;
  const start = parseYouTubeTime(u.searchParams.get("t") || u.searchParams.get("start") || "");
  return { id, start };
}

/** Ordered, de-duplicated list of YouTube embeds ({id, start}) found in plain post text. */
export function extractYouTubeEmbeds(text) {
  if (!text) return [];
  const seen = new Set();
  const embeds = [];
  for (const raw of String(text).match(URL_RE) || []) {
    const clean = raw.replace(/[.,;:!?)"']+$/, "");
    const parsed = parseYouTubeUrl(clean);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    embeds.push(parsed);
  }
  return embeds;
}
