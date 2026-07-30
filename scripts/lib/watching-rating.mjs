/** Letterboxd-style ratings: 0.5–5 in 0.5 steps. Blank/null → null. */

export function parseWatchingRating(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0.5 || n > 5) {
    return { error: "Rating must be between 0.5 and 5 in 0.5 increments" };
  }

  const steps = Math.round(n * 2);
  if (Math.abs(steps / 2 - n) > 1e-9) {
    return { error: "Rating must be between 0.5 and 5 in 0.5 increments" };
  }

  return steps / 2;
}
