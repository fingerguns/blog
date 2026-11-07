// Run with: npm test
//
// Thinking permalink og:image used to miss native video (the note is a
// <video>, not an <img>) and fall back to the favicon. Mastodon and
// Micro.blog unfurl that page, so a missing still made oversized clips
// look like a text post.

import { test } from "node:test";
import assert from "node:assert/strict";

import { thinkingOgFromItem, defaultOgImage } from "./render/pages.mjs";

const SITE = "https://rommy.blog";
const ctx = { base: SITE, siteTitle: "rommy.blog" };
const videoSrc = `${SITE}/media/thinking/video/2026-07-12/clip.mp4`;
const posterUrl = `${SITE}/media/thinking/video/2026-07-12/clip-poster.jpg`;
const photoUrl = `${SITE}/media/thinking/photo/a.jpg`;

test("a video note's og:image is its stored still, not the favicon", () => {
  const item = {
    content_html: `<video class="thinking-video" controls preload="metadata" playsinline src="${videoSrc}#t=0.001">Video</video>`,
  };
  const og = thinkingOgFromItem(item, ctx, { videoPosters: { [videoSrc]: true } });
  assert.equal(og.image, posterUrl);
});

test("a video without a poster still falls back to the favicon", () => {
  const item = {
    content_html: `<video class="thinking-video" src="${videoSrc}#t=0.001">Video</video>`,
  };
  const og = thinkingOgFromItem(item, ctx, { videoPosters: { [videoSrc]: false } });
  assert.equal(og.image, defaultOgImage(ctx));
  assert.equal(thinkingOgFromItem(item, ctx).image, defaultOgImage(ctx));
});

test("a photo note still uses the photo, even if a video poster cache is present", () => {
  const item = {
    content_html: `<img src="${photoUrl}" alt="Photo">`,
  };
  const og = thinkingOgFromItem(item, ctx, { videoPosters: { [videoSrc]: true } });
  assert.equal(og.image, photoUrl);
});
