// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { dayMonthFromIsoDay, formatDayMonth, formatMbDate, formatMonth } from "./render/format.mjs";

test("Thinking: day, short month, then the ET time, no year", () => {
  // 02:10 UTC on Nov 28 is 21:10 on Nov 27 in New York.
  assert.equal(formatMbDate("2026-11-28T02:10:03.701Z"), "27 Nov // 21:10");
  assert.equal(formatMbDate("2026-01-05T05:03:00Z"), "5 Jan // 00:03", "midnight is 00, not 24");
});

test("Writing and Sharing: day and short month, by the ET day", () => {
  assert.equal(formatDayMonth({ datetime: "2026-11-21T15:00:00Z" }), "21 Nov");
  assert.equal(formatDayMonth({ datetime: "2026-11-01T03:00:00Z" }), "31 Oct", "still Oct 31 in New York");
  assert.equal(formatDayMonth({ date: "2026-07-04" }), "4 Jul");
  assert.equal(dayMonthFromIsoDay("2026-09-09"), "9 Sep", "Sep, never Sept");
});

test("Reading: the short month alone", () => {
  assert.equal(formatMonth("2026-10"), "Oct");
  assert.equal(formatMonth("2026-09-14T00:00:00Z"), "Sep");
  assert.equal(formatMonth(""), "");
});
