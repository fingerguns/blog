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
    "Must Reads tab: Rommy's curated personal canon—books he thinks everyone should read. Alphabetical list, not chronological.",
};

export function mergeReadingTabIntros(stored) {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_READING_TAB_INTROS };
  return { ...DEFAULT_READING_TAB_INTROS, ...stored };
}

export function buildReadingTabIntroPrompt(tab, samples, currentIntro) {
  const context = READING_TAB_CONTEXT[tab] || "";
  const example = DEFAULT_READING_TAB_INTROS[tab] || DEFAULT_READING_TAB_INTROS.latest;
  const tabLabel = tab === "mustReads" ? "Must Reads" : "Latest";
  const sampleBlock =
    samples.length > 0
      ? samples.map((s) => `- ${s}`).join("\n")
      : "- (no entries yet)";

  return `You write intro paragraphs for the "${tabLabel}" tab on rommy.blog/reading — a personal book log by Rommy Ghaly.

Tab: ${tabLabel}
What this tab is: ${context}

Voice and format rules:
- Write for a blog visitor in third person ("Rommy's reading…", "Rommy's Must Reads list…")
- One paragraph, 4–6 sentences, roughly 120–220 words
- Describe themes, literary lean, and taste—not a catalog of every title
- Wrap book titles in HTML <em> tags (e.g. <em>The House of the Spirits</em>); author names stay plain
- Warm, specific, literate tone—not marketing copy
${tab === "latest" ? "- Focus on the past month or so of entries; mention a few representative titles by month when helpful" : "- Reflect the full curated list: translation, rediscovery, regional voices, and what ties the canon together"}

Example tone for this tab:
${example}

Current intro (refresh to reflect the books below while keeping this voice):
${currentIntro || example}

Books on this tab:
${sampleBlock}

Write ONLY the new intro paragraph with <em> tags around book titles. No quotes, no heading, no explanation.`;
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
  // Convert markdown italics to <em> when the model ignores HTML instructions.
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  // Strip tags other than em.
  s = s.replace(/<(?!\/?em\b)[^>]+>/gi, "");
  if (s.length > 2200) s = `${s.slice(0, 2197)}…`;
  return s;
}
