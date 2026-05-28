/**
 * Cloudflare Worker: updates data/posts.json thinking.text via GitHub API.
 *
 * Secrets (wrangler secret put):
 *   ADMIN_PASSWORD — shared password for /admin/
 *   GITHUB_TOKEN   — fine-grained PAT with Contents read/write on the repo
 */

const JSON_PATH = "data/posts.json";

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

    const { password, text } = body;
    if (typeof password !== "string" || typeof text !== "string") {
      return json({ error: "Missing password or text" }, 400, cors);
    }

    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: "Invalid password" }, 401, cors);
    }

    const trimmed = text.trim();
    if (trimmed.length > 2000) {
      return json({ error: "Text must be 2000 characters or fewer" }, 400, cors);
    }

    const owner = env.GITHUB_OWNER || "fingerguns";
    const repo = env.GITHUB_REPO || "blog";
    const branch = env.GITHUB_BRANCH || "main";

    try {
      const file = await githubGetFile(env.GITHUB_TOKEN, owner, repo, JSON_PATH, branch);
      const data = JSON.parse(file.content);

      if (!data.thinking || typeof data.thinking !== "object") {
        data.thinking = {};
      }
      data.thinking.text = trimmed;

      const updated = JSON.stringify(data, null, 2) + "\n";
      const encoded = btoa(unescape(encodeURIComponent(updated)));

      await githubPutFile(env.GITHUB_TOKEN, owner, repo, JSON_PATH, branch, {
        message: "Update thinking via admin",
        content: encoded,
        sha: file.sha,
      });

      return json({ ok: true, text: trimmed }, 200, cors);
    } catch (err) {
      return json({ error: err.message || "Update failed" }, 500, cors);
    }
  },
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function githubGetFile(token, owner, repo, path, ref) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
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
