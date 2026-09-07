// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  geocodeNeighborhoodLabels,
  haversineKm,
  nominatimSearchUrl,
  pointFromNominatimResults,
  MAX_REFERENCE_DRIFT_KM,
} from "./geocode-neighborhood.mjs";

// The real failure this guards: "Harris Township" has no state in it, and
// Nominatim's first hit is Michigan while the note was written in Pennsylvania.
const HARRIS_RESULTS = [
  { lat: "45.7902", lon: "-87.3869" }, // Menominee County, Michigan
  { lat: "40.7736", lon: "-77.7739" }, // Centre County, Pennsylvania
  { lat: "47.1522", lon: "-93.5127" }, // Itasca County, Minnesota
];
const HARRIS_REFERENCE = { lat: 40.768, lon: -77.757 };

test("parses Nominatim's string coordinates into numbers", () => {
  assert.deepEqual(pointFromNominatimResults([{ lat: "40.689", lon: "-73.965" }]), {
    lat: 40.689,
    lon: -73.965,
  });
});

test("returns null for an empty or malformed result", () => {
  assert.equal(pointFromNominatimResults([]), null);
  assert.equal(pointFromNominatimResults(null), null);
  assert.equal(pointFromNominatimResults([{}]), null);
  assert.equal(pointFromNominatimResults([{ lat: "nope", lon: "-73.9" }]), null);
});

test("rejects out-of-range coordinates rather than pinning them", () => {
  assert.equal(pointFromNominatimResults([{ lat: "91", lon: "0" }]), null);
  assert.equal(pointFromNominatimResults([{ lat: "0", lon: "181" }]), null);
});

test("without a reference, Nominatim's own first choice wins", () => {
  assert.deepEqual(pointFromNominatimResults(HARRIS_RESULTS), { lat: 45.7902, lon: -87.3869 });
});

test("a reference picks the nearest candidate, not the first", () => {
  assert.deepEqual(pointFromNominatimResults(HARRIS_RESULTS, HARRIS_REFERENCE), {
    lat: 40.7736,
    lon: -77.7739,
  });
});

test("the chosen point is the neighborhood centre, never the reference itself", () => {
  const point = pointFromNominatimResults(HARRIS_RESULTS, HARRIS_REFERENCE);
  assert.notDeepEqual(point, HARRIS_REFERENCE);
});

test("rejects everything when even the nearest candidate is implausibly far", () => {
  // Only the Michigan hit, but the fix was in Pennsylvania: better no pin than
  // a pin 700 km from where the note was written.
  assert.equal(pointFromNominatimResults([HARRIS_RESULTS[0]], HARRIS_REFERENCE), null);
});

test("a malformed reference falls back to the first candidate", () => {
  assert.deepEqual(pointFromNominatimResults(HARRIS_RESULTS, { lat: NaN, lon: 1 }), {
    lat: 45.7902,
    lon: -87.3869,
  });
});

test("distance is great-circle, not raw degrees", () => {
  // One degree of longitude is ~111 km at the equator and ~0 at the pole.
  assert.ok(Math.abs(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.19) < 0.5);
  assert.ok(haversineKm({ lat: 80, lon: 0 }, { lat: 80, lon: 1 }) < 20);
  assert.equal(haversineKm({ lat: 5, lon: 5 }, { lat: 5, lon: 5 }), 0);
});

test("the drift guard is a sane threshold", () => {
  assert.ok(MAX_REFERENCE_DRIFT_KM > 10 && MAX_REFERENCE_DRIFT_KM < 200);
});

test("passes each label's reference through to the picker", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => HARRIS_RESULTS });
  const out = await geocodeNeighborhoodLabels(["Harris Township"], {
    fetchImpl,
    minIntervalMs: 0,
    references: { "Harris Township": HARRIS_REFERENCE },
  });
  assert.deepEqual(out["Harris Township"], { lat: 40.7736, lon: -77.7739 });
});

test("a label with no reference still resolves to the first candidate", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => HARRIS_RESULTS });
  const out = await geocodeNeighborhoodLabels(["Harris Township"], {
    fetchImpl,
    minIntervalMs: 0,
    references: {},
  });
  assert.deepEqual(out["Harris Township"], { lat: 45.7902, lon: -87.3869 });
});

test("search URL asks for several JSON candidates for the label", () => {
  const url = new URL(nominatimSearchUrl("Clinton Hill, Brooklyn"));
  assert.equal(url.origin + url.pathname, "https://nominatim.openstreetmap.org/search");
  assert.equal(url.searchParams.get("q"), "Clinton Hill, Brooklyn");
  assert.equal(url.searchParams.get("format"), "json");
  // Several, not one: a reference point needs candidates to choose between.
  assert.ok(Number(url.searchParams.get("limit")) > 1);
});

test("geocodes each label and sends a User-Agent", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, ua: init.headers["User-Agent"] });
    return { ok: true, json: async () => [{ lat: "1.5", lon: "2.5" }] };
  };

  const out = await geocodeNeighborhoodLabels(["A", "B"], {
    fetchImpl,
    minIntervalMs: 0,
    userAgent: "test-agent",
  });

  assert.deepEqual(out, { A: { lat: 1.5, lon: 2.5 }, B: { lat: 1.5, lon: 2.5 } });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].ua, "test-agent");
});

test("records false for a label that cannot be resolved", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [] });
  const out = await geocodeNeighborhoodLabels(["Nowhere"], { fetchImpl, minIntervalMs: 0 });
  assert.equal(out.Nowhere, false);
});

test("a non-ok response or a throwing fetch records false, never rejects", async () => {
  const failing = async () => ({ ok: false, json: async () => [] });
  assert.equal(
    (await geocodeNeighborhoodLabels(["A"], { fetchImpl: failing, minIntervalMs: 0 })).A,
    false
  );

  const throwing = async () => {
    throw new Error("network down");
  };
  assert.equal(
    (await geocodeNeighborhoodLabels(["A"], { fetchImpl: throwing, minIntervalMs: 0 })).A,
    false
  );
});

test("waits between requests to respect Nominatim's rate limit", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [{ lat: "1", lon: "2" }] });
  const started = Date.now();
  await geocodeNeighborhoodLabels(["A", "B", "C"], { fetchImpl, minIntervalMs: 25 });
  // Two gaps between three labels, and no trailing wait after the last.
  assert.ok(Date.now() - started >= 50, "should pause between requests");
});
