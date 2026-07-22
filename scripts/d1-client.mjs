/**
 * Query Cloudflare D1 from Node.js (build script, migration).
 * Requires env: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID
 */

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const DATABASE_ID = process.env.CF_D1_DATABASE_ID;

export function d1Configured() {
  return Boolean(ACCOUNT_ID && API_TOKEN && DATABASE_ID);
}

export async function d1Query(sql, params = []) {
  if (!d1Configured()) {
    throw new Error("D1 not configured (CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID)");
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );

  const data = await res.json();
  if (!res.ok || !data.success) {
    const msg = data.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`D1 query failed: ${msg}`);
  }

  return data.result?.[0]?.results ?? [];
}

/** Parse media_urls JSON; fall back to single media_url for legacy rows. */
function parseMediaUrls(raw, mediaUrl) {
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

export async function d1Batch(statements) {
  if (!d1Configured()) {
    throw new Error("D1 not configured");
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(statements.map(({ sql, params = [] }) => ({ sql, params }))),
    }
  );

  const data = await res.json();
  if (!res.ok || !data.success) {
    const msg = data.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`D1 batch failed: ${msg}`);
  }

  return data.result;
}

/** Load all blog content from D1 into the shape build.mjs expects. */
export async function loadBlogDataFromD1() {
  const siteRows = await d1Query("SELECT key, value FROM site_config");
  const site = {};
  for (const row of siteRows) {
    try {
      site[row.key] = JSON.parse(row.value);
    } catch {
      site[row.key] = row.value;
    }
  }

  const posts = await d1Query(
    "SELECT slug, title, summary, body_html, date, datetime, created_at, updated_at FROM posts ORDER BY datetime DESC"
  );

  const reading = await d1Query(
    "SELECT id, ym, title, url, added_at, cover_url FROM reading ORDER BY added_at DESC, id ASC"
  );

  const linklog = await d1Query(
    "SELECT url, title, date, datetime FROM linklog ORDER BY datetime DESC"
  );

  const thinkingPostRows = await d1Query(
    "SELECT slug, text, media_url, media_alt, media_type, media_urls, content_html, datetime, microblog_url FROM thinking_posts ORDER BY datetime DESC"
  );
  const thinkingPosts = thinkingPostRows.map((r) => ({
    slug: r.slug,
    text: r.text || "",
    media_url: r.media_url || "",
    media_alt: r.media_alt || "",
    media_type: r.media_type || "",
    media_urls: parseMediaUrls(r.media_urls, r.media_url),
    content_html: r.content_html || "",
    datetime: r.datetime,
    microblog_url: r.microblog_url || "",
  }));
  const latest = thinkingPosts[0];
  const thinking = latest
    ? {
        text: latest.text,
        media_url: latest.media_url,
        media_alt: latest.media_alt,
        media_type: latest.media_type,
        media_urls: latest.media_urls,
      }
    : { text: "", media_url: "", media_alt: "", media_type: "", media_urls: [] };

  return {
    site: {
      title: site.title || "rommy.blog",
      url: site.url || "https://rommy.blog",
      author: site.author || "Rommy Ghaly",
      authorEmail: site.authorEmail || "rommy@gha.ly",
      feedPath: site.feedPath || "/feed.xml",
      description: site.description || "",
    },
    thinking,
    thinkingPosts,
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      body_html: p.body_html,
      date: p.date,
      datetime: p.datetime,
    })),
    reading: reading.map((r) => ({
      id: r.id,
      ym: r.ym,
      title: r.title,
      url: r.url,
      added_at: r.added_at,
      cover_url: r.cover_url || "",
    })),
    linklog: linklog.map((l) => ({
      url: l.url,
      title: l.title,
      date: l.date,
      datetime: l.datetime,
    })),
    links: site.links || [
      { label: "Now", url: "/now/", internal: true },
      { label: "About", url: "/about/", internal: true },
      { label: "LinkedIn", url: "https://linkedin.com/in/rommyghaly" },
      { label: "GitHub", url: "https://github.com/fingerguns" },
    ],
    optionalColophon: site.optionalColophon || "",
    sectionHints: site.section_hints || null,
  };
}
