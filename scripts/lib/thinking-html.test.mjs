// Run with: npm test
//
// renderThinkingContentHtml runs over every Thinking note on the site, so a
// regression here corrupts hundreds of pages at once.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  stripEmbeddableUrls,
  stripUnfurledUrls,
  inferMediaType,
  renderThinkingContentHtml,
  unfurlableUrls,
  MAX_UNFURLS_PER_NOTE,
  singlePhotoUrl,
  isQuoteParagraph,
  stripQuoteMarkers,
  thinkingQuotesForSyndication,
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

test("a video with a full-frame still shows it as the poster, sized, loading nothing", () => {
  // Mobile Safari may never draw the first frame (Low Power mode, too many
  // videos on the page); the still and the box size make that not matter.
  const src = `${SITE}/media/thinking/video/2026-07-12/a.mov`;
  const out = renderThinkingContentHtml("", src, "", "video", SITE, {
    videoFrame: (u) => (u === src ? { width: 1920, height: 1080 } : null),
  });
  assert.ok(out.includes(`poster="${SITE}/media/thinking/video/2026-07-12/a-frame.jpg"`));
  assert.ok(out.includes('width="1920" height="1080"'));
  assert.ok(out.includes('preload="none"'));
  assert.ok(out.includes(`src="${src}#t=0.001"`), "src and first-frame fragment unchanged");
});

test("a video without a still keeps the first-frame fallback", () => {
  const out = renderThinkingContentHtml("", `${SITE}/media/thinking/video/a.mov`, "", "video", SITE, {
    videoFrame: () => null,
  });
  assert.ok(!out.includes("poster="));
  assert.ok(out.includes('preload="metadata"'));
});

