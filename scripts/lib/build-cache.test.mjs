// Run with: npm test
//
// build-cache talks to D1 over the REST API, so these tests stub global fetch
// with an in-memory store that speaks the same wire format. That exercises the
// real SQL parameters and the real diffing, without a network or a database.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// d1-client reads credentials at module load, so they must exist before import.
process.env.CF_ACCOUNT_ID = "test-account";
process.env.CF_API_TOKEN = "test-token";
process.env.CF_D1_DATABASE_ID = "test-db";

const { CACHE_NAMESPACES, loadBuildCache, saveBuildCache } = await import("./build-cache.mjs");

const NS = CACHE_NAMESPACES.READING_COVERS;
const realFetch = globalThis.fetch;

/** Stand-in for D1 over HTTP: understands the two statements this module issues. */
function stubD1({ rows = [], failReads = false } = {}) {
  const store = new Map(rows.map((r) => [`${r.namespace} ${r.key}`, r.value]));
  const calls = { selects: 0, writes: 0 };

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const statements = Array.isArray(body) ? body : [body];
    const json = (payload) => ({ ok: true, json: async () => payload });

    if (statements[0].sql.trim().startsWith("SELECT")) {
      calls.selects++;
      if (failReads) {
        return {
          ok: false,
          statusText: "boom",
          json: async () => ({ success: false, errors: [{ message: "boom" }] }),
        };
      }
      const [namespace] = statements[0].params;
      const results = [...store.entries()]
        .filter(([k]) => k.startsWith(`${namespace} `))
        .map(([k, value]) => ({ key: k.slice(namespace.length + 1), value }));
      return json({ success: true, result: [{ results }] });
    }

    // Multi-row INSERT: params arrive flattened, four per row.
    for (const st of statements) {
      for (let i = 0; i < st.params.length; i += 4) {
        const [namespace, key, value] = st.params.slice(i, i + 4);
        store.set(`${namespace} ${key}`, value);
        calls.writes++;
      }
    }
    return json({ success: true, result: [{ results: [] }] });
  };

  return { store, calls };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("save writes only entries that changed since load", async () => {
  const { calls } = stubD1({
    rows: [{ namespace: NS, key: "a", value: JSON.stringify("cover-a") }],
  });

  const cache = await loadBuildCache(NS);
  assert.deepEqual(cache, { a: "cover-a" });

  cache.b = "cover-b";
  const { written } = await saveBuildCache(NS, cache);

  assert.equal(written, 1, "only the new key should be written");
  assert.equal(calls.writes, 1);
});

test("saving an unchanged cache is a no-op", async () => {
  const { calls } = stubD1({
    rows: [{ namespace: NS, key: "a", value: JSON.stringify("cover-a") }],
  });

  const cache = await loadBuildCache(NS);
  const { written } = await saveBuildCache(NS, cache);

  assert.equal(written, 0);
  assert.equal(calls.writes, 0);
});

test("false round-trips as a present key", async () => {
  // The build uses `key in cache` to avoid retrying known-empty lookups, so a
  // cached `false` must survive as a key rather than vanishing.
  stubD1();

  const cache = await loadBuildCache(CACHE_NAMESPACES.VIDEO_POSTERS);
  cache["https://example.com/clip.mp4"] = false;
  await saveBuildCache(CACHE_NAMESPACES.VIDEO_POSTERS, cache);

  const reloaded = await loadBuildCache(CACHE_NAMESPACES.VIDEO_POSTERS);
  assert.equal("https://example.com/clip.mp4" in reloaded, true);
  assert.equal(reloaded["https://example.com/clip.mp4"], false);
});

test("objects round-trip for link unfurls", async () => {
  stubD1();
  const nsUnfurl = CACHE_NAMESPACES.LINKLOG_UNFURLS;

  const cache = await loadBuildCache(nsUnfurl);
  cache["https://example.com"] = { title: "Example", image: null };
  await saveBuildCache(nsUnfurl, cache);

  const reloaded = await loadBuildCache(nsUnfurl);
  assert.deepEqual(reloaded["https://example.com"], { title: "Example", image: null });
});

test("an empty namespace seeds from the legacy file and then persists it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "build-cache-"));
  const legacyFile = join(dir, "legacy.json");
  writeFileSync(legacyFile, JSON.stringify({ x: "from-disk", y: "also-from-disk" }));

  try {
    const { calls } = stubD1();

    const cache = await loadBuildCache(NS, { legacyFile });
    assert.deepEqual(cache, { x: "from-disk", y: "also-from-disk" });

    // Seeding leaves the snapshot empty so the next save uploads everything.
    const { written } = await saveBuildCache(NS, cache);
    assert.equal(written, 2);
    assert.equal(calls.writes, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("large caches are chunked under D1's 100-parameter limit", async () => {
  // D1 rejects >100 bound params per query with "too many SQL variables".
  // Four params per row means each statement must carry at most 25 rows.
  const seen = [];
  stubD1();
  const realStub = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (!Array.isArray(body) && !body.sql.trim().startsWith("SELECT")) {
      seen.push(body.params.length);
    }
    return realStub(url, init);
  };

  // Isolate from the real legacy file, which would otherwise seed 45 entries.
  const cache = await loadBuildCache(NS, { legacyFile: "/nonexistent/path.json" });
  for (let i = 0; i < 53; i++) cache[`key-${i}`] = `value-${i}`;
  const { written } = await saveBuildCache(NS, cache);

  assert.equal(written, 53);
  assert.ok(seen.length > 1, "should split into multiple statements");
  for (const count of seen) {
    assert.ok(count <= 100, `statement bound ${count} params, over D1's limit of 100`);
  }
});

test("a D1 read failure degrades instead of throwing", async () => {
  stubD1({ failReads: true });

  const cache = await loadBuildCache(NS, { legacyFile: "/nonexistent/path.json" });
  assert.deepEqual(cache, {}, "an unreadable cache is empty, not fatal");
});

test("save reports zero written when D1 rejects the write", async () => {
  stubD1();
  const cache = await loadBuildCache(NS);
  cache.a = "one";

  globalThis.fetch = async () => ({
    ok: false,
    statusText: "nope",
    json: async () => ({ success: false, errors: [{ message: "nope" }] }),
  });

  const { written } = await saveBuildCache(NS, cache);
  assert.equal(written, 0, "a failed cache write is a slow build, not a broken one");
});
