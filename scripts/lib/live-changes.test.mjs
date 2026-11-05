// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collapseChanges,
  datedItemSort,
  liveListAttrs,
  monthKeyET,
  readingSort,
  readWatermark,
  sortsAbove,
  watermarkMetaHtml,
  withLiveAttrs,
} from "./live-changes.mjs";

const row = (id, kind, key, op) => ({ id, kind, key, op });

test("the latest change per item wins, whatever order the rows arrive in", () => {
  const out = collapseChanges([
    row(3, "thinking", "a", "delete"),
    row(1, "thinking", "a", "upsert"),
    row(2, "post", "b", "upsert"),
  ]);
  assert.equal(out.get("thinking:a").op, "delete");
  assert.equal(out.get("post:b").op, "upsert");
  assert.equal(out.size, 2);
});

test("unpublish then publish again is an upsert", () => {
  const out = collapseChanges([row(5, "post", "x", "delete"), row(6, "post", "x", "upsert")]);
  assert.equal(out.get("post:x").op, "upsert");
});

test("unknown kinds and ops are ignored", () => {
  const out = collapseChanges([row(1, "drafts", "a", "upsert"), row(2, "post", "b", "rename")]);
  assert.equal(out.size, 0);
});

test("numeric keys are compared as strings", () => {
  const out = collapseChanges([row(1, "reading", 12, "upsert"), row(2, "reading", "12", "delete")]);
  assert.equal(out.get("reading:12").op, "delete");
});

test("watermark round-trips through the page head; a page without one is 0", () => {
  assert.equal(readWatermark(`<head>${watermarkMetaHtml(41)}</head>`), 41);
  assert.equal(readWatermark("<head></head>"), 0);
  assert.equal(watermarkMetaHtml("nonsense"), '<meta name="live-watermark" content="0" />');
});

test("live attributes land on the item's first tag and are escaped", () => {
  assert.equal(
    withLiveAttrs('          <li data-tags="x">hi</li>', 'post:a"b', "2026"),
    '          <li data-live-key="post:a&quot;b" data-live-sort="2026" data-tags="x">hi</li>'
  );
});

test("list attributes name the list and only state a non-default order", () => {
  assert.equal(liveListAttrs("writing"), ' data-live-list="writing"');
  assert.equal(liveListAttrs("favorites", { order: "title" }), ' data-live-list="favorites" data-live-order="title"');
});

test("newest first: a later datetime sorts above an earlier one", () => {
  assert.ok(sortsAbove(datedItemSort({ datetime: "2026-11-05T10:00:00Z" }), datedItemSort({ datetime: "2026-11-04T23:00:00Z" })));
  assert.equal(datedItemSort({ date: "2026-11-05" }), "2026-11-05T12:00:00.000Z");
});

test("reading sorts by month read, then by when it was added, then by id", () => {
  const older = readingSort({ ym: "2026-10", added_at: "2026-11-01T00:00:00Z", id: 9 });
  const newer = readingSort({ ym: "2026-11", added_at: "2026-10-01T00:00:00Z", id: 1 });
  assert.ok(sortsAbove(newer, older));
  const sameMonthLater = readingSort({ ym: "2026-11", added_at: "2026-10-02T00:00:00Z", id: 1 });
  assert.ok(sortsAbove(sameMonthLater, newer));
  const noAddedAt = readingSort({ ym: "2026-11", id: 2 });
  assert.ok(sortsAbove(newer, noAddedAt));
});

test("Thinking grid months are New York months", () => {
  // 03:00 UTC on Nov 1 is still Oct 31 in New York.
  assert.equal(monthKeyET("2026-11-01T03:00:00Z"), "2026-10");
  assert.equal(monthKeyET("not a date"), "");
});
