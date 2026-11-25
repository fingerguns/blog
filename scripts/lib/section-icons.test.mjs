// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SECTION_ICONS, sectionLabelHtml, sectionTipHtml } from "./section-icons.mjs";

test("an icon heading keeps its name as text for screen readers", () => {
  const html = sectionLabelHtml("Thinking", { icon: true });
  assert.match(html, /<svg class="section-icon"[^>]*aria-hidden="true"/);
  assert.match(html, /<span class="visually-hidden">Thinking<\/span>/);
});

test("without the option, or with no icon for the label, the heading is plain text", () => {
  assert.equal(sectionLabelHtml("Thinking"), "Thinking");
  assert.equal(sectionLabelHtml("Walking", { icon: true }), "Walking");
});

test("an icon heading with no hint still names itself in its tooltip", () => {
  assert.equal(
    sectionTipHtml("Elsewhere", undefined, { icon: true }),
    '<span class="section-hint-name" aria-hidden="true">Elsewhere</span>'
  );
});

test("an icon heading's tooltip leads with the section name, hidden from screen readers", () => {
  assert.equal(
    sectionTipHtml("Reading", "Books & more", { icon: true }),
    '<span class="section-hint-name" aria-hidden="true">Reading</span>Books &amp; more'
  );
  assert.equal(sectionTipHtml("Reading", "Books"), "Books");
});

test("the icons are the admin tabs' icons", () => {
  // Same glyph in both places: every path here appears in the admin tab of the same name.
  const admin = readFileSync(fileURLToPath(new URL("../../admin/index.html", import.meta.url)), "utf8");
  const tabs = { Thinking: "thinking", Writing: "post", Reading: "reading", Sharing: "sharing" };
  for (const [label, tab] of Object.entries(tabs)) {
    const button = admin.match(new RegExp(`<button[^>]*data-tab="${tab}"[^>]*>[\\s\\S]*?</button>`))?.[0] || "";
    for (const d of SECTION_ICONS[label].match(/ d="[^"]+"/g)) {
      assert.ok(button.includes(d), `${label}: admin tab "${tab}" lacks${d}`);
    }
  }
});
