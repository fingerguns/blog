// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  kilometersFromSteps,
  milesFromSteps,
  distanceTextFromSteps,
} from "./steps-distance.mjs";

test("steps convert to miles and km at an average stride", () => {
  // 10,000 steps x 0.762m = 7620m
  assert.equal(kilometersFromSteps(10000).toFixed(2), "7.62");
  assert.equal(milesFromSteps(10000).toFixed(2), "4.73");
});

test("the /now parenthetical reads to one decimal in both units", () => {
  assert.equal(distanceTextFromSteps(18467), "8.7 miles / 14.1 km");
});

test("zero, missing, and junk step counts produce no distance text", () => {
  for (const value of [0, null, undefined, "", "abc", -500]) {
    assert.equal(distanceTextFromSteps(value), "");
    assert.equal(milesFromSteps(value), 0);
    assert.equal(kilometersFromSteps(value), 0);
  }
});

test("numeric strings from D1 are accepted", () => {
  assert.equal(distanceTextFromSteps("10000"), "4.7 miles / 7.6 km");
});
