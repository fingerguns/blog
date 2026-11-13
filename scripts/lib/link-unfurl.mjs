/**
 * Fetch Open Graph preview data (title, image, description, site name) for an
 * arbitrary external URL, for rendering unfurled cards on the Sharing
 * archive page and beneath Thinking notes. Regex-based meta tag extraction — no HTML parser dependency,
 * good enough for the handful of standard tags we care about.
 */
const FETCH_TIMEOUT_MS = 8000;
const MAX_CONTENT_LENGTH = 3 * 1024 * 1024;

/**
 * Open Graph is meant for link-preview crawlers. A self-identified bot
 * (`fingergunsbot` alone) is 403'd by DataDome on news sites — NYTimes
 * included — so the on-site card never appears and the miss is cached as
 * `false`. Keep our name, and add Twitterbot, the token those gates
 * whitelist for preview fetches. Confirmed 2026-11-07: fingergunsbot alone
 * → 403; this string → 200 with og:title.
 */
export const LINK_UNFURL_USER_AGENT =
  "Mozilla/5.0 (compatible; fingergunsbot/1.0; +https://rommy.blog) Twitterbot/1.0";

/** Bumped when the fetch identity changes, so cached scraper-blocks refetch. */
export const UNFURL_FETCHER_ID = "twitterbot-1";

/** Not a URL; stored alongside unfurl entries so a fetcher bump can find it. */
export const UNFURL_FETCHER_CACHE_KEY = "__fetcher";

/**
 * Drop cached misses when the fetch identity has changed, so a site that
 * 403'd the old crawler is tried again. Hits stay. No-op once this fetcher
 * has already run against this cache.
 */
export function invalidateUnfurlMisses(cache, fetcherId = UNFURL_FETCHER_ID) {
  if (!cache || typeof cache !== "object") return cache;
  if (cache[UNFURL_FETCHER_CACHE_KEY] === fetcherId) return cache;
  for (const key of Object.keys(cache)) {
    if (isUnfurlMiss(cache[key])) delete cache[key];
  }
  cache[UNFURL_FETCHER_CACHE_KEY] = fetcherId;
  return cache;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => safeCodePoint(Number(n), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => safeCodePoint(parseInt(n, 16), m));
}

function safeCodePoint(n, fallback) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}

// A content value is matched up to its own closing quote, so an apostrophe
// inside a double-quoted value ("Don't Look Up") does not end it early.
const CONTENT_ATTR = `content=(?:"([^"]*)"|'([^']*)')`;

function metaTag(html, prop) {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+${CONTENT_ATTR}`, "i"),
    new RegExp(`<meta[^>]+${CONTENT_ATTR}[^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    const value = m && (m[1] ?? m[2]);
    if (value) return decodeEntities(value).trim();
  }
  return null;
}

function titleTag(html) {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const t = m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  return t || null;
}

/**
 * Pull the preview fields out of a fetched page. Returns {title, image,
 * description, siteName} (any may be null), or null if there is nothing to
 * show. Only an http(s) image survives, resolved against the page URL.
 */
export function parseLinkUnfurl(html, url) {
  const title = metaTag(html, "og:title") || metaTag(html, "twitter:title") || titleTag(html);
  const image = metaTag(html, "og:image") || metaTag(html, "twitter:image");
  const description = metaTag(html, "og:description") || metaTag(html, "description");
  const siteName = metaTag(html, "og:site_name");

  let absoluteImage = null;
  if (image) {
    try {
      const resolved = new URL(image, url);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") {
        absoluteImage = resolved.toString();
      }
    } catch {
      absoluteImage = null;
    }
  }

  if (!absoluteImage && !description && !title) return null;

  return {
    title: title ? title.slice(0, 200) : null,
    image: absoluteImage,
    description: description ? description.slice(0, 280) : null,
    siteName: siteName || null,
  };
}

/**
 * Fetch `url` and parse it. Returns `{ unfurl }` on success, or `{ miss }`
 * naming why there is no card — `http-<status>` (a 403 is usually a bot
 * gate), `not-html`, `too-large`, `timeout`, `network`, or `no-preview` (the
 * page loaded but carried nothing to show). The reason is stored with the
 * cached miss, so a link that never unfurled can be diagnosed from D1
 * instead of re-fetched to find out.
 */
