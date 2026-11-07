import { test } from "node:test";
import assert from "node:assert/strict";
import { formatViews, isCountableView, parseGaPagesCsv, permalinkViewPath } from "./page-views.mjs";

const headers = (h) => new Headers(h);
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("permalinkViewPath canonicalises both permalink kinds", () => {
  assert.equal(permalinkViewPath("/thinking/2026-08-01-0647/"), "/thinking/2026-08-01-0647/");
  assert.equal(permalinkViewPath("/thinking/2026-08-01-0647"), "/thinking/2026-08-01-0647/");
  assert.equal(permalinkViewPath("/posts/hello-world?utm_source=x#top"), "/posts/hello-world/");
  assert.equal(permalinkViewPath("https://rommy.blog/posts/hello-world/"), "/posts/hello-world/");
  assert.equal(permalinkViewPath("/posts/caf%C3%A9/"), "/posts/café/");
});

test("permalinkViewPath rejects everything that is not a permalink", () => {
  for (const p of ["/", "/thinking/", "/thinking/images/", "/thinking/music", "/posts/", "/writing/", "/posts/a/b/", "/posts/%E0%A4%A/", ""]) {
    assert.equal(permalinkViewPath(p), null, p);
  }
});

test("isCountableView counts a browser GET and nothing else", () => {
  assert.equal(isCountableView("GET", headers({ "user-agent": SAFARI })), true);
  assert.equal(isCountableView("HEAD", headers({ "user-agent": SAFARI })), false);
  assert.equal(isCountableView("GET", headers({})), false);
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "facebookexternalhit/1.1",
    "Slackbot-LinkExpanding 1.0",
    "fingergunsbot/1.0 Twitterbot/1.0",
    "curl/8.7.1",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0",
  ]) {
    assert.equal(isCountableView("GET", headers({ "user-agent": ua })), false, ua);
  }
});

test("isCountableView skips prefetches and prerenders", () => {
  assert.equal(isCountableView("GET", headers({ "user-agent": SAFARI, "sec-purpose": "prefetch" })), false);
  assert.equal(isCountableView("GET", headers({ "user-agent": SAFARI, "sec-purpose": "prefetch;prerender" })), false);
  assert.equal(isCountableView("GET", headers({ "user-agent": SAFARI, purpose: "prefetch" })), false);
});

test("formatViews pluralises and groups thousands", () => {
  assert.equal(formatViews(1), "1 view");
  assert.equal(formatViews(2), "2 views");
  assert.equal(formatViews(1234), "1,234 views");
  assert.equal(formatViews(0), "0 views");
});

test("parseGaPagesCsv reads a GA4 export and merges slash variants", () => {
  const csv = [
    "# ----------------------------------------",
    "# Pages and screens: Page path and screen class",
    "# Start date: 20250101",
    "# ----------------------------------------",
    "",
    "Page path and screen class,Views,Active users,Views per active user",
    "/,900,400,2.25",
    "/posts/hello-world/,120,80,1.5",
    "/posts/hello-world,5,5,1",
    '"/posts/hello-world/?ref=x","1,000",3,1',
    "/thinking/2026-08-01-0647/,42,30,1.4",
    "/thinking/images/,10,8,1.25",
    ",1077,500,2.15",
  ].join("\n");
  const totals = parseGaPagesCsv(csv);
  assert.deepEqual(Object.fromEntries(totals), {
    "/posts/hello-world/": 1125,
    "/thinking/2026-08-01-0647/": 42,
  });
});

test("parseGaPagesCsv refuses a file without the expected columns", () => {
  assert.throws(() => parseGaPagesCsv("Date,Users\n20250101,4\n"), /Page path/);
});
