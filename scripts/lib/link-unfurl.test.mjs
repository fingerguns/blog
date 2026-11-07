// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LINK_UNFURL_USER_AGENT,
  UNFURL_FETCHER_CACHE_KEY,
  UNFURL_FETCHER_ID,
  fetchLinkUnfurl,
  invalidateUnfurlMisses,
  parseLinkUnfurl,
} from "./link-unfurl.mjs";

const PAGE = "https://example.com/articles/one";

test("reads Open Graph title, image, description and site name", () => {
  const html = `<head>
    <meta property="og:title" content="A Title" />
    <meta property="og:image" content="/img/cover.jpg" />
    <meta property="og:description" content="About it." />
    <meta property="og:site_name" content="Example" />
  </head>`;
  assert.deepEqual(parseLinkUnfurl(html, PAGE), {
    title: "A Title",
    image: "https://example.com/img/cover.jpg",
    description: "About it.",
    siteName: "Example",
  });
});

test("an apostrophe inside a double-quoted value does not cut it short", () => {
  const html = `<meta property="og:title" content="Don't Look Up">`;
  assert.equal(parseLinkUnfurl(html, PAGE).title, "Don't Look Up");
});

test("content before property is read too", () => {
  const html = `<meta content='Reversed' name="twitter:title">`;
  assert.equal(parseLinkUnfurl(html, PAGE).title, "Reversed");
});

test("falls back to <title>, decoding entities", () => {
  const html = `<title>\n  Caf&#233; &amp; Bar &#x2014; Home\n</title>`;
  assert.equal(parseLinkUnfurl(html, PAGE).title, "Café & Bar — Home");
});

test("a non-http image is dropped", () => {
  const html = `<meta property="og:title" content="T"><meta property="og:image" content="javascript:alert(1)">`;
  assert.equal(parseLinkUnfurl(html, PAGE).image, null);
});

test("a page with nothing to show yields null", () => {
  assert.equal(parseLinkUnfurl("<html><body>hi</body></html>", PAGE), null);
});

test("reads a title with attributes on the tag, as NYTimes serves", () => {
  const html = `<title data-rh="true">Tech Billionaires Face Tricky Political Waters</title>
    <meta property="og:title" content="Tech Billionaires Face Tricky Political Waters After Democratic Midterm Sweep"/>
    <meta property="og:image" content="https://static01.nyt.com/images/cover.jpg"/>
    <meta property="og:description" content="Many donated money to President Trump’s favored causes."/>
    <meta property="og:site_name" content="The New York Times"/>`;
  const parsed = parseLinkUnfurl(html, "https://www.nytimes.com/article");
  assert.equal(
    parsed.title,
    "Tech Billionaires Face Tricky Political Waters After Democratic Midterm Sweep"
  );
  assert.equal(parsed.image, "https://static01.nyt.com/images/cover.jpg");
  assert.equal(parsed.siteName, "The New York Times");
});

test("invalidateUnfurlMisses drops false entries once per fetcher identity", () => {
  const cache = {
    "https://ok.example/": { title: "Ok" },
    "https://blocked.example/": false,
  };
  invalidateUnfurlMisses(cache);
  assert.deepEqual(cache["https://ok.example/"], { title: "Ok" });
  assert.equal("https://blocked.example/" in cache, false);
  assert.equal(cache[UNFURL_FETCHER_CACHE_KEY], UNFURL_FETCHER_ID);

  cache["https://blocked.example/"] = false;
  invalidateUnfurlMisses(cache);
  assert.equal(cache["https://blocked.example/"], false, "a later build must not keep retrying");
});

test("invalidateUnfurlMisses refetches misses after the fetcher identity changes", () => {
  const cache = {
    [UNFURL_FETCHER_CACHE_KEY]: "old-bot",
    "https://blocked.example/": false,
  };
  invalidateUnfurlMisses(cache, "new-bot");
  assert.equal("https://blocked.example/" in cache, false);
  assert.equal(cache[UNFURL_FETCHER_CACHE_KEY], "new-bot");
});

test("fetchLinkUnfurl sends the preview-crawler user-agent", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, ua: init.headers["user-agent"] });
    return {
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "",
    };
  };
  try {
    assert.equal(await fetchLinkUnfurl("https://www.nytimes.com/article"), null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].ua, LINK_UNFURL_USER_AGENT);
    assert.match(seen[0].ua, /Twitterbot/);
    assert.match(seen[0].ua, /fingergunsbot/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
