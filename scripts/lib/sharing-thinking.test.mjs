// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { sharingPostText, thinkingSlugCandidates } from "./sharing-thinking.mjs";

test("the post text is title, hashtags, then the link on its own line", () => {
  assert.equal(
    sharingPostText({ title: "A good loaf", url: "https://example.com/bread", tags: ["food"] }),
    "A good loaf #food #recipes\n\nhttps://example.com/bread"
  );
});

test("an untagged link goes out with no hashtags", () => {
  assert.equal(sharingPostText({ title: "Untitled", url: "https://example.com/" }), "Untitled\n\nhttps://example.com/");
  assert.equal(sharingPostText({ title: "Untitled", url: "https://example.com/", tags: ["not-a-tag"] }), "Untitled\n\nhttps://example.com/");
});

test("slug candidates start at the post's own minute and step a minute at a time", () => {
  // 2026-11-25 14:59 UTC is 09:59 in New York.
  const slugs = thinkingSlugCandidates(new Date("2026-11-25T14:59:30Z"), 3);
  assert.deepEqual(slugs, ["2026-11-25-0959", "2026-11-25-1000", "2026-11-25-1001"]);
});

test("slug candidates roll over midnight Eastern", () => {
  const slugs = thinkingSlugCandidates(new Date("2026-11-26T04:59:00Z"), 2);
  assert.deepEqual(slugs, ["2026-11-25-2359", "2026-11-26-0000"]);
});
