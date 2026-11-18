// The one call this extension makes: add a link to Sharing on rommy.blog.
//
// It authenticates with the share token (the Worker's SHARE_TOKEN secret),
// the same one the "Share to rommy.blog" Shortcut uses. That token can add a
// Sharing link and do nothing else; the admin password never lives here.
// It is kept in chrome.storage.local (this browser only, never synced).

export const API_URL = "https://rommy.blog/api/admin";

export async function getToken() {
  const { shareToken } = await chrome.storage.local.get("shareToken");
  return typeof shareToken === "string" && shareToken ? shareToken : "";
}

export function isShareable(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/**
 * Share `url` (with `title`, or "" to let the Worker read the page's own
 * title). Resolves to the Worker's reply: { ok, entry, tags, *Warning }.
 * Rejects with a readable message on any failure.
 */
export async function shareLink(url, title = "") {
  const token = await getToken();
  if (!token) throw new Error("Add your share token in the extension's options first.");
  if (!isShareable(url)) throw new Error("Only web pages (http or https) can be shared.");
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sharing", share_token: token, url, title: title.trim() }),
    });
  } catch {
    throw new Error("Couldn't reach rommy.blog. Check your connection.");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || !data.ok) {
    if (res.status === 401) throw new Error("The share token was refused. Check it in the options.");
    throw new Error(data.error || `rommy.blog answered ${res.status}.`);
  }
  return data;
}

/** The cross-posts that didn't go out, as one line each ("Bluesky: …"). */
export function warningsOf(result) {
  return [
    ["Micro.blog", result.microblogWarning],
    ["Bluesky", result.blueskyWarning],
    ["Mastodon", result.mastodonWarning],
  ]
    .filter(([, w]) => w)
    .map(([name, w]) => `${name}: ${w}`);
}
