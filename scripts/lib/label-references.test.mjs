// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { referencePointsFromRows } from "./label-references.mjs";

test("averages the fixes behind one label", () => {
  const refs = referencePointsFromRows([
    { label: "Harris Township", cache_key: "40.7681,-77.7575" },
    { label: "Harris Township", cache_key: "40.7679,-77.7565" },
  ]);
  assert.equal(Object.keys(refs).length, 1);
  assert.ok(Math.abs(refs["Harris Township"].lat - 40.768) < 0.001);
  assert.ok(Math.abs(refs["Harris Township"].lon - -77.757) < 0.001);
});

test("keeps labels separate", () => {
  const refs = referencePointsFromRows([
    { label: "A", cache_key: "10,20" },
    { label: "B", cache_key: "-30,-40" },
  ]);
  assert.deepEqual(refs, { A: { lat: 10, lon: 20 }, B: { lat: -30, lon: -40 } });
});

test("skips rows with no label or an unparseable key", () => {
  const refs = referencePointsFromRows([
    { label: "", cache_key: "10,20" },
    { label: "   ", cache_key: "10,20" },
    { label: "A", cache_key: "not-a-key" },
    { label: "A", cache_key: "10" },
    { label: "A", cache_key: "10,20,30" },
    { label: "A", cache_key: "abc,def" },
    { label: "A", cache_key: "10,20" },
  ]);
  assert.deepEqual(refs, { A: { lat: 10, lon: 20 } });
});

test("rejects out-of-range coordinates", () => {
  assert.deepEqual(referencePointsFromRows([{ label: "A", cache_key: "91,0" }]), {});
  assert.deepEqual(referencePointsFromRows([{ label: "A", cache_key: "0,181" }]), {});
});

test("a label with no usable rows is absent rather than NaN", () => {
  const refs = referencePointsFromRows([{ label: "A", cache_key: "junk" }]);
  assert.equal(refs.A, undefined);
});

test("trims whitespace around labels so they match the stored label", () => {
  const refs = referencePointsFromRows([{ label: "  A  ", cache_key: "10,20" }]);
  assert.deepEqual(refs, { A: { lat: 10, lon: 20 } });
});

test("handles no rows at all", () => {
  assert.deepEqual(referencePointsFromRows([]), {});
  assert.deepEqual(referencePointsFromRows(), {});
});
