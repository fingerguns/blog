/** Default section hover tooltips (fallback when D1 has no stored hints). */

export const DEFAULT_SECTION_HINTS = {
  Thinking:
    "Short notes and media—photos, videos, voice memos, Spotify tracks, and YouTube clips—posted often without essay polish. Browse chronologically or as a grid, and filter by type. Recent threads run through NYC, travel, books, politics, sports, and whatever caught my eye that day: loose, opinionated, sometimes funny, always in the moment.",
  Writing:
    "Longer pieces when I have something to say—a mix of personal essays, small experiments, and the occasional haiku. Topics wander from style and walking to film, routine, building this site, and what it means to pay attention. Less of a diary, more room to think out loud.",
  Reading:
    "A storefront-style log of books I'm reading—cover art, title, and author, linked to Bookshop.org and grouped by month. Mostly literary fiction and translated work, not bestseller churn. List or grid view; a snapshot of what's open on my desk, not reviews or ratings.",
  Watching:
    "A film log—title and month watched, linked to Letterboxd—grouped chronologically like my reading list. Classic cinema, Hong Kong romance, documentaries, and whatever else landed that month. Ratings live in the archive data but aren't shown here yet; more a diary of what I watched than a ranked canon.",
  Sharing:
    "A linklog of URLs that caught my eye—title and link only, newest first. You'll find art and design, literature, architecture, NYC politics, sports, history, film, and the occasional rabbit hole. Not a news feed or hot-take column—more a personal signal of what I'm reading and think is worth a click.",
};

export const SECTION_NAMES = ["Thinking", "Writing", "Reading", "Watching", "Sharing"];

export const SECTION_CONTEXT = {
  Thinking:
    "Informal microblog: short text, photos, native video, audio (Voice Memos), Spotify embeds, and YouTube links. Archive has list and grid views with filters by media type. Updated often.",
  Writing: "Longer published essays and posts, including haiku and personal writing.",
  Reading:
    "Book log with cover art, title, and author; Bookshop.org links; grouped by month; list and grid views—not reviews.",
  Watching:
    "Film log with title, month watched, and Letterboxd link; chronological list—not reviews on the homepage; ratings stored but hidden for now.",
  Sharing: "Linklog of URLs with titles only—no commentary on individual links.",
};

export function mergeSectionHints(stored) {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_SECTION_HINTS };
  return { ...DEFAULT_SECTION_HINTS, ...stored };
}

export function buildSectionHintPrompt(section, samples, currentHint, options = {}) {
  const context = SECTION_CONTEXT[section] || "";
  const example = DEFAULT_SECTION_HINTS[section] || DEFAULT_SECTION_HINTS.Sharing;
  const sampleBlock =
    samples.length > 0
      ? samples.map((s) => `- ${s}`).join("\n")
      : "- (no entries yet)";

  const topRated = options.topRatedSamples || [];
  const topRatedBlock =
    topRated.length > 0
      ? `\nTop-rated films (use these to infer taste—mood, genre, era—not to list every title):\n${topRated.map((s) => `- ${s}`).join("\n")}\n`
      : "";

  const watchingExtra =
    section === "Watching" && options.archiveStats
      ? `\nArchive: ${options.archiveStats.total} films logged${options.archiveStats.first ? ` since ${options.archiveStats.first.slice(0, 4)}` : ""}.\n`
      : "";

  return `You write hover-tooltip blurbs for sections of rommy.blog, a personal blog by Rommy Ghaly.

Section: ${section}
What this section is: ${context}
${watchingExtra}
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
${topRatedBlock}
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