export async function fetchLinkUnfurlResult(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": LINK_UNFURL_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return { miss: `http-${res.status}` };

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html")) return { miss: "not-html" };
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > MAX_CONTENT_LENGTH) return { miss: "too-large" };

    const html = await res.text();
    const unfurl = parseLinkUnfurl(html, res.url || url);
    return unfurl ? { unfurl } : { miss: "no-preview" };
  } catch (err) {
    return { miss: err?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch `url` and parse it with parseLinkUnfurl; null on any failure. */
export async function fetchLinkUnfurl(url) {
  return (await fetchLinkUnfurlResult(url)).unfurl || null;
}

/**
 * What to store in an unfurl cache for a fetch result: the card data, or a
 * miss with its reason and when it happened. Misses written before reasons
 * were kept are a bare `false`; both are misses to every reader.
 */
export function unfurlCacheValue(result, now = new Date()) {
  return result?.unfurl || { miss: result?.miss || "unknown", at: now.toISOString() };
}

/** Whether a cached unfurl value records a failed fetch. */
export function isUnfurlMiss(value) {
  return value === false || Boolean(value && typeof value === "object" && "miss" in value);
}

/** The card data in a cached unfurl value, or null for a miss or no entry. */
export function unfurlHit(value) {
  return value && typeof value === "object" && !("miss" in value) ? value : null;
}

// Publications whose names don't read well as a bare domain. Anything not
// listed shows its domain, as the cards always have.
const SITE_NAMES = {
  "reuters.com": "Reuters",
  "apnews.com": "AP News",
  "nytimes.com": "The New York Times",
  "washingtonpost.com": "The Washington Post",
  "wsj.com": "The Wall Street Journal",
  "ft.com": "Financial Times",
  "bloomberg.com": "Bloomberg",
  "theguardian.com": "The Guardian",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "theatlantic.com": "The Atlantic",
  "newyorker.com": "The New Yorker",
  "npr.org": "NPR",
  "cnn.com": "CNN",
  "politico.com": "Politico",
  "axios.com": "Axios",
  "economist.com": "The Economist",
};

/** A publication's name for a link, or null if it is not one we know. */
export function knownSiteName(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  for (const [domain, name] of Object.entries(SITE_NAMES)) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return null;
}

// Kept upper-case when a title is rebuilt from a URL slug. Everything else
// is sentence case: a slug has lost its capitals, and guessing proper nouns
// would print wrong ones.
const SLUG_ACRONYMS = new Set([
  "ai", "doj", "fbi", "cia", "nsa", "irs", "sec", "fda", "cdc", "epa", "ice", "gop", "us", "usa", "uk", "eu",
  "un", "nato", "nyc", "nypd", "la", "dc", "ceo", "cfo", "gdp", "nba", "nfl", "mlb", "nhl", "tv", "uk's", "us's",
]);

// The ends of contractions a slug splits off as words of their own, its
// apostrophe dropped: "it-s", "don-t", "we-ll". "d" is left out on purpose,
// since "vitamin-d" is far likelier than "i-d".
const SLUG_CONTRACTION_ENDINGS = new Set(["s", "t", "m", "ll", "re", "ve"]);

/** ["it", "s", "working"] → ["it’s", "working"]: rejoin a slug's contractions. */
function joinSlugContractions(words) {
  const out = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && SLUG_CONTRACTION_ENDINGS.has(w.toLowerCase()) && /^[\p{L}]+$/u.test(prev)) {
      out[out.length - 1] = `${prev}’${w}`;
    } else {
      out.push(w);
    }
  }
  return out;
}

/**
 * A minimal card for a link whose page could not be read: the publication
 * and a title rebuilt from the URL's last path segment, with no image or
 * description. Only when that segment reads as words — at least three, most
 * of them alphabetic — so an id or hash never becomes a "title". Returns
 * null otherwise, and the link stays a plain link.
 *
 *   https://www.reuters.com/world/trump-orders-doj-look-into-democrats-threatening-people-2026-11-07/
 *   → { siteName: "Reuters", title: "Trump orders DOJ look into democrats threatening people" }
 */
export function fallbackUnfurlFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  let slug = segments[segments.length - 1] || "";
  try {
    slug = decodeURIComponent(slug);
  } catch {
    return null;
  }
  slug = slug
    .replace(/\.(s?html?|php|aspx?)$/i, "")
    .replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}$/, "") // trailing date: -2026-11-07
    .replace(/[-_](?=[a-z0-9]*\d)[a-z0-9]{6,}$/i, "") // trailing id with digits: -idUSKBN2A1B3C
    .replace(/[-_]\d+$/, ""); // trailing number
  const words = slug.split(/[-_+\s]+/).filter(Boolean);
  const wordy = words.filter((w) => /^[\p{L}'’]+$/u.test(w));
  if (words.length < 3 || wordy.length / words.length < 0.75) return null;
  const title = joinSlugContractions(words)
    .map((w, i) => {
      const lower = w.toLowerCase();
      const [stem, ending] = lower.split("’");
      if (SLUG_ACRONYMS.has(stem)) return ending === undefined ? stem.toUpperCase() : `${stem.toUpperCase()}’${ending}`;
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ")
    .slice(0, 200);
  const host = parsed.hostname.replace(/^www\./, "");
  return { title, image: null, description: null, siteName: knownSiteName(url) || host, fallback: true };
}
