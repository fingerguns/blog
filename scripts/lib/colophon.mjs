// The colophon page (colophon/index.html) carries three versions of the same
// facts: short-form (the default), long-form, and the Walt Whitman retelling.
// The short-form version has a hard budget — SHORT_COLOPHON_WORD_LIMIT words —
// checked by `npm test`, `npm run lint:colophon`, the docs-check workflow and
// the docs-guard commit hook, so it cannot quietly grow into a second
// long-form version as features are added.

export const SHORT_COLOPHON_WORD_LIMIT = 500;

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", mdash: " — ", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** Inner HTML of the element with this id, or null. The colophon panels contain no nested <div>s. */
export function colophonSection(html, id) {
  const open = new RegExp(`<div\\b[^>]*\\bid="${id}"[^>]*>`).exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const end = html.indexOf("</div>", start);
  return end === -1 ? null : html.slice(start, end);
}

/** Visible text of an HTML fragment: tags dropped, common entities decoded. */
export function htmlToText(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Words as a reader would count them: runs separated by whitespace or a dash, containing a letter or digit. */
export function countWords(text) {
  return text.split(/[\s—–]+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function shortColophonWordCount(html) {
  const section = colophonSection(html, "colophon-short");
  if (section === null) throw new Error('colophon/index.html has no <div id="colophon-short">');
  return countWords(htmlToText(section));
}
