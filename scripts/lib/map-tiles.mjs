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
// OpenFreeMap's tiles are not always under `planet`: on 2026-11-26 its styles
// pointed at `backup_planet`, a failover copy, and every map here went blank
// (the proxy didn't know the folder, so MapLibre asked OpenFreeMap directly,
// which the CSP and the blockers refuse). Any folder with `planet` in its name
// is a tileset and is proxied the same way, `planet` → `tiles` in the name.
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
// OpenFreeMap's tileset folders: `planet`, `backup_planet`, and any like them.
const TILESET = /^[a-z0-9_]*planet[a-z0-9_]*$/;

function proxyFolder(theirs) {
  if (Object.hasOwn(PROXY_NAME, theirs)) return PROXY_NAME[theirs];
  return TILESET.test(theirs) ? theirs.replace("planet", "tiles") : null;
}

function upstreamFolder(ours) {
  if (Object.hasOwn(FOLDERS, ours)) return FOLDERS[ours];
  if (!ours.includes("tiles")) return null;
  const theirs = ours.replace("tiles", "planet");
  return TILESET.test(theirs) ? theirs : null;
}

/**
 * The rommy.blog URL for an OpenFreeMap URL, or null for any other URL. The
 * query string is dropped: OpenFreeMap uses none, and the Worker forwards none.
 */
export function proxyUrlFor(url) {
  const m = /^https:\/\/tiles\.openfreemap\.org\/([^/?#]+)([^?#]*)/.exec(String(url));
  const folder = m && proxyFolder(m[1]);
  if (!folder) return null;
  return `${PROXY_ORIGIN}${MAP_TILE_PROXY_PREFIX}${folder}${m[2]}`;
}

/**
 * The OpenFreeMap URL behind a /media/map/ path, or null when the path is not
 * one the Worker should forward.
 */
export function upstreamUrlFor(pathname) {
  const path = String(pathname);
  if (!path.startsWith(MAP_TILE_PROXY_PREFIX)) return null;
  const m = /^([^/]+)((?:\/[^/]+)*)$/.exec(path.slice(MAP_TILE_PROXY_PREFIX.length));
  const folder = m && upstreamFolder(m[1]);
  if (!folder) return null;
  // Dot segments (and their percent-encoded forms) could climb out of the folder.
  if (m[2].split("/").some((seg) => /^(\.|%2e){1,2}$/i.test(seg))) return null;
  return `${MAP_TILE_UPSTREAM}/${folder}${m[2]}`;
}

/**
 * Client source for the maps' `transformRequest` option: the same mapping as
 * proxyUrlFor, as plain ES5 for the inline page scripts. admin/index.html
 * carries a hand-inlined copy (it is static and cannot import this), and
 * map-tiles.test.mjs fails if that copy drifts.
 */
export const MAP_TILE_REQUEST_JS = `function mapTileRequest(url){var m=/^https:\\/\\/tiles\\.openfreemap\\.org\\/([^\\/?#]+)([^?#]*)/.exec(url);var n=m&&({styles:'styles',planet:'tiles',fonts:'fonts',sprites:'sprites',natural_earth:'natural_earth'}[m[1]]||(/^[a-z0-9_]*planet[a-z0-9_]*$/.test(m[1])?m[1].replace('planet','tiles'):null));return n?{url:'${PROXY_ORIGIN}${MAP_TILE_PROXY_PREFIX}'+n+m[2]}:{url:url};}`;
