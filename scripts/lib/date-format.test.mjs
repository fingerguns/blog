// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dayMonthYearFromIsoDay,
  formatDayMonthYear,
  formatMbDate,
  formatMonthYear,
} from "./render/format.mjs";

test("Thinking: day, short month, year, then the ET time", () => {
  // 02:10 UTC on Nov 28 is 21:10 on Nov 27 in New York.
  assert.equal(formatMbDate("2026-11-28T02:10:03.701Z"), "27 Nov 2026 // 21:10");
  assert.equal(formatMbDate("2026-01-05T05:03:00Z"), "5 Jan 2026 // 00:03", "midnight is 00, not 24");
});

test("Writing and Sharing: day, short month, year, by the ET day", () => {
  assert.equal(formatDayMonthYear({ datetime: "2026-11-21T15:00:00Z" }), "21 Nov 2026");
  assert.equal(formatDayMonthYear({ datetime: "2026-11-01T03:00:00Z" }), "31 Oct 2026", "still Oct 31 in New York");
  assert.equal(formatDayMonthYear({ date: "2026-07-04" }), "4 Jul 2026");
  assert.equal(dayMonthYearFromIsoDay("2026-09-09"), "9 Sep 2026", "Sep, never Sept");
});

test("Reading: short month and year", () => {
  assert.equal(formatMonthYear("2026-10"), "Oct 2026");
  assert.equal(formatMonthYear("2026-09-14T00:00:00Z"), "Sep 2026");
  assert.equal(formatMonthYear(""), "");
});
