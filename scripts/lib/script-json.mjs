/**
 * Serialize a value for embedding inside an inline `<script>` block.
 *
 * `JSON.stringify` alone is NOT safe here. It escapes what JSON requires and
 * nothing more, so a string containing `</script>` survives verbatim — and the
 * HTML parser, which knows nothing about JavaScript syntax, ends the script
 * element at that point and treats the remainder as markup. A Thinking note
 * reading `look at this </script><img src=x onerror=...>` would therefore break
 * the archive page and inject an element into it.
 *
 * Escaping `<` as `\u003c` prevents that: inside a JS string literal the escape
 * is the same character, so nothing about the parsed value changes, but the HTML
 * parser no longer sees a closing tag. That also covers `<!--`, the other
 * sequence the parser treats specially inside a script element.
 *
 * U+2028 and U+2029 are escaped too. They are valid unescaped inside JSON but
 * were line terminators in JavaScript before ES2019, and escaping them costs
 * nothing.
 *
 * Only for inline `<script>`. Data written to a `.json` file (the search index)
 * needs none of this, because no HTML parser ever sees it.
 */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
