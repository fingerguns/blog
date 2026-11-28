// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { thinkingVideosMissingStills } from "../../worker/video-poster.mjs";

const video = (slug, uuid) => ({
  slug,
  datetime: `${slug.slice(0, 10)}T12:00:00.000Z`,
  media_url: `https://rommy.blog/media/thinking/video/${slug.slice(0, 10)}/${uuid}.mov`,
});
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

function fakeDb(rows) {
  return {
    prepare: (sql) => ({
      bind: (limit) => ({
        all: async () => {
          assert.match(sql, /media_type = 'video'/);
          return { results: rows.slice(0, limit) };
        },
      }),
    }),
  };
}

const fakeMedia = (keys) => ({ head: async (key) => (keys.has(key) ? { key } : null) });

test("thinkingVideosMissingStills names each video short of a still, and which", async () => {
  const rows = [
    video("2026-11-27-2110", A),
    video("2026-11-20-0900", B),
    video("2026-11-10-0800", C),
    { slug: "2025-01-01-0000", datetime: "2025-01-01T00:00:00.000Z", media_url: "https://example.com/clip.mp4" },
  ];
  const present = new Set([
    `thinking/video/2026-11-20/${B}-poster.jpg`,
    `thinking/video/2026-11-20/${B}-frame.jpg`,
    `thinking/video/2026-11-10/${C}-poster.jpg`,
  ]);
  const missing = await thinkingVideosMissingStills(fakeDb(rows), fakeMedia(present));
  assert.deepEqual(missing, [
    { slug: "2026-11-27-2110", datetime: rows[0].datetime, missing: ["poster", "frame"] },
    { slug: "2026-11-10-0800", datetime: rows[2].datetime, missing: ["frame"] },
  ]);
});

test("thinkingVideosMissingStills without a bucket or database is empty", async () => {
  assert.deepEqual(await thinkingVideosMissingStills(null, fakeMedia(new Set())), []);
  assert.deepEqual(await thinkingVideosMissingStills(fakeDb([video("2026-11-27-2110", A)]), null), []);
});
