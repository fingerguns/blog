// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { escHtml } from "./html.mjs";

import {
  BSKY_HASHTAG_BASE,
  URL_DISPLAY_MAX,
  blueskyHashtagUrl,
  linkifyUrls,
  linkifyHashtags,
  linkifyThinkingEscapedHtml,
  urlDisplayLabel,
  addHashtagFacets,
} from "./linkify.mjs";

const enc = new TextEncoder();

test("bare URLs become links, with the scheme dropped from the label", () => {
  assert.equal(
    linkifyUrls("see https://example.com/x"),
    'see <a href="https://example.com/x" target="_blank" rel="noopener">example.com/x</a>'
  );
});

test("trailing sentence punctuation stays outside the link", () => {
  // Otherwise the period would be part of the href and 404.
  const out = linkifyUrls("see https://example.com/x.");
  assert.ok(out.includes('href="https://example.com/x"'), "href excludes the period");
  assert.ok(out.endsWith("</a>."), "period is rendered after the link");
});

test("a short URL's label is the host and path, no ellipsis, no title", () => {
  assert.equal(urlDisplayLabel("https://github.com/fingerguns/blog"), "github.com/fingerguns/blog");
  const out = linkifyUrls("https://github.com/fingerguns/blog");
  assert.ok(out.includes('href="https://github.com/fingerguns/blog"'));
  assert.ok(out.includes(">github.com/fingerguns/blog</a>"));
  assert.ok(!out.includes("title="), "hover title is only for truncated labels");
});

test("a long URL is clipped to URL_DISPLAY_MAX with a trailing ellipsis", () => {
  const href =
    "https://www.nytimes.com/2026/11/05/technology/tech-billionaires-democrats-midterms.html?smid=li-nytimes&smtyp=cur";
  const label = urlDisplayLabel(href);
  assert.equal(label.length, URL_DISPLAY_MAX);
  assert.equal(label.at(-1), "…");
  assert.ok(label.startsWith("www.nytimes.com/"));
  assert.ok(!label.includes("https://"), "scheme is display-only noise");

  const out = linkifyUrls(href);
  assert.ok(out.includes(`href="${href}"`), "href stays the full address");
  assert.ok(out.includes(`title="${escHtml(href)}"`), "hover shows the full address");
  assert.ok(out.includes(`>${label}</a>`));
});

test("a URL at the limit is not clipped, one character over is", () => {
  const exact = `https://${"a".repeat(URL_DISPLAY_MAX)}`;
  const over = `https://${"a".repeat(URL_DISPLAY_MAX + 1)}`;
  assert.equal(urlDisplayLabel(exact), "a".repeat(URL_DISPLAY_MAX));
  assert.equal(urlDisplayLabel(over), `${"a".repeat(URL_DISPLAY_MAX - 1)}…`);
});

test("an &amp; in an escaped URL does not break truncation or the href", () => {
  const escaped = "https://example.com/search?q=a&amp;b=2&amp;very-long-path-that-forces-the-label-to-clip";
  const out = linkifyUrls(escaped);
  assert.ok(out.includes(`href="${escaped}"`), "href keeps the escaped ampersands");
  assert.ok(out.includes('title="https://example.com/search?q=a&amp;b=2&amp;very-long-path-that-forces-the-label-to-clip"'));
  assert.ok(out.includes("…</a>"));
});

test("hashtags link to Bluesky search", () => {
  assert.equal(blueskyHashtagUrl("brooklyn"), `${BSKY_HASHTAG_BASE}brooklyn`);
  const out = linkifyHashtags("walked #brooklyn today");
  assert.ok(out.includes(`href="${BSKY_HASHTAG_BASE}brooklyn"`));
  assert.ok(out.includes(">#brooklyn</a>"));
});

test("hashtags inside existing links are left alone", () => {
  // A URL fragment like #section must not become a hashtag link.
  const html = '<a href="https://example.com/#section">https://example.com/#section</a>';
  assert.equal(linkifyHashtags(html), html);
});

test("a hashtag must start with a letter or underscore", () => {
  assert.equal(linkifyHashtags("#1st"), "#1st", "digits cannot start a tag");
  assert.ok(linkifyHashtags("#_private").includes("</a>"), "underscore can");
});

test("URL and hashtag linking compose without double-linking", () => {
  const out = linkifyThinkingEscapedHtml("see https://example.com/#anchor and #tag");
  assert.equal((out.match(/<a /g) || []).length, 2, "one link for the URL, one for the tag");
  assert.ok(out.includes(`href="${BSKY_HASHTAG_BASE}tag"`));
  // The #anchor inside the URL must not have been turned into a tag link.
  assert.ok(!out.includes(`${BSKY_HASHTAG_BASE}anchor`));
});

test("facets mark hashtags with byte offsets, not character offsets", () => {
  // Bluesky indexes by UTF-8 bytes. An emoji ahead of the tag is 4 bytes but
  // 2 JS characters, so character offsets would point at the wrong text.
  const text = "🎧 #music";
  const facets = [];
  addHashtagFacets(text, facets, enc);

  assert.equal(facets.length, 1);
  const { byteStart, byteEnd } = facets[0].index;
  const slice = Buffer.from(enc.encode(text)).subarray(byteStart, byteEnd).toString();
  assert.equal(slice, "#music", "byte range selects exactly the hashtag");
  assert.equal(facets[0].features[0].tag, "music", "tag is stored without the #");
});

test("facets are not created mid-word", () => {
  const facets = [];
  addHashtagFacets("email me at a#notatag", facets, enc);
  assert.deepEqual(facets, []);
});

test("facets skip ranges that already overlap an existing facet", () => {
  // Link facets are added first; a hashtag inside a URL must not double-annotate.
  const text = "#tag";
  const facets = [
    {
      $type: "app.bsky.richtext.facet",
      index: { byteStart: 0, byteEnd: 4 },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com" }],
    },
  ];
  addHashtagFacets(text, facets, enc);
  assert.equal(facets.length, 1, "no tag facet added over the existing link facet");
});

test("multiple hashtags each get their own facet", () => {
  const text = "#one #two #three";
  const facets = [];
  addHashtagFacets(text, facets, enc);
  assert.deepEqual(
    facets.map((f) => f.features[0].tag),
    ["one", "two", "three"]
  );
});
