// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLinkUnfurl } from "./link-unfurl.mjs";

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
