/**
 * Distance walked, derived from a step count.
 *
 * Oura's daily_activity payload has no true walking-distance field — its
 * `equivalent_walking_distance` is a calorie equivalent that inflates on
 * non-walking activity — so distance here is steps x an average stride,
 * the same way a pedometer does it.
 */
const STRIDE_METERS = 0.762; // ~30in, the usual pedometer default
const METERS_PER_MILE = 1609.344;

export function kilometersFromSteps(steps) {
  const n = Number(steps);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return (n * STRIDE_METERS) / 1000;
}

export function milesFromSteps(steps) {
  const n = Number(steps);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return (n * STRIDE_METERS) / METERS_PER_MILE;
}

/** "7.9 miles / 12.7 km" — the parenthetical shown next to a step count. */
export function distanceTextFromSteps(steps) {
  const miles = milesFromSteps(steps);
  const km = kilometersFromSteps(steps);
  if (!miles) return "";
  return `${miles.toFixed(1)} miles / ${km.toFixed(1)} km`;
}
