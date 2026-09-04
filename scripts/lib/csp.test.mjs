// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseHeadersFile, parseCsp, cspAllows } from "./csp.mjs";

const SITE = "https://rommy.blog";

const headersPath = fileURLToPath(new URL("../../_headers", import.meta.url));
const rules = parseHeadersFile(readFileSync(headersPath, "utf8"));
const sitewide = rules.find((rule) => rule.path === "/*");
const csp = parseCsp(sitewide?.headers["content-security-policy"]);

function allows(directive, url) {
  const sources = csp[directive] || csp["default-src"];
  return cspAllows(sources, url, SITE);
}

test("the policy is declared once, for the whole site", () => {
  // Cloudflare Pages comma-joins same-named headers from every matching rule
  // rather than letting the most specific path win, so a second policy for
  // /admin/* would produce one broken header, not two policies.
  const withCsp = rules.filter((rule) => rule.headers["content-security-policy"]);
  assert.equal(withCsp.length, 1);
  assert.equal(withCsp[0].path, "/*");
});

test("the admin can hand a Thinking video straight to R2", () => {
  // Thinking videos are PUT from the browser to a presigned R2 URL, which is
  // an XHR and so governed by connect-src, not by img-src or media-src.
  assert.ok(
    allows("connect-src", "https://abc123def456.r2.cloudflarestorage.com/rommy-blog-media/thinking/video/2026-09-04/x.mov")
  );
});

test("the admin can preview a chosen video or voice memo before upload", () => {
  // The preview <video>/<audio> is fed a blob: object URL, and the grid poster
  // is captured off that element — with the preview blocked, the video uploads
  // with no poster and the archive tile falls back to a placeholder.
  assert.ok(allows("media-src", "blob:https://rommy.blog/9f2c-1a"));
});

test("the site can play its own audio and video", () => {
  assert.ok(allows("media-src", `${SITE}/media/thinking/video/2026-09-04/x.mov`));
});

test("the Now and admin Location maps can load MapLibre and its tiles", () => {
  // MapLibre fetches its own bundle as text before blob-wrapping it into a
  // worker, so the CDN host is needed in connect-src as well as script-src.
  assert.ok(allows("script-src", "https://cdn.jsdelivr.net/npm/maplibre-gl/dist/maplibre-gl.js"));
  assert.ok(allows("connect-src", "https://cdn.jsdelivr.net/npm/maplibre-gl/dist/maplibre-gl.js"));
  assert.ok(allows("worker-src", "blob:https://rommy.blog/3d1e-77"));
  assert.ok(allows("connect-src", "https://tiles.openfreemap.org/styles/liberty"));
});

test("the admin can load the Quill editor", () => {
  assert.ok(allows("script-src", "https://cdn.quilljs.com/1.3.6/quill.min.js"));
  assert.ok(allows("style-src", "https://cdn.quilljs.com/1.3.6/quill.snow.css"));
});

test("webmentions, the contact form and analytics still reach their endpoints", () => {
  assert.ok(allows("connect-src", "https://webmention.io/api/mentions.jf2"));
  assert.ok(allows("connect-src", "https://formspree.io/f/abc"));
  assert.ok(allows("form-action", "https://formspree.io/f/abc"));
  assert.ok(allows("connect-src", "https://region1.google-analytics.com/g/collect"));
});

test("embeds are framed only from the two hosts that are meant to be", () => {
  assert.ok(allows("frame-src", "https://www.youtube-nocookie.com/embed/abc"));
  assert.ok(allows("frame-src", "https://open.spotify.com/embed/track/abc"));
  assert.ok(!allows("frame-src", "https://example.com/embed"));
});

test("the policy has not quietly opened up", () => {
  assert.equal(csp["default-src"].join(" "), "'self'");
  assert.equal(csp["object-src"].join(" "), "'none'");
  assert.equal(csp["base-uri"].join(" "), "'none'");
  assert.equal(csp["frame-ancestors"].join(" "), "'none'");
  for (const directive of ["default-src", "connect-src", "media-src", "script-src", "style-src"]) {
    assert.ok(!csp[directive].includes("*"), directive);
    assert.ok(!csp[directive].includes("https:"), directive);
  }
});

test("host sources match by scheme, host and wildcard label", () => {
  const sources = ["https://cdn.example.com", "https://*.r2.cloudflarestorage.com"];
  assert.ok(cspAllows(sources, "https://cdn.example.com/a.js"));
  assert.ok(cspAllows(sources, "https://acct.r2.cloudflarestorage.com/bucket/key"));
  assert.ok(!cspAllows(sources, "http://cdn.example.com/a.js"), "scheme must match");
  assert.ok(!cspAllows(sources, "https://evil.cdn.example.com/a.js"), "no implicit subdomains");
  assert.ok(!cspAllows(sources, "https://r2.cloudflarestorage.com/x"), "*. excludes the apex");
});

test("scheme sources and 'self' match only what they name", () => {
  assert.ok(cspAllows(["blob:"], "blob:https://rommy.blog/abc"));
  assert.ok(!cspAllows(["blob:"], "data:image/png;base64,AA"));
  assert.ok(cspAllows(["'self'"], `${SITE}/media/x.mov`, SITE));
  assert.ok(!cspAllows(["'self'"], "https://example.com/x.mov", SITE));
  // A blob: URL inherits the page's origin but still is not covered by 'self'.
  assert.ok(!cspAllows(["'self'"], "blob:https://rommy.blog/abc", SITE));
  assert.ok(!cspAllows(["'unsafe-inline'"], `${SITE}/x.js`, SITE), "keywords never match a URL");
});

test("_headers parsing keeps each path rule's headers together", () => {
  const parsed = parseHeadersFile(["/*", "  X-Frame-Options: DENY", "", "/admin/*", "  Cache-Control: no-store"].join("\n"));
  assert.deepEqual(parsed, [
    { path: "/*", headers: { "x-frame-options": "DENY" } },
    { path: "/admin/*", headers: { "cache-control": "no-store" } },
  ]);
});