test("eager video preload is opt-in, not the permalink default", () => {
  // Permalinks used to pass videoPreload: "auto"; a 1 GB clip would start
  // downloading on page open. The renderer still accepts the option.
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

// ── unfurlableUrls ───────────────────────────────────────────────────────────

test("every ordinary link gets a card, in order, without trailing punctuation", () => {
  assert.deepEqual(
    unfurlableUrls("see https://a.example/x, and (https://b.example/y)."),
    ["https://a.example/x", "https://b.example/y"]
  );
});

test("YouTube and Spotify links get no card — they are already players", () => {
  assert.deepEqual(unfurlableUrls(`${YT} ${SP} https://a.example/`), ["https://a.example/"]);
});

test("a link repeated in one note gets one card", () => {
  assert.deepEqual(unfurlableUrls("https://a.example/ https://a.example/."), ["https://a.example/"]);
});

test("a note shows at most MAX_UNFURLS_PER_NOTE cards", () => {
  const text = Array.from({ length: 6 }, (_, i) => `https://e${i}.example/`).join(" ");
  assert.equal(unfurlableUrls(text).length, MAX_UNFURLS_PER_NOTE);
});

test("no text, no cards", () => {
  assert.deepEqual(unfurlableUrls(""), []);
  assert.deepEqual(unfurlableUrls(undefined), []);
});

test("a single landscape photo renders at its own aspect ratio", () => {
  const url = `${SITE}/media/thinking/photo/wide.jpg`;
  const sizes = { [url]: { width: 4032, height: 3024 } };
  const out = renderThinkingContentHtml("", url, "", "image", SITE, {
    photoSize: (u) => sizes[u] || null,
  });
  assert.ok(out.includes("thinking-photo-tile--single"));
  assert.ok(out.includes("thinking-photo-tile--landscape"));
  assert.ok(out.includes('width="4032" height="3024"'));
});

test("portrait, square, and unmeasured single photos stay square", () => {
  const url = `${SITE}/media/thinking/photo/a.jpg`;
  for (const size of [{ width: 3024, height: 4032 }, { width: 2000, height: 2000 }, null]) {
    const out = renderThinkingContentHtml("", url, "", "image", SITE, { photoSize: () => size });
    assert.ok(out.includes("thinking-photo-tile--single"));
    assert.ok(!out.includes("thinking-photo-tile--landscape"));
    assert.ok(!out.includes("width="));
  }
});

test("landscape photos in a multi-photo grid stay square tiles", () => {
  const urls = [1, 2].map((i) => `${SITE}/media/thinking/photo/${i}.jpg`);
  const out = renderThinkingContentHtml("", "", "", "image", SITE, {
    mediaUrls: urls,
    photoSize: () => ({ width: 4000, height: 3000 }),
  });
  assert.ok(out.includes("thinking-photo-grid"));
  assert.ok(!out.includes("thinking-photo-tile--landscape"));
});

test("singlePhotoUrl resolves only when a note has exactly one photo", () => {
  const url = `${SITE}/media/thinking/photo/a.jpg`;
  assert.equal(singlePhotoUrl(url, "image", SITE), url);
  assert.equal(singlePhotoUrl(url, "image", SITE, [url, `${SITE}/media/thinking/photo/b.jpg`]), "");
  assert.equal(singlePhotoUrl(`${SITE}/media/thinking/video/a.mov`, "video", SITE), "");
});

test("stripUnfurledUrls drops carded links that end a line", () => {
  const carded = (url) => url === "https://example.com/a" || url === "https://example.com/b";
  assert.equal(stripUnfurledUrls("Read this https://example.com/a", carded), "Read this");
  assert.equal(stripUnfurledUrls("Read this https://example.com/a.", carded), "Read this");
  assert.equal(stripUnfurledUrls("Both https://example.com/a https://example.com/b", carded), "Both");
  assert.equal(stripUnfurledUrls("https://example.com/a", carded), "");
  assert.equal(stripUnfurledUrls("Top\nhttps://example.com/a\n\nNext", carded), "Top\n\nNext");
});

test("stripUnfurledUrls keeps links mid-sentence, without a card, or in brackets", () => {
  const carded = (url) => url === "https://example.com/a";
  assert.equal(stripUnfurledUrls("See https://example.com/a today", carded), "See https://example.com/a today");
  assert.equal(stripUnfurledUrls("See https://example.com/z", carded), "See https://example.com/z");
  assert.equal(stripUnfurledUrls("(see https://example.com/a)", carded), "(see https://example.com/a)");
  assert.equal(stripUnfurledUrls("See https://example.com/a", undefined), "See https://example.com/a");
});

test("renderThinkingContentHtml hides a URL that has a card", () => {
  const html = renderThinkingContentHtml("Read this https://example.com/a", "", "", "", "", {
    isUnfurled: (url) => url === "https://example.com/a",
  });
  assert.equal(html, "<p>Read this</p>");
});

// ---- Quotes ("> " paragraphs from the composer's Quote button) ----

test("a quote paragraph renders as a blockquote between normal paragraphs", () => {
  const html = renderThinkingContentHtml("Before.\n\n> To be, or not\n> to be.\n\nAfter.");
  assert.equal(
    html,
    '<p>Before.</p>\n<blockquote class="thinking-quote"><p>To be, or not<br>to be.</p></blockquote>\n<p>After.</p>'
  );
});

test("a paragraph with only some quoted lines stays plain text", () => {
  const html = renderThinkingContentHtml("> one\ntwo");
  assert.equal(html, "<p>&gt; one<br>two</p>");
});

test("links inside a quote are still linkified", () => {
  const html = renderThinkingContentHtml("> See https://example.com/a now");
  assert.match(html, /^<blockquote class="thinking-quote"><p>See <a [^>]*href="https:\/\/example\.com\/a"/);
});

test("a bare > with no words renders nothing", () => {
  assert.equal(renderThinkingContentHtml("Hi\n\n>"), "<p>Hi</p>");
});

test("isQuoteParagraph needs every non-empty line quoted", () => {
  assert.equal(isQuoteParagraph("> a\n> b"), true);
  assert.equal(isQuoteParagraph("> a\nb"), false);
  assert.equal(isQuoteParagraph("a > b"), false);
});

test("thinkingQuotesForSyndication wraps each quote in curly quotes", () => {
  assert.equal(
    thinkingQuotesForSyndication("So true:\n\n> Less, but better.\n\nDieter Rams"),
    "So true:\n\n“Less, but better.”\n\nDieter Rams"
  );
  assert.equal(thinkingQuotesForSyndication("> one\n\n> two"), "“one”\n\n“two”");
  assert.equal(thinkingQuotesForSyndication("> a\n> b"), "“a\nb”");
});

test("thinkingQuotesForSyndication leaves quotes that already open with a mark", () => {
  assert.equal(thinkingQuotesForSyndication("> “Already quoted.”"), "“Already quoted.”");
  assert.equal(thinkingQuotesForSyndication('> "Straight."'), '"Straight."');
});

test("text with no quote passes through unchanged", () => {
  const t = "Just a thought.\n\nWith a 2 > 1 aside.";
  assert.equal(thinkingQuotesForSyndication(t), t);
  assert.equal(stripQuoteMarkers(t), t);
});

test("stripQuoteMarkers leaves the quoted words", () => {
  assert.equal(stripQuoteMarkers("Hi\n\n> a\n> b"), "Hi\n\na\nb");
});

test("a text note with a quote files under the quote filter; media still wins", async () => {
  const { thinkingGridKind } = await import("./render/thinking.mjs");
  assert.equal(thinkingGridKind({ content_html: renderThinkingContentHtml("> Words.\n\nAuthor") }), "quote");
  assert.equal(thinkingGridKind({ content_html: renderThinkingContentHtml("Just words.") }), "text");
  assert.equal(
    thinkingGridKind({ content_html: renderThinkingContentHtml("> Words.", "https://rommy.blog/media/thinking/a.jpg", "", "image", "https://rommy.blog") }),
    "photo"
  );
});
