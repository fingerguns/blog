/**
 * Line-number citations in documentation: `scripts/build.mjs:1994`,
 * `worker/update-thinking.js` lines 622–685, `README.md#L190`, or a code
 * fence tagged ```1011:1028:scripts/build.mjs. Each is wrong after the next
 * edit to the file it points into; the docs cite code by name instead
 * (CLAUDE.md → "Cite code by name"). scripts/check-doc-citations.mjs runs
 * this over every tracked Markdown file in CI.
 *
 * A line that has to show the pattern — an example of what not to do —
 * opts out with the marker `citation-ok` anywhere on it (in Markdown, as an
 * HTML comment: <!-- citation-ok -->).
 */

const EXT = "(?:m?js|cjs|ts|md|html|css|toml|sql|json|ya?ml|sh)";

const PATTERNS = [
  // path.ext:123, path.ext:12-34, path.ext#L123
  new RegExp(`[\\w./-]+\\.${EXT}(?::\\d+(?:[-–,]\\d+)*|#L\\d+)`, "g"),
  // `path.ext` line 12 / lines 12–34 (backticks optional)
  new RegExp(`[\\w./-]+\\.${EXT}\`?,?\\s+lines?\\s+\\d+(?:\\s*[-–]\\s*\\d+)?`, "g"),
  // ```12:34:path — the "code reference" fence some tools write
  /^\s*```\d+:\d+:\S+/g,
];

export const OPT_OUT_MARKER = "citation-ok";

/**
 * Every line-number citation in `text`, as { line, column, match }.
 * Fenced code blocks are scanned too: a quoted snippet labelled with line
 * numbers goes stale the same way.
 */
export function findLineCitations(text) {
  const found = [];
  String(text)
    .split(/\r?\n/)
    .forEach((lineText, i) => {
      if (lineText.includes(OPT_OUT_MARKER)) return;
      for (const re of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(lineText))) {
          found.push({ line: i + 1, column: m.index + 1, match: m[0].trim() });
        }
      }
    });
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}
