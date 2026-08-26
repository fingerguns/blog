// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GRID_THUMB_WIDTH,
  toSiteMediaUrl,
  videoPosterKeyFromVideoUrl,
  upgradeSpotifyImageUrl,
  thinkingGridThumbUrl,
} from "./media-url.mjs";

const SITE = "https://rommy.blog";

test("legacy r2.dev URLs are rewritten to same-origin /media/ paths", () => {
  // Same-origin matters: iOS Safari only does byte-range audio/video streaming
  // from the page's own origin.
  assert.equal(
    toSiteMediaUrl("https://pub-abc123.r2.dev/thinking/audio/2026-01-01/x.m4a", SITE),
    `${SITE}/media/thinking/audio/2026-01-01/x.m4a`
  );
});

test("URLs already on the site's /media/ path are left alone", () => {
  const url = `${SITE}/media/thinking/photo/a.jpg`;
  assert.equal(toSiteMediaUrl(url, SITE), url);
});

test("unrelated URLs pass through untouched", () => {
  for (const url of [
    "https://example.com/thinking/x.jpg",
    "https://pub-abc123.r2.dev/reading/covers/x.jpg", // r2.dev but not /thinking/
    "not a url",
    "",
  ]) {
    assert.equal(toSiteMediaUrl(url, SITE), url || "", url);
  }
});

test("a trailing slash on siteUrl does not break rewriting", () => {
  assert.equal(
    toSiteMediaUrl("https://pub-abc.r2.dev/thinking/video/x.mov", "https://rommy.blog/"),
    `${SITE}/media/thinking/video/x.mov`
  );
});

test("video poster keys pair with the video file", () => {
  for (const ext of ["mp4", "mov", "m4v", "MOV"]) {
    assert.equal(
      videoPosterKeyFromVideoUrl(`${SITE}/media/thinking/video/2026-07-12/clip.${ext}`, SITE),
      "thinking/video/2026-07-12/clip-poster.jpg",
      ext
    );
  }
});

test("poster keys are derived after r2.dev normalisation", () => {
  assert.equal(
    videoPosterKeyFromVideoUrl("https://pub-abc.r2.dev/thinking/video/2026-07-12/clip.mov", SITE),
    "thinking/video/2026-07-12/clip-poster.jpg"
  );
});

test("non-video media yields no poster key", () => {
  for (const url of [
    `${SITE}/media/thinking/photo/a.jpg`,
    `${SITE}/media/thinking/audio/a.m4a`,
    `${SITE}/media/reading/covers/a.mp4`, // right extension, wrong prefix
    "https://example.com/x.mov",
    "",
  ]) {
    assert.equal(videoPosterKeyFromVideoUrl(url, SITE), "", url);
  }
});

test("Spotify album art is upgraded to the 640px variant", () => {
  assert.equal(
    upgradeSpotifyImageUrl("https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02abc"),
    "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273abc"
  );
  // Already largest — unchanged, and importantly not double-substituted.
  const largest = "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273abc";
  assert.equal(upgradeSpotifyImageUrl(largest), largest);
});

test("podcast art and non-Spotify URLs are not rewritten", () => {
  // Show/episode art (ab676563…) has no size suffix to swap.
  const show = "https://image-cdn-fa.spotifycdn.com/image/ab6765630000ba8aabc";
  assert.equal(upgradeSpotifyImageUrl(show), show);

  const other = "https://example.com/image/ab67616d00001e02abc";
  assert.equal(upgradeSpotifyImageUrl(other), other);
  assert.equal(upgradeSpotifyImageUrl(""), "");
});

test("grid thumbs route site images through the Worker resizer", () => {
  for (const prefix of ["thinking", "reading"]) {
    assert.equal(
      thinkingGridThumbUrl(`${SITE}/media/${prefix}/photo/a.jpg`, SITE),
      `${SITE}/media/thumb/${GRID_THUMB_WIDTH}/${prefix}/photo/a.jpg`,
      prefix
    );
  }
  // r2.dev originals are normalised first, then resized.
  assert.equal(
    thinkingGridThumbUrl("https://pub-abc.r2.dev/thinking/photo/a.png", SITE),
    `${SITE}/media/thumb/${GRID_THUMB_WIDTH}/thinking/photo/a.png`
  );
});

test("grid thumbs upgrade Spotify art rather than resizing it", () => {
  // Third-party thumbnails are hotlinked, not proxied — a deliberate boundary.
  assert.equal(
    thinkingGridThumbUrl("https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02abc", SITE),
    "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273abc"
  );
});

test("grid thumbs promote YouTube previews to sddefault", () => {
  for (const size of ["default", "mqdefault", "hqdefault", "sddefault"]) {
    assert.equal(
      thinkingGridThumbUrl(`https://i.ytimg.com/vi/abc/${size}.jpg`, SITE),
      "https://i.ytimg.com/vi/abc/sddefault.jpg",
      size
    );
  }
});

test("grid thumbs leave anything else alone", () => {
  const video = `${SITE}/media/thinking/video/a.mov`;
  assert.equal(thinkingGridThumbUrl(video, SITE), video, "video is not an image");
  assert.equal(thinkingGridThumbUrl("https://example.com/a.jpg", SITE), "https://example.com/a.jpg");
  assert.equal(thinkingGridThumbUrl("", SITE), "");
});
