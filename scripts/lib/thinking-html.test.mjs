// Run with: npm test
//
// renderThinkingContentHtml runs over every Thinking note on the site, so a
// regression here corrupts hundreds of pages at once.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  stripEmbeddableUrls,
  inferMediaType,
  renderThinkingContentHtml,
} from "./thinking-html.mjs";

const SITE = "https://rommy.blog";
const YT = "https://youtu.be/dQw4w9WgXcQ";
const SP = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";

// ── stripEmbeddableUrls ──────────────────────────────────────────────────────

test("URLs that become native embeds are removed from the text", () => {
  // They render as players below the note, so leaving them inline duplicates them.
  assert.equal(stripEmbeddableUrls(`listen ${SP}`), "listen");
  assert.equal(stripEmbeddableUrls(`watch ${YT}`), "watch");
});

test("ordinary links stay in the text", () => {
  const text = "read https://example.com/post";
  assert.equal(stripEmbeddableUrls(text), text);
});

test("stripping collapses the whitespace it leaves behind", () => {
  assert.equal(stripEmbeddableUrls(`a ${YT} b`), "a b");
  assert.equal(stripEmbeddableUrls(`a\n\n${YT}\n\nb`), "a\n\nb");
  assert.equal(stripEmbeddableUrls(""), "");
  assert.equal(stripEmbeddableUrls(null), "");
});

// ── inferMediaType ───────────────────────────────────────────────────────────

test("an explicit media type always wins", () => {
  assert.equal(inferMediaType("x.jpg", "audio"), "audio");
  assert.equal(inferMediaType("x.mp4", "image"), "image");
});

test("media type falls back to the file extension", () => {
  assert.equal(inferMediaType("a/b.m4a"), "audio");
  assert.equal(inferMediaType("a/b.mp3"), "audio");
  assert.equal(inferMediaType("a/b.mov"), "video");
  assert.equal(inferMediaType("a/b.MP4"), "video", "case-insensitive");
  assert.equal(inferMediaType("a/b.mp4?v=2"), "video", "query string tolerated");
});

test("anything else with a URL is treated as an image, and nothing as empty", () => {
  assert.equal(inferMediaType("a/b.jpg"), "image");
  assert.equal(inferMediaType("a/b.heic"), "image", "unknown extensions default to image");
  assert.equal(inferMediaType(""), "");
  assert.equal(inferMediaType(null), "");
});

// ── renderThinkingContentHtml ────────────────────────────────────────────────

test("text is HTML-escaped", () => {
  const out = renderThinkingContentHtml('<script>alert("x")</script>', "", "", "", SITE);
  assert.ok(!out.includes("<script>"), "no raw script tag survives");
  assert.ok(out.includes("&lt;script&gt;"));
});

test("alt text is escaped too", () => {
  const out = renderThinkingContentHtml("", `${SITE}/media/thinking/photo/a.jpg`, '"><script>', "image", SITE);
  assert.ok(!out.includes("<script>"));
});

test("blank lines split paragraphs and single newlines become breaks", () => {
  const out = renderThinkingContentHtml("one\n\ntwo\nthree", "", "", "", SITE);
  assert.equal((out.match(/<p>/g) || []).length, 2);
  assert.ok(out.includes("two<br>three"));
});

test("embeds render after the text, YouTube before Spotify", () => {
  const out = renderThinkingContentHtml(`note ${SP} ${YT}`, "", "", "", SITE);
  const p = out.indexOf("<p>");
  const yt = out.indexOf("thinking-youtube");
  const sp = out.indexOf("thinking-spotify");

  assert.ok(p < yt && yt < sp, "paragraph, then YouTube, then Spotify");
  assert.ok(out.includes("youtube-nocookie.com/embed/dQw4w9WgXcQ"), "privacy-preserving host");
  assert.ok(!out.includes(`>${YT}<`), "the URL itself is not also shown inline");
});

test("a YouTube start time is carried into the embed", () => {
  const out = renderThinkingContentHtml(`${YT}?t=90`, "", "", "", SITE);
  assert.ok(out.includes("embed/dQw4w9WgXcQ?start=90"));
});

test("audio renders a player with the media URL normalised", () => {
  const out = renderThinkingContentHtml(
    "listen",
    "https://pub-abc.r2.dev/thinking/audio/a.m4a",
    "",
    "audio",
    SITE
  );
  assert.ok(out.includes("<audio"));
  assert.ok(out.includes(`src="${SITE}/media/thinking/audio/a.m4a"`), "rewritten to same origin");
});

test("video gets the iOS first-frame fragment", () => {
  // Without #t=0.001 mobile Safari renders a blank box instead of a poster frame.
  const out = renderThinkingContentHtml("", `${SITE}/media/thinking/video/a.mov`, "", "video", SITE);
  assert.ok(out.includes("<video"));
  assert.ok(out.includes("#t=0.001"));
  assert.ok(out.includes('preload="metadata"'), "default preload");
});

test("detail pages can request eager video preload", () => {
  const out = renderThinkingContentHtml("", `${SITE}/media/thinking/video/a.mov`, "", "video", SITE, {
    videoPreload: "auto",
  });
  assert.ok(out.includes('preload="auto"'));
});

test("one photo renders a single tile, several render a grid", () => {
  const one = renderThinkingContentHtml("", `${SITE}/media/thinking/photo/a.jpg`, "", "image", SITE);
  assert.ok(one.includes("thinking-photo-tile--single"));
  assert.ok(!one.includes("thinking-photo-grid"));

  const many = renderThinkingContentHtml("", "", "", "image", SITE, {
    mediaUrls: [1, 2, 3].map((i) => `${SITE}/media/thinking/photo/${i}.jpg`),
  });
  assert.ok(many.includes("thinking-photo-grid"));
  assert.equal((many.match(/thinking-photo-tile/g) || []).length, 3);
});

test("photo galleries are capped at four", () => {
  const out = renderThinkingContentHtml("", "", "", "image", SITE, {
    mediaUrls: [1, 2, 3, 4, 5, 6].map((i) => `${SITE}/media/thinking/photo/${i}.jpg`),
  });
  assert.equal((out.match(/data-gallery-index/g) || []).length, 4);
});

test("an empty note renders nothing at all", () => {
  assert.equal(renderThinkingContentHtml("", "", "", "", SITE), "");
  assert.equal(renderThinkingContentHtml(null, null, null, "", SITE), "");
});

test("a note that is only an embeddable link renders the embed and no empty paragraph", () => {
  const out = renderThinkingContentHtml(YT, "", "", "", SITE);
  assert.ok(out.includes("thinking-youtube"));
  assert.ok(!out.includes("<p>"), "no blank paragraph left behind");
});
