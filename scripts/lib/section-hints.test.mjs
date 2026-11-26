// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SECTION_HINTS } from "./section-hints.mjs";

test("every homepage section has a hand-written tooltip", () => {
  for (const name of ["Thinking", "Writing", "Reading", "Sharing", "Elsewhere"]) {
    assert.equal(typeof SECTION_HINTS[name], "string", name);
    assert.ok(SECTION_HINTS[name].trim().length > 0, name);
  }
});

test("nothing regenerates the tooltips or reads them from D1", () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  assert.ok(!/section[-_]hints?|SectionHint/i.test(read("../../worker/update-thinking.js")));
  assert.ok(!/section_hints/.test(read("../d1-client.mjs")));
});
