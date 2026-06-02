/**
 * Cloudflare Worker: admin API for rommy.blog
 *
 * Routes (POST to /):
 *   action: "thinking"  — update thinking.text in data/posts.json
 *   action: "post"      — create a new writing post
 *
 * Secrets (wrangler secret put):
 *   ADMIN_PASSWORD      — shared password for /admin/
 *   GITHUB_TOKEN        — fine-grained PAT with Contents read/write on the repo
 *   MICROBLOG_TOKEN     — Micropub token for micro.blog (optional)
 *   BLUESKY_HANDLE      — Bluesky handle e.g. rommy.bsky.social (optional)
 *   BLUESKY_APP_PASSWORD — Bluesky app password from Settings → App Passwords (optional)
 */

const JSON_PATH = "data/posts.json";
const SITE_URL = "https://rommy.blog";
const SITE_TITLE = "rommy.blog";
const SITE_AUTHOR = "Rommy Ghaly";
const GA_ID = "G-L1CC5F3DP8";
const GA_SNIPPET = `    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>\n    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;

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

    if (action === "verify") {
      return json({ ok: true }, 200, cors);
    }

    const owner = env.GITHUB_OWNER || "fingerguns";
    const repo = env.GITHUB_REPO || "blog";
    const branch = env.GITHUB_BRANCH || "main";

    if (action === "thinking") {
      return handleThinking(body, env.GITHUB_TOKEN, owner, repo, branch, cors, env);
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

    if (action === "fetch-title") {
      return handleFetchTitle(body, cors);
    }

    if (action === "fetch-post") {
      return handleFetchPost(body, env.GITHUB_TOKEN, owner, repo, branch, cors);
    }

    if (action === "edit-post") {
      return handleEditPost(body, env.GITHUB_TOKEN, owner, repo, branch, cors);
    }

    return json({ error: "Unknown action" }, 400, cors);
  },
};

// ─── Thinking ────────────────────────────────────────────────────────────────

async function handleThinking(body, token, owner, repo, branch, cors, env) {
  const { text } = body;
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "Missing text" }, 400, cors);
  }

  const trimmed = text.trim();
  if (trimmed.length > 2000) {
    return json({ error: "Text must be 2000 characters or fewer" }, 400, cors);
  }

  try {
    // 1. Update data/posts.json in GitHub
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

    // 2. Mirror to micro.blog (optional — skipped if token not set)
    let microblogWarning = null;
    if (env.MICROBLOG_TOKEN) {
      try {
        await postToMicroblog(env.MICROBLOG_TOKEN, trimmed);
      } catch (mbErr) {
        microblogWarning = mbErr.message || "micro.blog post failed";
      }
    }

    // 3. Mirror to Bluesky (optional — skipped if secrets not set)
    let blueskyWarning = null;
    if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
      try {
        await postToBluesky(env.BLUESKY_HANDLE, env.BLUESKY_APP_PASSWORD, trimmed);
      } catch (bsErr) {
        blueskyWarning = bsErr.message || "Bluesky post failed";
      }
    }

    // 4. Trigger a second rebuild so the /thinking/ page catches the new micro.blog post.
    //    The push-triggered build may race micro.blog's indexing; this queued dispatch
    //    runs ~1–2 min later, by which point micro.blog's feed is up to date.
    githubTriggerDispatch(token, owner, repo, branch).catch(() => {});

    return json({ ok: true, text: trimmed, microblogWarning, blueskyWarning }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Update failed" }, 500, cors);
  }
}

async function postToMicroblog(token, content) {
  const res = await fetch("https://micro.blog/micropub", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ h: "entry", content }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`micro.blog post failed (${res.status}): ${err}`);
  }
}

async function postToBluesky(handle, appPassword, content) {
  // 1. Authenticate
  const sessionRes = await fetch(
    "https://bsky.social/xrpc/com.atproto.server.createSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    }
  );
  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    throw new Error(`Bluesky auth failed (${sessionRes.status}): ${err}`);
  }
  const { accessJwt, did } = await sessionRes.json();

  // 2. Build post text — Bluesky has a 300-grapheme limit.
  //    If the content is longer, truncate and append a link to /thinking/.
  const LINK_URL = `${SITE_URL}/thinking/`;
  const MAX = 300;
  const graphemes = [...content];
  let text = content;
  let facets = [];

  if (graphemes.length > MAX) {
    const suffix = `\u2026 ${LINK_URL}`; // "… https://rommy.blog/thinking/"
    const maxContent = MAX - [...suffix].length;
    const truncated = graphemes.slice(0, maxContent).join("");
    text = truncated + suffix;

    // Facet byte positions (UTF-8) for the appended overflow link
    const enc = new TextEncoder();
    const byteStart = enc.encode(truncated + "\u2026 ").length;
    const byteEnd = byteStart + enc.encode(LINK_URL).length;
    facets.push({
      $type: "app.bsky.richtext.facet",
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: LINK_URL }],
    });
  }

  // Detect bare URLs in the final text and add link facets for each.
  // Bluesky does not auto-link URLs — facets are required.
  const enc = new TextEncoder();
  const urlRe = /https?:\/\/[^\s\u2026]+/g;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?)"']+$/, ""); // strip trailing punctuation
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(url).length;
    // Avoid duplicating a facet already added for the overflow link
    const already = facets.some(f => f.index.byteStart === byteStart);
    if (!already) {
      facets.push({
        $type: "app.bsky.richtext.facet",
        index: { byteStart, byteEnd },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
      });
    }
  }

  // 3. Create the record
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    ...(facets.length ? { facets } : {}),
  };

  const postRes = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record }),
    }
  );
  if (!postRes.ok) {
    const err = await postRes.text();
    throw new Error(`Bluesky post failed (${postRes.status}): ${err}`);
  }
}

// ─── New Post ─────────────────────────────────────────────────────────────────

async function handlePost(body, token, owner, repo, branch, cors) {
  const { title, summary } = body;
  // Accept either rich HTML body or legacy paragraphs array
  const rawBody = typeof body.body === "string" ? body.body.trim() : null;
  const paragraphs = Array.isArray(body.paragraphs) ? body.paragraphs : null;

  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "Missing title" }, 400, cors);
  }
  if (typeof summary !== "string" || !summary.trim()) {
    return json({ error: "Missing summary" }, 400, cors);
  }
  if (!rawBody && !paragraphs) {
    return json({ error: "Missing body" }, 400, cors);
  }

  const cleanTitle = title.trim();
  const cleanSummary = summary.trim();

  const slug = toSlug(cleanTitle);
  const now = new Date();
  const dateStr = toDateStr(now);
  const datetimeStr = now.toISOString();
  const displayDate = toDisplayDate(now);

  // Build body HTML and estimate word count
  let bodyHtml;
  let wordCount;
  if (rawBody) {
    bodyHtml = cleanBodyHtml(rawBody);
    wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  } else {
    const cleanParas = paragraphs.map((p) => String(p).trim()).filter(Boolean);
    bodyHtml = cleanParas.map((p) => `        <p>\n          ${escHtml(p)}\n        </p>`).join("\n");
    wordCount = cleanParas.join(" ").split(/\s+/).length;
  }

  const readMins = Math.max(1, Math.round(wordCount / 200));
  const postPath = `posts/${slug}/index.html`;

  // Check file doesn't already exist
  try {
    await githubGetFile(token, owner, repo, postPath, branch);
    return json({ error: `A post at ${postPath} already exists` }, 409, cors);
  } catch (e) {
    if (!e.message.includes("404")) throw e;
  }

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
${GA_SNIPPET}
  </head>
  <body>
    <article class="post">
      <a class="post-back" href="../../index.html">←</a>
      <h1>${escHtml(cleanTitle)}</h1>
      <time datetime="${dateStr}"><span>${displayDate}</span><span class="reading-time">${readMins} min read</span></time>
      <div class="body">
        ${bodyHtml}
      </div>
      <a class="back-to-top" href="#">↑ Top</a>
      <footer class="site-footer">
        <p class="footer-row">&copy; 2026 ${SITE_AUTHOR}<a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="../../feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
    <script>(function(){try{var s=JSON.parse(localStorage.getItem('admin_session')||'null');if(s&&s.pw&&(Date.now()-s.ts)<2592000000){var a=document.createElement('a');a.href='/admin/?post=${slug}';a.textContent='Edit post';a.className='post-edit-link';var f=document.querySelector('.site-footer');if(f)f.insertAdjacentElement('beforebegin',a);}}catch(e){}}());</script>
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

// ─── Fetch Post ──────────────────────────────────────────────────────────────

async function handleFetchPost(body, token, owner, repo, branch, cors) {
  const { slug } = body;
  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");
  const postPath = `posts/${cleanSlug}/index.html`;

  try {
    const file = await githubGetFile(token, owner, repo, postPath, branch);
    const html = file.content;

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const title = h1Match ? unescHtml(h1Match[1].trim()) : "";

    const summaryMatch = html.match(/og:description" content="([^"]*)"/);
    const summary = summaryMatch ? unescHtml(summaryMatch[1]) : "";

    // Extract body between <div class="body"> and the closing </div> before back-to-top
    const bodyStart = html.indexOf('<div class="body">');
    const bodyEndMarker = '</div>\n      <a class="back-to-top"';
    const bodyEnd = html.indexOf(bodyEndMarker);
    const bodyContent = bodyStart >= 0 && bodyEnd > bodyStart
      ? html.slice(bodyStart + '<div class="body">'.length, bodyEnd).trim()
      : "";

    return json({ ok: true, title, summary, body: bodyContent }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Post not found" }, 404, cors);
  }
}

// ─── Edit Post ────────────────────────────────────────────────────────────────

async function handleEditPost(body, token, owner, repo, branch, cors) {
  const { slug, title, summary } = body;
  const rawBody = typeof body.body === "string" ? body.body.trim() : null;

  if (typeof slug !== "string" || !slug.trim()) {
    return json({ error: "Missing slug" }, 400, cors);
  }
  if (!rawBody) {
    return json({ error: "Missing body" }, 400, cors);
  }

  const cleanSlug = slug.trim().replace(/[^a-zA-Z0-9-_]/g, "");
  const bodyHtml = cleanBodyHtml(rawBody);
  const wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.round(wordCount / 200));
  const postPath = `posts/${cleanSlug}/index.html`;

  try {
    const file = await githubGetFile(token, owner, repo, postPath, branch);
    let html = file.content;

    // Replace body content
    html = html.replace(
      /(<div class="body">)[\s\S]*?(<\/div>\s*<a class="back-to-top")/,
      `$1\n        ${bodyHtml}\n      $2`
    );

    // Update reading time
    html = html.replace(
      /<span class="reading-time">[^<]*<\/span>/,
      `<span class="reading-time">${readMins} min read</span>`
    );

    // Update title if provided
    if (title && title.trim()) {
      const t = title.trim();
      html = html.replace(/<h1[^>]*>[^<]*<\/h1>/, `<h1>${escHtml(t)}</h1>`);
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(t)} — ${SITE_TITLE}</title>`);
      html = html.replace(/(og:title" content=")[^"]*(")/,  `$1${escHtml(t)} — ${SITE_TITLE}$2`);
    }

    // Update summary if provided
    if (summary && summary.trim()) {
      const s = summary.trim();
      html = html.replace(/(og:description" content=")[^"]*(")/,  `$1${escHtml(s)}$2`);
      html = html.replace(/(name="description"\s+content=")[^"]*(")/,  `$1${escHtml(s)}$2`);
    }

    await githubPutFile(token, owner, repo, postPath, branch, {
      message: `Edit post: ${cleanSlug}`,
      content: toBase64(html),
      sha: file.sha,
    });

    // Update posts.json if title or summary changed
    if ((title && title.trim()) || (summary && summary.trim())) {
      try {
        const jf = await githubGetFile(token, owner, repo, JSON_PATH, branch);
        const data = JSON.parse(jf.content);
        const post = (data.posts || []).find((p) => p.slug === cleanSlug);
        if (post) {
          if (title) post.title = title.trim();
          if (summary) post.summary = summary.trim();
          await githubPutFile(token, owner, repo, JSON_PATH, branch, {
            message: `Update post metadata: ${cleanSlug}`,
            content: toBase64(JSON.stringify(data, null, 2) + "\n"),
            sha: jf.sha,
          });
        }
      } catch (e) {
        // Non-fatal — body was already saved
      }
    }

    return json({ ok: true, url: `${SITE_URL}/posts/${cleanSlug}/` }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Edit failed" }, 500, cors);
  }
}

// ─── Fetch Title ─────────────────────────────────────────────────────────────

async function handleFetchTitle(body, cors) {
  const { url } = body;
  if (typeof url !== "string" || !url.trim().startsWith("http")) {
    return json({ error: "Invalid url" }, 400, cors);
  }

  try {
    const res = await fetch(url.trim(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return json({ error: `Page returned ${res.status}` }, 502, cors);
    }

    // Read only the first 50 KB — enough for <head>
    const reader = res.body.getReader();
    let html = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (bytes < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.length;
      // Stop early once we've passed </head>
      if (html.includes("</head>")) break;
    }
    reader.cancel();

    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!match) {
      return json({ error: "No title found" }, 404, cors);
    }

    const title = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    return json({ ok: true, title }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "Fetch failed" }, 502, cors);
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

// Convert Quill HTML to clean paragraph HTML.
// - Strips empty Quill spacer paragraphs
// - Converts double <br> (from the Enter = soft-break editor setting) into <p> breaks
function cleanBodyHtml(raw) {
  let html = raw.replace(/(<p><br\s*\/?><\/p>)+/g, "").trim();
  html = html.replace(/(<br\s*\/?>\s*){2,}/g, "</p><p>");
  html = html.replace(/<p>\s*(<br\s*\/?>)+/g, "<p>");
  html = html.replace(/(<br\s*\/?>)+\s*<\/p>/g, "</p>");
  html = html.replace(/<p>\s*<\/p>/g, "");
  return html.trim();
}

function unescHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
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
  return toDateStr(d);
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

async function githubTriggerDispatch(token, owner, repo, ref) {
  await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/build.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "rommy-blog-admin-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
    }
  );
  // Errors are swallowed by the caller — the hourly cron is the fallback.
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
