// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseYouTubeUrl, extractYouTubeEmbeds } from "./youtube.mjs";

const ID = "dQw4w9WgXcQ"; // 11 chars, the shape the parser requires

test("recognises every YouTube URL form the site embeds", () => {
  for (const url of [
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtube.com/shorts/${ID}`,
    `https://youtube.com/embed/${ID}`,
    `https://youtube.com/live/${ID}`,
  ]) {
    assert.deepEqual(parseYouTubeUrl(url), { id: ID, start: 0 }, url);
  }
});

test("rejects anything that is not a YouTube video URL", () => {
  for (const url of [
    "https://example.com/watch?v=" + ID,
    "https://youtube.com/",
    "https://youtube.com/watch",              // no v=
    "https://youtube.com/channel/UC123",      // not a video path
    `https://youtu.be/${ID}extra`,            // id too long
    "https://youtu.be/short",                 // id too short
    "not a url",
    "",
  ]) {
    assert.equal(parseYouTubeUrl(url), null, url);
  }
});

test("parses start times in both seconds and h/m/s form", () => {
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}?t=90`).start, 90);
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}?t=1h2m3s`).start, 3723);
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}?t=2m`).start, 120);
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}?t=45s`).start, 45);
  // `start=` is the alternate parameter YouTube itself emits.
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}?start=30`).start, 30);
  // Unparseable values fall back to 0 rather than NaN, which would corrupt the embed URL.
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}?t=garbage`).start, 0);
});

test("extract finds embeds in order and de-duplicates by video id", () => {
  const other = "abcdefghijk";
  const text = `first https://youtu.be/${ID} then https://youtube.com/watch?v=${other} ` +
               `and the first again https://youtube.com/watch?v=${ID}`;
  assert.deepEqual(
    extractYouTubeEmbeds(text).map((e) => e.id),
    [ID, other],
    "same video linked twice yields one embed"
  );
});

test("extract strips trailing sentence punctuation from URLs", () => {
  // Without this, "watch this: https://youtu.be/ID." would fail to parse.
  for (const suffix of [".", ",", ")", "!", "?", ";", ":", '"', "'"]) {
    assert.deepEqual(
      extractYouTubeEmbeds(`see https://youtu.be/${ID}${suffix}`).map((e) => e.id),
      [ID],
      `trailing ${suffix}`
    );
  }
});

test("extract returns nothing for text with no YouTube links", () => {
  assert.deepEqual(extractYouTubeEmbeds("no links here"), []);
  assert.deepEqual(extractYouTubeEmbeds("https://example.com/page"), []);
  assert.deepEqual(extractYouTubeEmbeds(""), []);
  assert.deepEqual(extractYouTubeEmbeds(null), []);
});
