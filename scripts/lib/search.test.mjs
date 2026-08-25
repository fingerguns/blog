// Run with: npm test
//
// This is the same module the browser loads from /search-core.js, so what
// passes here is what runs on the site.

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalize, tokenize, truncate, scoreDoc, search, excerpt } from "./search.mjs";

const doc = (over = {}) => ({ k: "writing", t: "", x: "", u: "/x/", d: "2026-01-01", ...over });

test("normalize folds accents, smart punctuation, and whitespace", () => {
  assert.equal(normalize("Cortázar"), "cortazar");
  assert.equal(normalize("“quoted”"), '"quoted"');
  assert.equal(normalize("it’s"), "it's");
  assert.equal(normalize("a — b"), "a - b");
  assert.equal(normalize("  lots   of\n space "), "lots of space");
});

test("tokenize splits on punctuation but keeps apostrophes and hyphens", () => {
  assert.deepEqual(tokenize("walking, a lot!"), ["walking", "a", "lot"]);
  assert.deepEqual(tokenize("it's well-worn"), ["it's", "well-worn"]);
  assert.deepEqual(tokenize("   "), []);
});

test("truncate cuts on a word boundary", () => {
  const text = "the quick brown fox jumps over the lazy dog";
  const out = truncate(text, 20);
  assert.ok(out.endsWith("…"));
  assert.ok(out.length <= 21);
  assert.ok(!out.slice(0, -1).endsWith(" "));
  // Short text is returned untouched, with no ellipsis.
  assert.equal(truncate("short", 20), "short");
});

test("every term must match — extra words narrow the result", () => {
  const d = doc({ t: "On Walking", x: "a lot of sidewalks" });
  assert.ok(scoreDoc(d, ["walking"]) > 0);
  assert.equal(scoreDoc(d, ["walking", "bicycle"]), 0);
});

test("a title match outranks a body match", () => {
  const inTitle = doc({ t: "Walking", x: "unrelated", u: "/title/" });
  const inBody = doc({ t: "Something Else", x: "walking", u: "/body/" });
  assert.ok(scoreDoc(inTitle, ["walking"]) > scoreDoc(inBody, ["walking"]));
});

test("a word-boundary match outranks a mid-word one", () => {
  const prefix = doc({ t: "Walking Home" });
  const midword = doc({ t: "Jaywalking" });
  assert.ok(scoreDoc(prefix, ["walk"]) > scoreDoc(midword, ["walk"]));
});

test("a whole-phrase match outranks scattered terms", () => {
  const phrase = doc({ x: "the importance of routine" });
  const scattered = doc({ x: "routine matters, and so does the importance of other things" });
  assert.ok(scoreDoc(phrase, ["importance", "of", "routine"]) >
            scoreDoc(scattered, ["importance", "of", "routine"]));
});

test("search ranks, limits, and breaks ties by recency", () => {
  const docs = [
    doc({ t: "Walking", u: "/old/", d: "2020-01-01" }),
    doc({ t: "Walking", u: "/new/", d: "2026-01-01" }),
    doc({ t: "nothing here", x: "nothing here" }),
  ];
  const hits = search(docs, "walking");
  assert.equal(hits.length, 2, "non-matching doc excluded");
  assert.equal(hits[0].doc.u, "/new/", "equal scores break toward the newer item");

  assert.deepEqual(search(docs, "   "), [], "an empty query matches nothing");
  assert.equal(search(docs, "walking", { limit: 1 }).length, 1);
});

test("search matches across accents", () => {
  const docs = [doc({ t: "Hopscotch", x: "by Julio Cortázar" })];
  assert.equal(search(docs, "cortazar").length, 1);
});

test("excerpt centres on the first matching term", () => {
  const d = doc({ x: "a".repeat(200) + " needle " + "b".repeat(200) });
  const out = excerpt(d, ["needle"]);
  assert.ok(out.includes("needle"));
  assert.ok(out.startsWith("…") && out.endsWith("…"), "elided on both sides");
  assert.ok(out.length < 250, "excerpt is a window, not the whole text");
});

test("excerpt falls back when the term is only in the title", () => {
  const d = doc({ t: "Needle", x: "some body text without it" });
  const out = excerpt(d, ["needle"]);
  assert.ok(out.startsWith("some body text"));
});

test("a document with no text yields an empty excerpt", () => {
  assert.equal(excerpt(doc({ x: "" }), ["anything"]), "");
});
