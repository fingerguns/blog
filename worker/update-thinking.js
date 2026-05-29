/**
 * Cloudflare Worker: admin API for rommy.blog
 *
 * Routes (POST to /):
 *   action: "thinking"  — update thinking.text in data/posts.json
 *   action: "post"      — create a new writing post
 *
 * Secrets (wrangler secret put):
 *   ADMIN_PASSWORD — shared password for /admin/
 *   GITHUB_TOKEN   — fine-grained PAT with Contents read/write on the repo
 */

const JSON_PATH = "data/posts.json";
const SITE_URL = "https://rommy.blog";
const SITE_TITLE = "rommy.blog";
const SITE_AUTHOR = "Rommy Ghaly";

export default {
  async fetch(request, env) {
    const allowedOrigins = (env.ALLOWED_ORIGINS || "https://rommy.blog")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const origin = request.headers.get("Origin") || "";
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

    const cors = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    if (!env.ADMIN_PASSWORD || !env.GITHUB_TOKEN) {
      return json({ error: "Worker is not configured" }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const { password, action } = body;

    if (typeof password !== "string") {
      return json({ error: "Missing password" }, 400, cors);
    }

    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: "Invalid password" }, 401, cors);
    }

    const owner = env.GITHUB_OWNER || "fingerguns";
    const repo = env.GITHUB_REPO || "blog";
    const branch = env.GITHUB_BRANCH || "main";

    if (action === "thinking") {
      return handleThinking(body, env.GITHUB_TOKEN, owner, repo, branch, cors);
    }

    if (action === "post") {
      return handlePost(body, env.GITHUB_TOKEN, owner, repo, branch, cors);
    }

    if (action === "reading") {
      return handleReading(body, env.GITHUB_TOKEN, owner, repo, branch, cors);
    }

    if (action === "sharing") {
      return handleSharing(body, env.GITHUB_TOKEN, owner, repo, branch, cors);
    }

    return json({ error: "Unknown action" }, 400, cors);
  },
};

// ─── Thinking ────────────────────────────────────────────────────────────────

async function handleThinking(body, token, owner, repo, branch, cors) {
  const { text } = body;
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "Missing text" }, 400, cors);
  }

  const trimmed = text.trim();
  if (trimmed.length > 2000) {
    return json({ error: "Text must be 2000 characters or fewer" }, 400, cors);
  }

  try {
    const file = await githubGetFile(token, owner, repo, JSON_PATH, branch);
    const data = JSON.parse(file.content);

    if (!data.thinking || typeof data.thinking !== "object") {
      data.thinking = {};
    }
    data.thinking.text = trimmed;

    await githubPutFile(token, owner, repo, JSON_PATH, branch, {
      message: "Update thinking via admin",
      content: toBase64(JSON.stringify(data, null, 2) + "\n"),
      sha: file.sha,
    });

    return json({ ok: true, text: trimmed }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// ─── New Post ─────────────────────────────────────────────────────────────────

async function handlePost(body, token, owner, repo, branch, cors) {
  const { title, summary, paragraphs } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof summary !== "string" || !summary.trim()) {
    return json({ error: "Missing summary" }, 400, cors);
  }
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return json({ error: "Missing paragraphs" }, 400, cors);
  }

  const cleanTitle = title.trim();
  const cleanSummary = summary.trim();
  const cleanParas = paragraphs.map((p) => String(p).trim()).filter(Boolean);

  const slug = toSlug(cleanTitle);
  const now = new Date();
  const dateStr = toDateStr(now);
  const datetimeStr = now.toISOString();
  const displayDate = toDisplayDate(now);
  const wordCount = cleanParas.join(" ").split(/\s+/).length;
  const readMins = Math.max(1, Math.round(wordCount / 200));
  const postPath = `posts/${slug}/index.html`;

  // Check file doesn't already exist
  try {
    await githubGetFile(token, owner, repo, postPath, branch);
    return json({ error: `A post at ${postPath} already exists` }, 409, cors);
  } catch (e) {
    if (!e.message.includes("404")) throw e;
  }

  const parasHtml = cleanParas
    .map((p) => `        <p>\n          ${escHtml(p)}\n        </p>`)
    .join("\n");

  const postHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(cleanTitle)} — ${SITE_TITLE}</title>
    <script>(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}());</script>
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escHtml(cleanTitle)} — ${SITE_TITLE}" />
    <meta property="og:description" content="${escHtml(cleanSummary)}" />
    <meta property="og:url" content="${SITE_URL}/posts/${slug}/" />
    <meta property="og:site_name" content="${SITE_TITLE}" />
    <meta property="og:image" content="${SITE_URL}/favicon.png" />
    <meta
      name="description"
      content="${escHtml(cleanSummary)}"
    />
    <link rel="icon" href="../../favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="../../favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="../../styles.css" />
    <link
      rel="alternate"
      type="application/atom+xml"
      title="${SITE_TITLE}"
      href="../../feed.xml"
    />
  </head>
  <body>
    <article class="post">
      <a class="post-back" href="../../index.html">← Home</a>
      <h1>${escHtml(cleanTitle)}</h1>
      <time datetime="${dateStr}"><span>${displayDate}</span><span class="reading-time">${readMins} min read</span></time>
      <div class="body">
