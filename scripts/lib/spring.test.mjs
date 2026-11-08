// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  springEasing,
  springPosition,
  springSettleTime,
  THINKING_VIEW_SPRING,
} from "./spring.mjs";

test("a spring starts at rest and ends at its target", () => {
  assert.equal(springPosition(0, THINKING_VIEW_SPRING), 0);
  const settle = springSettleTime(THINKING_VIEW_SPRING);
  assert.ok(Math.abs(springPosition(settle, THINKING_VIEW_SPRING) - 1) < 0.002);
});

test("an underdamped spring overshoots a little; a critically damped one never does", () => {
  const peak = (spring) => {
    let max = 0;
    for (let t = 0; t < springSettleTime(spring); t += 0.001) max = Math.max(max, springPosition(t, spring));
    return max;
  };
  const p = peak(THINKING_VIEW_SPRING);
  assert.ok(p > 1 && p < 1.05, `overshoot ${p}`);
  assert.ok(peak({ response: 0.5, dampingFraction: 1 }) <= 1);
});

test("the linear() easing runs from 0 to exactly 1", () => {
  const { easing, durationMs } = springEasing(THINKING_VIEW_SPRING);
  const points = easing.slice("linear(".length, -1).split(", ").map(Number);
  assert.equal(points.length, 41);
  assert.equal(points[0], 0);
  assert.equal(points.at(-1), 1);
  assert.ok(durationMs > 300 && durationMs < 1200);
});

test("styles.css carries the Thinking view spring as springEasing computes it", () => {
  // CSS can't import the module, so the curve is pasted in; this keeps it honest.
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const { easing, durationMs } = springEasing(THINKING_VIEW_SPRING);
  assert.ok(css.includes(`--thinking-spring: ${easing};`), "easing out of date");
  assert.ok(css.includes(`--thinking-spring-duration: ${durationMs}ms;`), "duration out of date");
});
