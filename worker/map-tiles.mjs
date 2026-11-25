// rommy.blog/media/map/* — OpenFreeMap's styles, tiles, fonts and sprites,
// fetched on demand and cached at the edge, so the site's maps load from its
// own domain (why: scripts/lib/map-tiles.mjs). Only files a visitor's map
// asks for are fetched; nothing is prefetched.

import { upstreamUrlFor } from "../scripts/lib/map-tiles.mjs";

// OpenFreeMap sends its own lifetimes (ten years for dated tiles and sprites,
// an hour for the tile index, which names the current release); they are
// passed through. This is only for a response that arrives without one.
const FALLBACK_CACHE_CONTROL = "public, max-age=3600";

// What a map loads: style and tile-index JSON, vector tiles, glyphs, sprite
// images. These responses are served from rommy.blog's own origin, so anything
// else (an HTML page, a script) is refused rather than passed through, where
// it would run as part of the site.
const ALLOWED_TYPES = new Set([
  "application/json",
  "application/x-protobuf",
  "application/vnd.mapbox-vector-tile",
  "image/png",
  "image/webp",
  "image/jpeg",
]);

export async function serveMapTile(request, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const upstream = upstreamUrlFor(url.pathname);
  if (!upstream) return new Response("Not found", { status: 404 });

  // Keyed without the query string, which is never forwarded either.
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  if (!response) {
    let res;
    try {
      // No headers from the visitor's request are passed on.
      res = await fetch(upstream);
    } catch {
      return new Response("Map tiles unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const type = (res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !ALLOWED_TYPES.has(type)) {
      const status = res.status === 404 ? 404 : 502;
      return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
    }
    const headers = new Headers({
      "Content-Type": type,
      "Cache-Control": res.headers.get("Cache-Control") || FALLBACK_CACHE_CONTROL,
      // Local previews (localhost) fetch the live rommy.blog copy.
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    });
    response = new Response(res.body, { status: res.status, headers });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
