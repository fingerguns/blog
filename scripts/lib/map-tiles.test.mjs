// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MAP_TILE_REQUEST_JS, proxyUrlFor, upstreamUrlFor } from "./map-tiles.mjs";
import { serveMapTile } from "../../worker/map-tiles.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// Every kind of URL OpenFreeMap's styles make MapLibre ask for.
const OFM = {
  style: "https://tiles.openfreemap.org/styles/dark",
  index: "https://tiles.openfreemap.org/planet",
  tile: "https://tiles.openfreemap.org/planet/20261122_124456_pt/14/4826/6161.pbf",
  font: "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf",
  sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm@2x.png",
  shaded: "https://tiles.openfreemap.org/natural_earth/ne2sr/0/0/0.png",
};

test("OpenFreeMap URLs move to rommy.blog, with planet renamed tiles", () => {
  assert.equal(proxyUrlFor(OFM.style), "https://rommy.blog/media/map/styles/dark");
  assert.equal(proxyUrlFor(OFM.index), "https://rommy.blog/media/map/tiles");
  assert.equal(proxyUrlFor(OFM.tile), "https://rommy.blog/media/map/tiles/20261122_124456_pt/14/4826/6161.pbf");
  assert.equal(proxyUrlFor(OFM.font), "https://rommy.blog/media/map/fonts/Noto%20Sans%20Regular/0-255.pbf");
  assert.equal(proxyUrlFor(`${OFM.style}?v=2`), "https://rommy.blog/media/map/styles/dark");
});

test("nothing else is rewritten", () => {
  assert.equal(proxyUrlFor("https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.1/dist/maplibre-gl.js"), null);
  assert.equal(proxyUrlFor("https://tiles.openfreemap.org/something-else/x"), null);
  assert.equal(proxyUrlFor("https://tiles.openfreemap.org.evil.example/styles/dark"), null);
});

test("every rewritten URL leads the Worker back to the same OpenFreeMap file", () => {
  for (const url of Object.values(OFM)) {
    assert.equal(upstreamUrlFor(new URL(proxyUrlFor(url)).pathname), url);
  }
});

test("the Worker forwards only OpenFreeMap's own folders", () => {
  assert.equal(upstreamUrlFor("/media/map/planet/x.pbf"), null, "only the renamed folder is forwarded");
  assert.equal(upstreamUrlFor("/media/map/admin"), null);
  assert.equal(upstreamUrlFor("/media/map/"), null);
  assert.equal(upstreamUrlFor("/media/map/styles//dark"), null);
  assert.equal(upstreamUrlFor("/media/thinking/photo.jpg"), null);
  assert.equal(upstreamUrlFor("/media/map/styles/../../x"), null);
  assert.equal(upstreamUrlFor("/media/map/styles/%2E%2E/x"), null);
});

test("the client rewrite agrees with proxyUrlFor", () => {
  const mapTileRequest = new Function(`${MAP_TILE_REQUEST_JS}; return mapTileRequest;`)();
  for (const url of [...Object.values(OFM), "https://example.com/a.png", "https://tiles.openfreemap.org/other"]) {
    assert.deepEqual(mapTileRequest(url), { url: proxyUrlFor(url) ?? url }, url);
  }
});

test("every map on the site routes its requests through the rewrite", () => {
  const admin = read("../../admin/index.html");
  assert.ok(admin.includes(MAP_TILE_REQUEST_JS), "admin/index.html's inline mapTileRequest has drifted from MAP_TILE_REQUEST_JS");
  assert.equal(admin.match(/transformRequest: ?mapTileRequest/g)?.length, 2, "both admin Location maps");
  const build = read("../build.mjs");
  assert.equal(build.match(/transformRequest:mapTileRequest/g)?.length, 2, "/now/ and the Thinking map view");
});

test("the Worker refuses what it should not forward, and passes nothing of the visitor's on", async () => {
  const fetched = [];
  const stored = [];
  globalThis.caches = { default: { match: async () => undefined, put: async (k) => stored.push(k.url) } };
  globalThis.fetch = async (url, init) => {
    fetched.push({ url, init });
    return new Response("{}", { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600, public" } });
  };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };

  assert.equal((await serveMapTile(new Request("https://rommy.blog/media/map/admin"), ctx)).status, 404);
  assert.equal((await serveMapTile(new Request("https://rommy.blog/media/map/tiles", { method: "POST" }), ctx)).status, 405);
  assert.equal(fetched.length, 0);

  const res = await serveMapTile(
    new Request("https://rommy.blog/media/map/tiles?x=1", { headers: { Cookie: "a=b", Authorization: "Bearer t" } }),
    ctx
  );
  await Promise.all(waits);
  assert.equal(res.status, 200);
  assert.deepEqual(fetched, [{ url: "https://tiles.openfreemap.org/planet", init: undefined }]);
  assert.equal(res.headers.get("Cache-Control"), "max-age=3600, public");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(stored, ["https://rommy.blog/media/map/tiles"]);

  // Served from rommy.blog's origin, so a page or script from upstream must
  // never pass through, where it would run as part of the site.
  globalThis.fetch = async () => new Response("<script>alert(1)</script>", { headers: { "Content-Type": "text/html" } });
  const html = await serveMapTile(new Request("https://rommy.blog/media/map/styles/dark"), ctx);
  assert.equal(html.status, 502);
  assert.equal(await html.text(), "");
});
