/**
 * A damped spring as a CSS easing. CSS has no spring timing function, but
 * `linear()` (a piecewise-linear curve through sampled points) can trace one
 * closely, overshoot included, so a View Transition can move on a spring
 * without a JavaScript animation loop.
 *
 * Parameters follow SwiftUI's `.spring(response:dampingFraction:)`:
 * `response` is the period of the undamped oscillation in seconds (smaller is
 * snappier) and `dampingFraction` is the damping ratio (1 settles with no
 * overshoot; below 1 overshoots a little and settles back).
 *
 * styles.css carries the result as literal text (CSS can't import it);
 * spring.test.mjs fails if the two drift apart.
 */

/** Position (0 → 1) of a unit spring released at rest, at time t seconds. */
export function springPosition(t, { response, dampingFraction }) {
  const omega = (2 * Math.PI) / response;
  const zeta = dampingFraction;
  if (zeta >= 1) {
    return 1 - (1 + omega * t) * Math.exp(-omega * t);
  }
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
}

/** Seconds until the spring stays within `epsilon` of rest. */
export function springSettleTime({ response, dampingFraction }, epsilon = 0.001) {
  const omega = (2 * Math.PI) / response;
  return Math.log(1 / epsilon) / (Math.min(dampingFraction, 1) * omega);
}

/**
 * `{ easing, durationMs }` for a CSS animation that follows the spring: the
 * easing is a `linear()` curve of `samples` evenly spaced points ending
 * exactly at 1, and the duration is the settle time, rounded to 10 ms.
 */
export function springEasing(spring, { samples = 40 } = {}) {
  const duration = springSettleTime(spring);
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const value = i === samples ? 1 : springPosition((i / samples) * duration, spring);
    points.push(Number(value.toFixed(4)).toString());
  }
  return {
    easing: `linear(${points.join(", ")})`,
    durationMs: Math.round((duration * 1000) / 10) * 10,
  };
}

/** The spring the Thinking archive moves on when switching views. */
export const THINKING_VIEW_SPRING = { response: 0.5, dampingFraction: 0.8 };
