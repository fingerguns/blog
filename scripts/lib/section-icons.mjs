// Icons for the homepage section headings. Thinking, Writing, Reading and
// Sharing use the same glyphs as their admin tabs (admin/index.html,
// `.tab-glyph`), so a section looks the same in both places — keep the two in
// step. Elsewhere, which has no admin tab, is a globe.

const svg = (paths) =>
  `<svg class="section-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const SECTION_ICONS = {
  // speech bubble
  Thinking: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  // pen
  Writing: svg(
    '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>'
  ),
  // open book
  Reading: svg(
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'
  ),
  // link
  Sharing: svg(
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
  ),
  // globe
  Elsewhere: svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * What goes inside a section heading's hint span: the label as text, or —
 * when `icon` is set and the label has one — the icon, with the label kept
 * as visually hidden text so the heading's accessible name is unchanged.
 */
export function sectionLabelHtml(label, { icon = false } = {}) {
  const glyph = icon ? SECTION_ICONS[label] : null;
  if (!glyph) return esc(label);
  return `${glyph}<span class="visually-hidden">${esc(label)}</span>`;
}

/**
 * The tooltip's contents. An icon heading's tooltip starts with the section's
 * name, since the icon alone doesn't say it; that name is aria-hidden because
 * a screen reader already has it as the heading text.
 */
export function sectionTipHtml(label, hint, { icon = false } = {}) {
  const name = icon && SECTION_ICONS[label] ? `<span class="section-hint-name" aria-hidden="true">${esc(label)}</span>` : "";
  return `${name}${esc(hint ?? "")}`;
}
