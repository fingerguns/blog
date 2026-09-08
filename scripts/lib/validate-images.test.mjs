// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findBrokenImages,
  formatBrokenImages,
  imageSources,
  isLocallyCheckable,
  resolveToOutputPath,
} from "./validate-images.mjs";

test("pulls every img src out of a page", () => {
  const html = `<p>hi</p><img src="/a.png"><img class="x" src='/b.jpg' alt="q"><img>`;
  assert.deepEqual(imageSources(html), ["/a.png", "/b.jpg"]);
});

test("an img with no src is not a reference", () => {
  // The Thinking lightbox ships <img alt="" draggable="false"> and fills it in
  // from JavaScript. It is not broken.
  assert.deepEqual(imageSources(`<img alt="" draggable="false" />`), []);
});

test("skips what cannot be checked from disk", () => {
  for (const src of [
    "",
    "   ",
    "data:image/png;base64,iVBOR",
    "blob:https://x/y",
    "https://example.com/a.png",
    "http://example.com/a.png",
    "//cdn.example.com/a.png",
    "/media/posts/veri-ad.jpg",
    "/media/thumb/512/thinking/x.jpg",
    "#frag",
  ]) {
    assert.equal(isLocallyCheckable(src), false, `should skip ${JSON.stringify(src)}`);
  }
});

test("checks paths that should be files in the built site", () => {
  assert.equal(isLocallyCheckable("/favicon.png"), true);
  assert.equal(isLocallyCheckable("veri-ad.png"), true);
  assert.equal(isLocallyCheckable("./art.jpg"), true);
  assert.equal(isLocallyCheckable("../up.jpg"), true);
});

test("a rooted path resolves from the output root", () => {
  assert.equal(resolveToOutputPath("/favicon.png", "/posts/thing/"), "favicon.png");
  assert.equal(resolveToOutputPath("/img/a.png", "/deep/page/"), "img/a.png");
});

test("a relative path resolves against the page, not the site root", () => {
  // This is the exact shape of the Veri bug: the page is a directory, so a bare
  // filename points inside it.
  assert.equal(
    resolveToOutputPath("veri-ad.png", "/posts/for-the-film-buffs-out-there-veri/"),
    "posts/for-the-film-buffs-out-there-veri/veri-ad.png"
  );
  assert.equal(resolveToOutputPath("./a.png", "/posts/x/"), "posts/x/a.png");
  assert.equal(resolveToOutputPath("../a.png", "/posts/x/"), "posts/a.png");
});

test("query strings and fragments are not part of the path", () => {
  assert.equal(resolveToOutputPath("/a.png?v=2", "/"), "a.png");
  assert.equal(resolveToOutputPath("/a.png#top", "/"), "a.png");
});

test("percent-encoding is decoded to match the file on disk", () => {
  assert.equal(resolveToOutputPath("/img/a%20b.png", "/"), "img/a b.png");
});

test("reports a reference with no file behind it", () => {
  const pages = [
    {
      urlPath: "/posts/for-the-film-buffs-out-there-veri/",
      html: `<img src="veri-ad.png" alt="ad">`,
    },
  ];
  const broken = findBrokenImages(pages, () => false);
  assert.equal(broken.length, 1);
  assert.deepEqual(broken[0], {
    urlPath: "/posts/for-the-film-buffs-out-there-veri/",
    src: "veri-ad.png",
    target: "posts/for-the-film-buffs-out-there-veri/veri-ad.png",
  });
});

test("says nothing when every reference resolves", () => {
  const pages = [{ urlPath: "/", html: `<img src="/favicon.png">` }];
  assert.deepEqual(findBrokenImages(pages, (p) => p === "favicon.png"), []);
});

test("the fix for the real bug passes the check", () => {
  // /media/* is served by the Worker from R2, so it is skipped rather than
  // looked for in dist/ — which is why the corrected post validates.
  const pages = [
    {
      urlPath: "/posts/for-the-film-buffs-out-there-veri/",
      html: `<img src="/media/posts/veri-ad.jpg" alt="ad">`,
    },
  ];
  assert.deepEqual(findBrokenImages(pages, () => false), []);
});

test("collects every broken reference, not just the first", () => {
  const pages = [
    { urlPath: "/a/", html: `<img src="one.png"><img src="two.png">` },
    { urlPath: "/b/", html: `<img src="three.png">` },
  ];
  assert.equal(findBrokenImages(pages, () => false).length, 3);
});

test("the message names the page, the src and the path it wanted", () => {
  const msg = formatBrokenImages([
    { urlPath: "/posts/x/", src: "a.png", target: "posts/x/a.png" },
  ]);
  assert.match(msg, /1 image reference will not resolve/);
  assert.match(msg, /\/posts\/x\//);
  assert.match(msg, /src="a\.png"/);
  assert.match(msg, /dist\/posts\/x\/a\.png \(missing\)/);
  assert.match(msg, /200/); // explains why it fails silently in production
});
