import { test } from "node:test";
import assert from "node:assert/strict";
import { findLineCitations } from "./doc-citations.mjs";

const matches = (text) => findLineCitations(text).map((c) => c.match);

test("flags path:line citations, with ranges and lists", () => {
  assert.deepEqual(matches("see `scripts/build.mjs:1994`"), ["scripts/build.mjs:1994"]);
  assert.deepEqual(matches("`worker/update-thinking.js:622-685`"), ["worker/update-thinking.js:622-685"]);
  assert.deepEqual(matches("`worker/wrangler.toml:11-13,58`"), ["worker/wrangler.toml:11-13,58"]);
  assert.deepEqual(matches("`colophon/index.html:29,44`"), ["colophon/index.html:29,44"]);
  assert.deepEqual(matches("README.md#L190"), ["README.md#L190"]);
});

test("flags `path` line N and lines N–M in prose", () => {
  assert.deepEqual(matches("`scripts/build.mjs` line 1957 renders"), ["scripts/build.mjs` line 1957"]);
  assert.deepEqual(matches("`worker/update-thinking.js` lines 622–685."), ["worker/update-thinking.js` lines 622–685"]);
  assert.deepEqual(matches("README.md lines 149 - 160"), ["README.md lines 149 - 160"]);
});

test("flags code-reference fences", () => {
  assert.deepEqual(matches("```1011:1028:scripts/build.mjs"), ["```1011:1028:scripts/build.mjs"]);
});

test("reports line and column", () => {
  assert.deepEqual(findLineCitations("ok\nsee build.mjs:12"), [{ line: 2, column: 5, match: "build.mjs:12" }]);
});

test("leaves names, URLs, ports, times and versions alone", () => {
  for (const text of [
    "`changelogListHtml` in `scripts/build.mjs`",
    "`triggerRebuild()` in `worker/update-thinking.js`",
    "http://localhost:3000/thinking/",
    "https://rommy.blog/posts/hello/",
    "at 18:50:02 UTC",
    "Node.js 20.6+",
    "markdownlint-cli2@0.24.0",
    "a 2×2 grid, 512px thumbs",
    "```js",
    "the `## Cloudflare Pages` section",
  ]) {
    assert.deepEqual(matches(text), [], text);
  }
});

test("a line marked citation-ok is skipped", () => {
  assert.deepEqual(matches("not `scripts/build.mjs:1994` <!-- citation-ok -->"), []);
});
