/**
 * Fail if any tracked Markdown file cites code by line number
 * (scripts/lib/doc-citations.mjs). Run in CI by
 * .github/workflows/docs-check.yml, and locally with:
 *
 *   npm run lint:citations
 *
 * Node built-ins and git only — no install needed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findLineCitations } from "./lib/doc-citations.mjs";

const files = execFileSync("git", ["ls-files", "-z", "*.md"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && !f.includes("node_modules/"));

let total = 0;
for (const file of files) {
  for (const c of findLineCitations(readFileSync(file, "utf8"))) {
    total++;
    // GitHub Actions turns this into an annotation on the file and line.
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::error file=${file},line=${c.line},col=${c.column}::Cite code by name, not line number: ${c.match}`);
    } else {
      console.log(`${file}:${c.line}:${c.column}  ${c.match}`);
    }
  }
}

if (total) {
  console.error(
    `\n${total} line-number citation(s) in ${files.length} Markdown files. ` +
      "Cite the function, constant, section or link text instead (CLAUDE.md → Cite code by name). " +
      'A line that must show the pattern can opt out with "citation-ok" on it.'
  );
  process.exit(1);
}
console.log(`No line-number citations in ${files.length} Markdown files.`);
