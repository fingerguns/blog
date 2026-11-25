// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SHORT_COLOPHON_WORD_LIMIT, colophonSection, countWords, htmlToText, shortColophonWordCount } from "./colophon.mjs";

const html = readFileSync(fileURLToPath(new URL("../../colophon/index.html", import.meta.url)), "utf8");

test("the short-form colophon stays under its word limit", () => {
  const words = shortColophonWordCount(html);
  assert.ok(words < SHORT_COLOPHON_WORD_LIMIT, `short-form colophon is ${words} words; limit is under ${SHORT_COLOPHON_WORD_LIMIT}`);
});

test("all three versions are present", () => {
  for (const id of ["colophon-short", "colophon-long", "colophon-whitman"]) {
    assert.ok(colophonSection(html, id)?.trim(), `missing or empty #${id}`);
  }
});

test("the short-form version is the one shown without a stored choice", () => {
  // Long-form and Whitman start hidden; only a stored preference reveals them.
  assert.match(html, /<div\b[^>]*id="colophon-long"[^>]*\bhidden\b/);
  assert.match(html, /<div\b[^>]*id="colophon-whitman"[^>]*\bhidden\b/);
  assert.doesNotMatch(html, /<div\b[^>]*id="colophon-short"[^>]*\bhidden\b/);
});

test("words are counted the way a reader would", () => {
  assert.equal(countWords(htmlToText("<p>Plain HTML — no <a href='x'>framework</a>.</p>")), 4);
  assert.equal(countWords(htmlToText("25&nbsp;MB&mdash;compressed")), 3);
  assert.equal(countWords(" · — "), 0);
});
