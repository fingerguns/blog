/**
 * Query Cloudflare D1 from Node.js (build script, migration).
 * Requires env: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID
 */

import {
  CONTENT_COLUMNS,
  shapeFavoriteRow,
  shapeLinklogRow,
  shapePostRow,
  shapeReadingRow,
  shapeThinkingRow,
} from "./lib/content-rows.mjs";

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

/**
 * NOTE: unused, and rejected by the D1 REST API as written — /query expects a
 * single statement object, not an array ("Invalid input: Expected object,
 * received array"). For multi-row writes use one d1Query with a multi-tuple
 * VALUES clause, as scripts/lib/build-cache.mjs does.
 */
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
    `SELECT ${CONTENT_COLUMNS.post} FROM posts ORDER BY datetime DESC`
  );

  const reading = await d1Query(
    `SELECT ${CONTENT_COLUMNS.reading} FROM reading ORDER BY ym DESC, added_at DESC, id DESC`
  );

  let readingFavorites = [];
  try {
    readingFavorites = await d1Query(
      `SELECT ${CONTENT_COLUMNS.favorite} FROM reading_favorites ORDER BY title COLLATE NOCASE ASC, id ASC`
    );
  } catch {
    readingFavorites = [];
  }

  let readingGenres = [];
  let readingFavoriteGenreRows = [];
  try {
    readingGenres = await d1Query(
      "SELECT id, slug, label FROM reading_genres ORDER BY label COLLATE NOCASE ASC, id ASC"
    );
    readingFavoriteGenreRows = await d1Query(
      `SELECT rfg.favorite_id, rg.slug, rfg.rank
       FROM reading_favorite_genres rfg
       JOIN reading_genres rg ON rg.id = rfg.genre_id
       ORDER BY rfg.favorite_id ASC, rfg.rank ASC`
    );
  } catch {
    readingGenres = [];
    readingFavoriteGenreRows = [];
  }

  const genresByFavoriteId = new Map();
  for (const row of readingFavoriteGenreRows) {
    const list = genresByFavoriteId.get(row.favorite_id) || [];
    list.push(row.slug);
    genresByFavoriteId.set(row.favorite_id, list);
  }

  const linklog = await d1Query(
    `SELECT ${CONTENT_COLUMNS.linklog} FROM linklog ORDER BY datetime DESC`
  );

  let ouraSteps = null;
  try {
    const rows = await d1Query(
      "SELECT day, steps FROM oura_daily_activity ORDER BY day DESC LIMIT 1"
    );
    if (rows[0]?.day) {
      ouraSteps = { day: rows[0].day, steps: Number(rows[0].steps) || 0 };
    }
  } catch {
    ouraSteps = null;
  }

  const thinkingPostRows = await d1Query(
    `SELECT ${CONTENT_COLUMNS.thinking} FROM thinking_posts ORDER BY datetime DESC`
  );
  const thinkingPosts = thinkingPostRows.map(shapeThinkingRow);
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
    posts: posts.map(shapePostRow),
    reading: reading.map(shapeReadingRow),
    readingFavorites: readingFavorites.map((r) => shapeFavoriteRow(r, genresByFavoriteId.get(r.id) || [])),
    readingGenres: readingGenres.map((g) => ({
      slug: g.slug,
      label: g.label,
    })),
    linklog: linklog.map(shapeLinklogRow),
    links: site.links || [
      { label: "Now", url: "/now/", internal: true },
      { label: "About", url: "/about/", internal: true },
      { label: "LinkedIn", url: "https://linkedin.com/in/rommyghaly" },
      { label: "GitHub", url: "https://github.com/fingerguns" },
    ],
    optionalColophon: site.optionalColophon || "",
    sectionHints: site.section_hints || null,
    readingTabIntros: site.reading_tab_intros || null,
    ouraSteps,
  };
}
