/** Rewrite legacy R2 public URLs to same-origin /media/ paths (iOS audio playback). */
export function toSiteMediaUrl(url, siteUrl = "https://rommy.blog") {
  if (!url) return "";
  try {
    const u = new URL(url);
    const base = siteUrl.replace(/\/$/, "");
    if (u.hostname.endsWith(".r2.dev") && u.pathname.startsWith("/thinking/")) {
      return `${base}/media${u.pathname}`;
    }
    if (u.origin === base && u.pathname.startsWith("/media/")) {
      return url;
    }
  } catch {
    /* ignore invalid URLs */
  }
  return url;
}
