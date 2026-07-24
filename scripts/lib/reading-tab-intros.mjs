/** Default Reading tab intro copy (fallback when D1 has no stored intros). */

export const READING_TAB_KEYS = ["latest", "mustReads"];

export const DEFAULT_READING_TAB_INTROS = {
  latest: `Over the past month, Rommy's reading has leaned hard into Mediterranean and European littoral fiction — quiet, place-saturated books where landscape and memory do as much work as plot. In July that meant Isabel Allende's generational Chile (<em>The House of the Spirits</em>), Greek coming-of-age and village life (<em>Three Summers</em>, <em>When the Tree Sings</em>, <em>The Murderess</em>), Jean Giono's pastoral Provence (<em>Hill</em>), and Patrick Modiano's spectral Paris (<em>In the Café of Lost Youth</em>); in June, Mercè Rodoreda's seaside Catalonia (<em>Garden by the Sea</em>) and Leonora Carrington's surrealism (<em>The Stone Door</em>). Nothing on the recent list is Anglo-American frontlist fiction — it is all translated or international, mostly mid-length, and tuned to mood, exile, and the texture of a specific world. Lately he seems to be chasing atmosphere and cultural rootedness more than narrative velocity.`,
  mustReads: `Rommy's Must Reads list reads like a personal canon of literary fiction that favors translation, rediscovery, and depth over novelty. It is anchored in Latin American and European voices — García Márquez, Bolaño, Cortázar, Rulfo, Allende, Kundera, Bulgakov, Modiano — alongside American masters of moral weight and atmosphere (McCarthy, McCullers, Baldwin, Capote, <em>Stoner</em>). NYRB Classics and small-press sensibilities show up again and again: <em>Butcher's Crossing</em>, <em>Hard Rain Falling</em>, <em>Moravagine</em>, <em>The Door</em>, <em>The Murderess</em>. The list also reaches outward — Greek (<em>Three Summers</em>, <em>When the Tree Sings</em>), Japanese (<em>No Longer Human</em>, <em>Kafka on the Shore</em>), Arabic (<em>Woman at Point Zero</em>, <em>French Perfume</em>, <em>The Diesel</em>) — and makes room for a few outliers (<em>Jitterbug Perfume</em>, <em>In Cold Blood</em>, <em>The Great Bridge</em>) that share the same appetite for voice, place, and consequence. Overall, the taste is serious but not solemn: psychologically rich, often regional or outsider-centered, and allergic to bestseller churn.`,
};

export const READING_TAB_CONTEXT = {
  latest:
    "Latest tab: books Rommy is reading now, grouped by month. A snapshot of recent taste—not reviews or ratings.",
  mustReads:
    "Must Reads tab: Rommy's curated personal canon—books he thinks everyone should read. Sorted A–Z by title, not ranked or chronological.",
};

const STYLE_GUIDE =
  "Third-person visitor voice about Rommy Ghaly (he/him/his): 'Rommy's reading…', 'Rommy's Must Reads list…'. One paragraph, 4–6 sentences, ~120–220 words. Warm, literate, specific—describe themes and taste, not every title. Wrap book titles in <em> tags. Only mention books that appear in the list below.";

const MUST_READS_STYLE =
  "For Must Reads: note that titles below are listed alphabetically (A–Z), not ranked. Do NOT mention when books were added or 'recent additions.' Focus on moods, genres, literary styles, geography, era, and what ties the canon together—translation, rediscovery, regional voices, atmosphere. Cite a few representative titles in <em> tags as examples, not a full catalog.";

function truncate(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function compactTitleList(titles, maxChars = 1800) {
  const joined = titles.join(", ");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 20)}… (${titles.length} titles total)`;
}

export function mergeReadingTabIntros(stored) {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_READING_TAB_INTROS };
  return { ...DEFAULT_READING_TAB_INTROS, ...stored };
}

export function buildReadingTabIntroPrompt(tab, sampleData, currentIntro) {
  const context = READING_TAB_CONTEXT[tab] || "";
  const tabLabel = tab === "mustReads" ? "Must Reads" : "Latest";
  const prior = truncate(currentIntro, 320);

  let bookBlock = "- (no entries yet)";
  if (tab === "latest" && Array.isArray(sampleData?.entries) && sampleData.entries.length) {
    bookBlock = sampleData.entries.map((s) => `- ${s}`).join("\n");
  } else if (tab === "mustReads" && sampleData?.count) {
    bookBlock = `Total books: ${sampleData.count}
Order: alphabetical by title (A–Z), not ranked or chronological

Titles on the list:
${compactTitleList(sampleData.titles || [])}`;
  }

  const tabStyle = tab === "mustReads" ? `${STYLE_GUIDE}\n${MUST_READS_STYLE}` : STYLE_GUIDE;
  const refreshNote =
    tab === "mustReads"
      ? "Write new copy that captures the literary character of the full list—moods, genres, styles, geography, and era—not when individual books were added."
      : "Write new copy that reflects the books below—especially recent months—and captures the current shape of the list.";

  return `Write a fresh intro paragraph for the "${tabLabel}" tab on rommy.blog/reading.

Tab: ${tabLabel}
What this tab is: ${context}

Style: ${tabStyle}

Do NOT copy the previous intro verbatim. ${refreshNote}

Previous intro (for tone reference only—do not reuse sentences):
${prior || "(none yet)"}

Books:
${bookBlock}

Output ONLY the new paragraph with <em> tags around book titles. No quotes, heading, or explanation.`;
}

export function normalizeReadingTabIntro(text) {
  if (typeof text !== "string") return "";
  let s = text.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^intro:\s*/i, "").trim();
  s = s.replace(/^```(?:html|markdown|text)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  // Convert markdown italics to <em> when the model ignores HTML instructions.
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  // Strip tags other than em.
  s = s.replace(/<(?!\/?em\b)[^>]+>/gi, "");
  if (s.length > 2200) s = `${s.slice(0, 2197)}…`;
  return s;
}

export function introsAreSimilar(a, b) {
  const norm = (s) =>
    String(s || "")
      .replace(/<\/?em>/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  return left === right;
}
