// Map basemaps come from rommy.blog/media/map/, not straight from OpenFreeMap.
//
// Some content blockers refuse every request under tiles.openfreemap.org/planet
// (net::ERR_BLOCKED_BY_CLIENT), which leaves a map with its overlays drawn on a
// blank canvas. So every map on the site rewrites OpenFreeMap URLs to the
// Worker (MapLibre's `transformRequest`, with MAP_TILE_REQUEST_JS below), and
// the Worker fetches the same file from OpenFreeMap and caches it at the edge
// (worker/map-tiles.mjs). `planet` is renamed `tiles` on the way, since that
// path segment is what a filter may match.
//
// Imported by the Worker, so no Node built-ins here.

export const MAP_TILE_UPSTREAM = "https://tiles.openfreemap.org";
export const MAP_TILE_PROXY_PREFIX = "/media/map/";
const PROXY_ORIGIN = "https://rommy.blog";

// OpenFreeMap's top-level folders, keyed by their name on rommy.blog. Nothing
// outside these is forwarded, so the Worker is not an open proxy.
const FOLDERS = {
  styles: "styles",
  tiles: "planet",
  fonts: "fonts",
  sprites: "sprites",
  natural_earth: "natural_earth",
};
const PROXY_NAME = Object.fromEntries(Object.entries(FOLDERS).map(([ours, theirs]) => [theirs, ours]));

/**
 * The rommy.blog URL for an OpenFreeMap URL, or null for any other URL. The
 * query string is dropped: OpenFreeMap uses none, and the Worker forwards none.
 */
export function proxyUrlFor(url) {
  const m = /^https:\/\/tiles\.openfreemap\.org\/([^/?#]+)([^?#]*)/.exec(String(url));
  if (!m || !PROXY_NAME[m[1]]) return null;
  return `${PROXY_ORIGIN}${MAP_TILE_PROXY_PREFIX}${PROXY_NAME[m[1]]}${m[2]}`;
}

/**
 * The OpenFreeMap URL behind a /media/map/ path, or null when the path is not
 * one the Worker should forward.
 */
export function upstreamUrlFor(pathname) {
  const path = String(pathname);
  if (!path.startsWith(MAP_TILE_PROXY_PREFIX)) return null;
  const m = /^([^/]+)((?:\/[^/]+)*)$/.exec(path.slice(MAP_TILE_PROXY_PREFIX.length));
  if (!m || !Object.hasOwn(FOLDERS, m[1])) return null;
  // Dot segments (and their percent-encoded forms) could climb out of the folder.
  if (m[2].split("/").some((seg) => /^(\.|%2e){1,2}$/i.test(seg))) return null;
  return `${MAP_TILE_UPSTREAM}/${FOLDERS[m[1]]}${m[2]}`;
}

/**
 * Client source for the maps' `transformRequest` option: the same mapping as
 * proxyUrlFor, as plain ES5 for the inline page scripts. admin/index.html
 * carries a hand-inlined copy (it is static and cannot import this), and
 * map-tiles.test.mjs fails if that copy drifts.
 */
export const MAP_TILE_REQUEST_JS = `function mapTileRequest(url){var m=/^https:\\/\\/tiles\\.openfreemap\\.org\\/([^\\/?#]+)([^?#]*)/.exec(url);var n=m&&{styles:'styles',planet:'tiles',fonts:'fonts',sprites:'sprites',natural_earth:'natural_earth'}[m[1]];return n?{url:'${PROXY_ORIGIN}${MAP_TILE_PROXY_PREFIX}'+n+m[2]}:{url:url};}`;
