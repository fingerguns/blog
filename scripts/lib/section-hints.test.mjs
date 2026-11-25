// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { SECTION_NAMES, STATIC_SECTION_HINTS, mergeSectionHints } from "./section-hints.mjs";

test("Elsewhere has a hand-written tooltip even with nothing stored", () => {
  assert.equal(mergeSectionHints(null).Elsewhere, STATIC_SECTION_HINTS.Elsewhere);
  assert.ok(STATIC_SECTION_HINTS.Elsewhere.length > 0);
});

test("a stored copy of a static hint never shadows the hand-written one", () => {
  const merged = mergeSectionHints({ Thinking: "fresh", Elsewhere: "old copy saved to D1" });
  assert.equal(merged.Thinking, "fresh");
  assert.equal(merged.Elsewhere, STATIC_SECTION_HINTS.Elsewhere);
});

test("static hints are never sent to Claude Fable for regeneration", () => {
  for (const name of Object.keys(STATIC_SECTION_HINTS)) assert.ok(!SECTION_NAMES.includes(name));
});
