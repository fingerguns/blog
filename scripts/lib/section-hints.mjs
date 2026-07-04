/** Default section hover tooltips (fallback when D1 has no stored hints). */

export const DEFAULT_SECTION_HINTS = {
  Thinking:
    "Short notes, photos, and passing thoughts—updated often, with none of the polish of a full essay. You'll find book quotes, travel snapshots, NYC gripes, sports reactions, politics, art, and whatever's on my mind right now. It's the informal layer of the site: loose, opinionated, sometimes funny, sometimes ranty, always in the moment.",
  Writing:
    "Longer pieces when I have something to say—a mix of personal essays, small experiments, and the occasional haiku. Topics wander from style and walking to film, routine, building this site, and what it means to pay attention. Less of a diary, more room to think out loud.",
  Reading:
    "A log of books I'm reading, linked to Bookshop.org and grouped by month. Mostly literary fiction and translated work—the kind of books you'd find on a serious reader's nightstand, not a bestseller list. It's a snapshot of what's open on my desk, not reviews or ratings.",
  Sharing:
    "Sharing is a linklog—a running list of links that caught my eye, with no commentary, just the title and the URL, newest first. If you browse it, you'll find a mix that reflects how I actually use the internet: art and design, literature and poetry, architecture, NYC politics, sports, history, film, and the occasional rabbit hole (indie web, style, food, a perfect photo). It's not a news feed or a hot-take column—more a personal signal of what I'm reading, noticing, and think is worth a click, high and low, serious and playful, all in one stream.",
};

export const SECTION_NAMES = ["Thinking", "Writing", "Reading", "Sharing"];

export const SECTION_CONTEXT = {
  Thinking:
    "Informal microblog notes—short posts and photos, not polished essays. Updated often.",
  Writing: "Longer published essays and posts, including haiku and personal writing.",
  Reading: "A book log linked to Bookshop.org, grouped by month—not reviews or ratings.",
  Sharing: "A linklog of URLs with titles only—no commentary on individual links.",
};

export function mergeSectionHints(stored) {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_SECTION_HINTS };
  return { ...DEFAULT_SECTION_HINTS, ...stored };
}

export function buildSectionHintPrompt(section, samples, currentHint) {
  const context = SECTION_CONTEXT[section] || "";
  const example = DEFAULT_SECTION_HINTS[section] || DEFAULT_SECTION_HINTS.Sharing;
  const sampleBlock =
    samples.length > 0
      ? samples.map((s) => `- ${s}`).join("\n")
      : "- (no entries yet)";

  return `You write hover-tooltip blurbs for sections of rommy.blog, a personal blog by Rommy Ghaly.

Section: ${section}
What this section is: ${context}

Voice and format rules:
- Write for a blog visitor (mix of "you'll find" and first-person "my" is fine)
- One paragraph, 2–4 sentences, under 120 words
- Describe what the section IS and the vibe/themes of recent content—not a list of every item
- Warm, specific, literate tone—not marketing copy

Example tone for this section:
${example}

Current tooltip (refresh to reflect recent content while keeping this voice):
${currentHint || example}

Recent entries:
${sampleBlock}

Write ONLY the new tooltip paragraph. No quotes, no heading, no explanation.`;
}

export function normalizeSectionHint(text) {
  if (typeof text !== "string") return "";
  let s = text.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^tooltip:\s*/i, "").trim();
  if (s.length > 900) s = `${s.slice(0, 897)}…`;
  return s;
}
