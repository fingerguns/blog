// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { versionStaticAssetLinks } from "./static-asset-version.mjs";

test("styles.css and thinking-composer.js links get the build version", () => {
  const html = '<link rel="stylesheet" href="/styles.css" />\n<script src="/thinking-composer.js"></script>\n<link rel="stylesheet" href="../styles.css" />';
  assert.equal(
    versionStaticAssetLinks(html, "2026-11-26-abc"),
    '<link rel="stylesheet" href="/styles.css?v=2026-11-26-abc" />\n<script src="/thinking-composer.js?v=2026-11-26-abc"></script>\n<link rel="stylesheet" href="../styles.css?v=2026-11-26-abc" />'
  );
});

test("the admin's Oura dashboard script is versioned too", () => {
  assert.equal(
    versionStaticAssetLinks('<script src="/admin/oura-dashboard.js"></script>', "v1"),
    '<script src="/admin/oura-dashboard.js?v=v1"></script>'
  );
});

test("every admin tab's URL is rewritten to the admin page", () => {
  const root = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
  const admin = root("admin/index.html");
  const block = admin.match(/var TAB_SLUGS = \{([\s\S]*?)\};/)[1];
  const slugs = [...block.matchAll(/:\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(slugs.includes("health") && slugs.includes("status"));
  const redirects = root("_redirects");
  for (const slug of slugs) {
    assert.match(redirects, new RegExp(`^/admin/${slug}\\s+/admin/\\s+200$`, "m"), slug);
    assert.match(redirects, new RegExp(`^/admin/${slug}/\\s+/admin/\\s+200$`, "m"), `${slug}/`);
  }
});

test("a link that already has a query string, or another file, is left alone", () => {
  const html = '<link href="/styles.css?v=old" /><a href="/admin/">x</a><script src="https://cdn.example/quill.js"></script>';
  assert.equal(versionStaticAssetLinks(html, "new"), html);
});

test("every hand-authored page links styles.css in a form the build will version", () => {
  for (const page of ["about", "admin", "colophon", "contact"]) {
    const html = readFileSync(fileURLToPath(new URL(`../../${page}/index.html`, import.meta.url)), "utf8");
    assert.match(versionStaticAssetLinks(html, "X"), /styles\.css\?v=X"/, page);
  }
});
