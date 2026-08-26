// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSpotifyUrl, extractSpotifyEmbeds } from "./spotify.mjs";

const ID = "4cOdK2wGLETKBW3PvgPWqT"; // 22 chars, a normal Spotify id

test("recognises every entity type the site embeds", () => {
  for (const type of ["track", "album", "playlist", "episode", "show", "artist"]) {
    assert.deepEqual(
      parseSpotifyUrl(`https://open.spotify.com/${type}/${ID}`),
      { type, id: ID },
      type
    );
  }
});

test("strips the locale segment Spotify adds when sharing", () => {
  // Share links from a non-English client look like /intl-de/track/ID.
  assert.deepEqual(
    parseSpotifyUrl(`https://open.spotify.com/intl-de/track/${ID}`),
    { type: "track", id: ID }
  );
  assert.deepEqual(
    parseSpotifyUrl(`https://open.spotify.com/intl-pt/album/${ID}`),
    { type: "album", id: ID }
  );
});

test("accepts the www host and query parameters", () => {
  assert.deepEqual(
    parseSpotifyUrl(`https://www.open.spotify.com/track/${ID}?si=abc123`),
    { type: "track", id: ID }
  );
});

test("rejects anything that is not an embeddable Spotify entity", () => {
  for (const url of [
    `https://open.spotify.com/user/someone`,      // unsupported type
    `https://open.spotify.com/track`,             // no id
    `https://open.spotify.com/`,                  // no path
    `https://spotify.com/track/${ID}`,            // wrong host
    `https://example.com/track/${ID}`,
    `https://open.spotify.com/track/short`,       // id too short
    "not a url",
    "",
  ]) {
    assert.equal(parseSpotifyUrl(url), null, url);
  }
});

test("extract de-duplicates on type and id together", () => {
  const text =
    `https://open.spotify.com/track/${ID} ` +
    `https://open.spotify.com/track/${ID} ` +   // exact repeat, dropped
    `https://open.spotify.com/album/${ID}`;     // same id, different type, kept

  assert.deepEqual(
    extractSpotifyEmbeds(text).map((e) => `${e.type}:${e.id}`),
    [`track:${ID}`, `album:${ID}`]
  );
});

test("extract strips trailing sentence punctuation", () => {
  assert.deepEqual(
    extractSpotifyEmbeds(`on repeat: https://open.spotify.com/track/${ID}.`).map((e) => e.id),
    [ID]
  );
});

test("extract returns nothing when there are no Spotify links", () => {
  assert.deepEqual(extractSpotifyEmbeds("no links"), []);
  assert.deepEqual(extractSpotifyEmbeds(""), []);
  assert.deepEqual(extractSpotifyEmbeds(null), []);
});
