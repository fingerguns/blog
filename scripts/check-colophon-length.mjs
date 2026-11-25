// Fails when the short-form colophon is over its word budget.
// Usage: node scripts/check-colophon-length.mjs [path]   (default colophon/index.html)
//        npm run lint:colophon

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SHORT_COLOPHON_WORD_LIMIT, shortColophonWordCount } from "./lib/colophon.mjs";

const path = process.argv[2] || fileURLToPath(new URL("../colophon/index.html", import.meta.url));
const words = shortColophonWordCount(readFileSync(path, "utf8"));

if (words >= SHORT_COLOPHON_WORD_LIMIT) {
  console.error(`Short-form colophon is ${words} words; it must stay under ${SHORT_COLOPHON_WORD_LIMIT}. Cut something before adding anything — the long-form and Whitman versions are where detail goes.`);
  process.exit(1);
}
console.log(`Short-form colophon: ${words} words (limit: under ${SHORT_COLOPHON_WORD_LIMIT}).`);
