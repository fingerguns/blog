// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanOutline, outlineBbox, outlineMatchesBbox, MAX_OUTLINE_POINTS } from "./neighborhood-outline.mjs";

const square = [[[-73.97, 40.68], [-73.958, 40.68], [-73.958, 40.698], [-73.97, 40.698], [-73.97, 40.68]]];

test("a polygon passes through, rounded to ~1 m", () => {
  const g = cleanOutline({ type: "Polygon", coordinates: [[[-73.9707731499, 40.679831], [-73.958, 40.68], [-73.958, 40.698], [-73.97, 40.698], [-73.9707731499, 40.679831]]] });
  assert.equal(g.type, "Polygon");
  assert.deepEqual(g.coordinates[0][0], [-73.97077, 40.67983]);
});

test("an unclosed ring is closed", () => {
  const g = cleanOutline({ type: "Polygon", coordinates: [square[0].slice(0, 4)] });
  assert.deepEqual(g.coordinates[0].at(-1), g.coordinates[0][0]);
});

test("a MultiPolygon with one part becomes a Polygon; two parts stay Multi", () => {
  assert.equal(cleanOutline({ type: "MultiPolygon", coordinates: [square] }).type, "Polygon");
  assert.equal(cleanOutline({ type: "MultiPolygon", coordinates: [square, square] }).type, "MultiPolygon");
});

test("points, lines, junk and huge shapes are refused", () => {
  assert.equal(cleanOutline({ type: "Point", coordinates: [-73.96, 40.69] }), null);
  assert.equal(cleanOutline({ type: "LineString", coordinates: square[0] }), null);
  assert.equal(cleanOutline({ type: "Polygon", coordinates: [[[0, 0], ["x", 1], [1, 1], [0, 0]]] }), null);
  assert.equal(cleanOutline({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] }), null);
  assert.equal(cleanOutline(null), null);
  const big = Array.from({ length: MAX_OUTLINE_POINTS + 10 }, (_, i) => [-73.9 + i * 1e-4, 40.6 + (i % 2) * 1e-3]);
  big.push(big[0]);
  assert.equal(cleanOutline({ type: "Polygon", coordinates: [big] }), null);
});

test("outlineBbox and outlineMatchesBbox", () => {
  const g = { type: "Polygon", coordinates: square };
  assert.deepEqual(outlineBbox(g), [-73.97, 40.68, -73.958, 40.698]);
  assert.equal(outlineMatchesBbox(g, [-73.9708, 40.6798, -73.9582, 40.6982]), true);
  assert.equal(outlineMatchesBbox(g, [-0.2, 51.4, -0.1, 51.5]), false); // a London box
});
