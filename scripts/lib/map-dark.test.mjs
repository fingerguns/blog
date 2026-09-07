// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DARK_MAP_PALETTE, DARK_MAP_RECOLOR_JS } from "./map-dark.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** WCAG relative luminance / contrast, so the palette's claims are checked, not asserted. */
const channel = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// What the old OpenFreeMap dark style gave us, and the reason this file exists.
const OPENFREEMAP_DARK = { land: "#0c0c0c", water: "#1b1b1d", label: "#656565" };

test("the palette actually separates land from water", () => {
  const before = contrast(OPENFREEMAP_DARK.land, OPENFREEMAP_DARK.water);
  const after = contrast(DARK_MAP_PALETTE.land, DARK_MAP_PALETTE.water);
  assert.ok(before < 1.2, `baseline should be the near-invisible one, got ${before.toFixed(2)}`);
  assert.ok(after > 1.6, `land/water should clear 1.6, got ${after.toFixed(2)}`);
});

test("labels are legible against land", () => {
  const after = contrast(DARK_MAP_PALETTE.label, DARK_MAP_PALETTE.land);
  assert.ok(after > 7, `label/land should clear 7, got ${after.toFixed(2)}`);
});

test("roads and boundaries are visible, and boundaries outrank roads", () => {
  const road = contrast(DARK_MAP_PALETTE.road, DARK_MAP_PALETTE.land);
  const boundary = contrast(DARK_MAP_PALETTE.boundary, DARK_MAP_PALETTE.land);
  assert.ok(road > 2, `road/land should clear 2, got ${road.toFixed(2)}`);
  assert.ok(boundary > road, "a state border should read stronger than a road");
});

test("land stays close to the page background so the map is not a lit rectangle", () => {
  // --bg in styles.css [data-theme="dark"].
  assert.ok(contrast(DARK_MAP_PALETTE.land, "#16130f") < 1.25);
});

test("the label halo is darker than the land it sits on", () => {
  assert.ok(luminance(DARK_MAP_PALETTE.halo) < luminance(DARK_MAP_PALETTE.land));
});

test("the emitted client source is valid JavaScript", () => {
  const fn = new Function(`${DARK_MAP_RECOLOR_JS}; return recolorDarkBasemap;`)();
  assert.equal(typeof fn, "function");
  assert.doesNotThrow(() => fn(null), "must tolerate a null map");
  assert.doesNotThrow(() => fn({ getStyle: () => { throw new Error("not ready"); } }));
});

test("only basemap layers are repainted, never our own overlays", () => {
  const fn = new Function(`${DARK_MAP_RECOLOR_JS}; return recolorDarkBasemap;`)();
  const painted = [];
  fn({
    getStyle: () => ({
      layers: [
        { id: "background", type: "background" },
        { id: "water", type: "fill", source: "openmaptiles" },
        { id: "boundary_state", type: "line", source: "openmaptiles" },
        // Ours: repainting these would turn a neighborhood outline into a road
        // and recolour the heatmap.
        { id: "now-neighborhood-line", type: "line", source: "now-neighborhood" },
        { id: "loc-heat-dots", type: "circle", source: "loc-heat" },
        { id: "loc-track-line", type: "line", source: "loc-track" },
      ],
    }),
    setPaintProperty: (id, prop, value) => painted.push({ id, prop, value }),
  });

  const ids = painted.map((p) => p.id);
  assert.ok(ids.includes("background"));
  assert.ok(ids.includes("water"));
  assert.ok(ids.includes("boundary_state"));
  assert.ok(!ids.includes("now-neighborhood-line"), "must not repaint the /now/ outline");
  assert.ok(!ids.includes("loc-heat-dots"), "must not repaint the heatmap");
  assert.ok(!ids.includes("loc-track-line"), "must not repaint the track line");

  const boundary = painted.find((p) => p.id === "boundary_state");
  assert.equal(boundary.value, DARK_MAP_PALETTE.boundary);
});

test("admin/index.html's hand-inlined copy has not drifted from the palette", () => {
  // admin/ is static and copied verbatim by the build, so it cannot import the
  // lib. This is the guard that keeps the duplicate honest.
  const admin = readFileSync(join(root, "admin", "index.html"), "utf8");
  assert.ok(admin.includes("recolorDarkBasemap"), "admin should define the helper");
  for (const [name, hex] of Object.entries(DARK_MAP_PALETTE)) {
    assert.ok(admin.includes(hex), `admin/index.html is missing the ${name} colour ${hex}`);
  }
});

test("area fills are repainted relative to the new land, not left near-black", () => {
  const fn = new Function(`${DARK_MAP_RECOLOR_JS}; return recolorDarkBasemap;`)();
  const painted = {};
  fn({
    getStyle: () => ({
      layers: [
        { id: "building", type: "fill", source: "openmaptiles" },
        { id: "landuse_residential", type: "fill", source: "openmaptiles" },
        { id: "landcover_wood", type: "fill", source: "openmaptiles" },
        { id: "landuse_park", type: "fill", source: "openmaptiles" },
        { id: "aeroway-area", type: "fill", source: "openmaptiles" },
      ],
    }),
    setPaintProperty: (id, prop, value) => {
      painted[id] = value;
    },
  });

  assert.equal(painted.building, DARK_MAP_PALETTE.building);
  assert.equal(painted.landuse_residential, DARK_MAP_PALETTE.landuse);
  assert.equal(painted.landcover_wood, DARK_MAP_PALETTE.park);
  assert.equal(painted.landuse_park, DARK_MAP_PALETTE.park);
  // Nothing meaningful to say about an airport apron: blend it into the land
  // rather than leave the style's #000 punching a hole in it.
  assert.equal(painted["aeroway-area"], DARK_MAP_PALETTE.land);
});

test("no basemap layer is left behind, whatever its type", () => {
  const fn = new Function(`${DARK_MAP_RECOLOR_JS}; return recolorDarkBasemap;`)();
  const layers = [
    { id: "background", type: "background" },
    { id: "water", type: "fill", source: "openmaptiles" },
    { id: "waterway", type: "line", source: "openmaptiles" },
    { id: "water_name", type: "symbol", source: "openmaptiles" },
    { id: "building", type: "fill", source: "openmaptiles" },
    { id: "highway_motorway", type: "line", source: "openmaptiles" },
    { id: "boundary_state", type: "line", source: "openmaptiles" },
    { id: "place_city", type: "symbol", source: "openmaptiles" },
    { id: "landcover_glacier", type: "fill", source: "openmaptiles" },
  ];
  const painted = new Set();
  fn({
    getStyle: () => ({ layers }),
    setPaintProperty: (id) => painted.add(id),
  });
  const missed = layers.map((l) => l.id).filter((id) => !painted.has(id));
  assert.deepEqual(missed, [], `these basemap layers keep their near-black colours: ${missed}`);
});

test("buildings read lighter than land, the usual dark-map convention", () => {
  assert.ok(luminance(DARK_MAP_PALETTE.building) > luminance(DARK_MAP_PALETTE.land));
});
