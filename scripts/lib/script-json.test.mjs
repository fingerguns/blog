// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonForScript } from "./script-json.mjs";

test("a closing script tag cannot terminate the block early", () => {
  const out = jsonForScript([{ text: "look at this </script><img src=x> tag" }]);
  assert.ok(!out.includes("</script>"), "raw closing tag must not survive");
  assert.ok(out.includes("\\u003c"));
});

test("an HTML comment opener is escaped too", () => {
  assert.ok(!jsonForScript("<!--").includes("<!--"));
});

test("escaping does not change the decoded value", () => {
  const value = { text: "a </script> b <!-- c <div>" };
  assert.deepEqual(JSON.parse(jsonForScript(value)), value);
});

test("line and paragraph separators are escaped", () => {
  const value = "a b c";
  const out = jsonForScript(value);
  assert.ok(!out.includes(" "));
  assert.ok(!out.includes(" "));
  assert.equal(JSON.parse(out), value);
});

test("ordinary values are untouched apart from the escaping", () => {
  assert.equal(jsonForScript({ a: 1 }), '{"a":1}');
  assert.equal(jsonForScript([1, "two"]), '[1,"two"]');
  assert.equal(jsonForScript(null), "null");
});

test("the escaped form is still valid JSON and parses as JS identically", () => {
  const value = [{ text: "</script>", n: 1 }];
  const src = jsonForScript(value);
  assert.deepEqual(JSON.parse(src), value);
  // What a browser does with the inline literal, rather than what JSON.parse does.
  assert.deepEqual(new Function(`return (${src});`)(), value);
});
