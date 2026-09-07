// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeEntities,
  groupThinkingByPlace,
  mapExcerpt,
  placesBounds,
  MAP_EXCERPT_MAX,
} from "./thinking-map.mjs";

const COORDS = {
  "Clinton Hill, Brooklyn": { lat: 40.689, lon: -73.965 },
  "Inwood, Manhattan": { lat: 40.867, lon: -73.921 },
};

const entry = (over = {}) => ({
  slug: "s1",
  label: "Clinton Hill, Brooklyn",
  kind: "photo",
  text: "hello",
  date: "2026-01-01T00:00:00Z",
  dateText: "2026-01-01 // 09:00",
  ...over,
});

test("groups posts sharing a label onto one place", () => {
  const places = groupThinkingByPlace(
    [
      entry({ slug: "a", date: "2026-01-01T00:00:00Z" }),
      entry({ slug: "b", date: "2026-03-01T00:00:00Z" }),
      entry({ slug: "c", label: "Inwood, Manhattan" }),
    ],
    COORDS
  );

  assert.equal(places.length, 2);
  const clinton = places.find((p) => p.label === "Clinton Hill, Brooklyn");
  assert.equal(clinton.posts.length, 2);
  assert.equal(clinton.lat, 40.689);
  assert.equal(clinton.lon, -73.965);
});

test("carries the caller's formatted date through onto each post", () => {
  const [place] = groupThinkingByPlace([entry({ dateText: "2026-04-02 // 14:30" })], COORDS);
  assert.equal(place.posts[0].dateText, "2026-04-02 // 14:30");
});

test("a post with no formatted date gets an empty string, never undefined", () => {
  const [place] = groupThinkingByPlace([entry({ dateText: undefined })], COORDS);
  assert.equal(place.posts[0].dateText, "");
});

test("posts within a place are newest first", () => {
  const [place] = groupThinkingByPlace(
    [
      entry({ slug: "old", date: "2026-01-01T00:00:00Z" }),
      entry({ slug: "new", date: "2026-06-01T00:00:00Z" }),
      entry({ slug: "mid", date: "2026-03-01T00:00:00Z" }),
    ],
    COORDS
  );
  assert.deepEqual(
    place.posts.map((p) => p.slug),
    ["new", "mid", "old"]
  );
});

test("places are busiest first, so the densest marker draws on top", () => {
  const places = groupThinkingByPlace(
    [
      entry({ slug: "a", label: "Inwood, Manhattan" }),
      entry({ slug: "b" }),
      entry({ slug: "c" }),
    ],
    COORDS
  );
  assert.deepEqual(
    places.map((p) => p.label),
    ["Clinton Hill, Brooklyn", "Inwood, Manhattan"]
  );
});

test("drops posts with no label and labels that failed to geocode", () => {
  const places = groupThinkingByPlace(
    [
      entry({ slug: "none", label: "" }),
      entry({ slug: "blank", label: "   " }),
      entry({ slug: "ungeocoded", label: "Nowhere, Nowhere" }),
      entry({ slug: "kept" }),
    ],
    { ...COORDS, "Nowhere, Nowhere": false }
  );
  assert.equal(places.length, 1);
  assert.deepEqual(
    places[0].posts.map((p) => p.slug),
    ["kept"]
  );
});

test("a label whose coords are not finite is dropped, not pinned at 0,0", () => {
  const places = groupThinkingByPlace([entry()], {
    "Clinton Hill, Brooklyn": { lat: "nope", lon: null },
  });
  assert.deepEqual(places, []);
});

test("excerpt collapses whitespace and truncates with an ellipsis", () => {
  assert.equal(mapExcerpt("  a   b \n c "), "a b c");
  assert.equal(mapExcerpt(""), "");
  assert.equal(mapExcerpt(null), "");

  const long = "x".repeat(MAP_EXCERPT_MAX + 50);
  const cut = mapExcerpt(long);
  assert.equal(cut.length, MAP_EXCERPT_MAX);
  assert.ok(cut.endsWith("…"));
});

test("excerpt keeps text exactly at the limit intact", () => {
  const exact = "y".repeat(MAP_EXCERPT_MAX);
  assert.equal(mapExcerpt(exact), exact);
});

test("bounds cover every place", () => {
  const places = groupThinkingByPlace(
    [entry({ slug: "a" }), entry({ slug: "b", label: "Inwood, Manhattan" })],
    COORDS
  );
  assert.deepEqual(placesBounds(places), [-73.965, 40.689, -73.921, 40.867]);
});

test("bounds are null when there is nothing to fit or only one point", () => {
  assert.equal(placesBounds([]), null);
  assert.equal(placesBounds(groupThinkingByPlace([entry()], COORDS)), null);
});

test("decodes the entities stripHtml leaves behind", () => {
  assert.equal(decodeEntities("Sentence case &gt; title case"), "Sentence case > title case");
  assert.equal(decodeEntities("a &lt; b &amp; c"), "a < b & c");
  assert.equal(decodeEntities("&quot;quoted&quot;"), '"quoted"');
  assert.equal(decodeEntities("caf&#233;"), "café");
  assert.equal(decodeEntities("&#x2014;"), "\u2014");
});

test("does not double-decode an escaped entity", () => {
  // &amp;gt; is the literal text "&gt;", not ">".
  assert.equal(decodeEntities("&amp;gt;"), "&gt;");
});

test("leaves unknown entities and bare ampersands alone", () => {
  assert.equal(decodeEntities("&bogus; R&D"), "&bogus; R&D");
});

test("excerpt decodes entities before measuring and truncating", () => {
  assert.equal(mapExcerpt("Sentence case &gt; title case"), "Sentence case > title case");
  // The decoded string is what gets measured, so an entity does not eat the budget.
  const text = `${"a".repeat(MAP_EXCERPT_MAX - 1)}&amp;`;
  assert.equal(mapExcerpt(text), `${"a".repeat(MAP_EXCERPT_MAX - 1)}&`);
});
