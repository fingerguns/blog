/**
 * Run an async fn over items with at most `limit` in flight at once —
 * build-time network lookups (cover art, thumbnails, link unfurls) are
 * one HTTP round trip each, so running them one at a time makes build
 * time grow linearly with the list instead of staying roughly flat.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [...items];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}