${parasHtml}
      </div>
      <a class="back-to-top" href="#">↑ Top</a>
      <footer class="site-footer">
        <p class="footer-row">&copy; 2026 ${SITE_AUTHOR}<a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="../../feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><a href="/changelog/">Changelog</a></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
  </body>
</html>
`;

  try {
    // 1. Create the post HTML file
    await githubPutFile(token, owner, repo, postPath, branch, {
      message: `Add post: ${cleanTitle}`,
      content: toBase64(postHtml),
    });

    // 2. Prepend to posts array in data/posts.json
    const jsonFile = await githubGetFile(token, owner, repo, JSON_PATH, branch);
    const data = JSON.parse(jsonFile.content);

    const entry = {
      slug,
      title: cleanTitle,
      date: dateStr,
      datetime: datetimeStr,
      summary: cleanSummary,
    };

    data.posts = [entry, ...(data.posts || [])];

    await githubPutFile(token, owner, repo, JSON_PATH, branch, {
      message: `Update posts.json for: ${cleanTitle}`,
      content: toBase64(JSON.stringify(data, null, 2) + "\n"),
      sha: jsonFile.sha,
    });

    return json({ ok: true, slug, url: `${SITE_URL}/posts/${slug}/` }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Post creation failed" }, 500, cors);
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────

async function handleReading(body, token, owner, repo, branch, cors) {
  const { title, url, ym } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof url !== "string" || !url.trim()) {
    return json({ error: "Missing url" }, 400, cors);
  }

  const now = new Date();
  const month = typeof ym === "string" && /^\d{4}-\d{2}$/.test(ym.trim())
    ? ym.trim()
    : now.toISOString().slice(0, 7);

  const entry = { ym: month, title: title.trim(), url: url.trim() };

  try {
    const file = await githubGetFile(token, owner, repo, JSON_PATH, branch);
    const data = JSON.parse(file.content);
    data.reading = [entry, ...(data.reading || [])];

    await githubPutFile(token, owner, repo, JSON_PATH, branch, {
      message: `Add reading: ${entry.title}`,
      content: toBase64(JSON.stringify(data, null, 2) + "\n"),
      sha: file.sha,
    });

    return json({ ok: true, entry }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// ─── Sharing ──────────────────────────────────────────────────────────────────

async function handleSharing(body, token, owner, repo, branch, cors) {
  const { title, url } = body;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof url !== "string" || !url.trim()) {
    return json({ error: "Missing url" }, 400, cors);
  }

  const now = new Date();
  const dateStr = toDateStr(now);
  const datetimeStr = now.toISOString();

  const entry = {
    url: url.trim(),
    title: title.trim(),
    date: dateStr,
    datetime: datetimeStr,
  };

  try {
    const file = await githubGetFile(token, owner, repo, JSON_PATH, branch);
    const data = JSON.parse(file.content);
    data.linklog = [entry, ...(data.linklog || [])];

    await githubPutFile(token, owner, repo, JSON_PATH, branch, {
      message: `Add sharing: ${entry.title}`,
      content: toBase64(JSON.stringify(data, null, 2) + "\n"),
      sha: file.sha,
    });

    return json({ ok: true, entry }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toSlug(s) {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function toDisplayDate(d) {
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function githubGetFile(token, owner, repo, path, ref) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "rommy-blog-admin-worker",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub read failed (${res.status})`);
  }

  const meta = await res.json();
  const content = decodeURIComponent(escape(atob(meta.content.replace(/\n/g, ""))));
  return { content, sha: meta.sha };
}

async function githubPutFile(token, owner, repo, path, branch, payload) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "rommy-blog-admin-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, branch }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub write failed (${res.status}): ${err}`);
  }
}
