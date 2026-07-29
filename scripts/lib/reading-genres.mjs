/** Prompt + parsing for Must Reads per-book genre assignment. */

export const GENRE_SUGGESTIONS = [
  "Literary realism",
  "Magical realism & mythic",
  "Western & frontier",
  "Southern & American regional",
  "Modernist & experimental",
  "Noir & transgressive",
  "Philosophical & psychological",
  "Pastoral & landscape",
  "Satire & comic",
  "Nonfiction",
];

export function slugifyGenreLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatBookLine(book) {
  if (book.author) return `${book.title} — ${book.author}`;
  return book.title;
}

export function buildGenreAssignmentPrompt(book, existingGenres) {
  const bookLine = formatBookLine(book);
  const existingBlock =
    existingGenres.length > 0
      ? existingGenres.map((g) => `- ${g.label} (${g.slug})`).join("\n")
      : "- (none yet)";
  const suggestions = GENRE_SUGGESTIONS.map((g) => `- ${g}`).join("\n");

  return `Assign 1–3 literary-mode genre tags to this Must Reads book from rommy.blog.

Book: ${bookLine}

Existing genre tags in the catalog (prefer reusing these when they fit):
${existingBlock}

Suggested genre labels when nothing existing applies (not a fixed enum):
${suggestions}

Rules:
- Assign 1–3 tags with rank 1 (primary, required), optional rank 2 (secondary), optional rank 3 (tertiary)
- Use literary form/mode genres — not geography, author names, or book titles
- Prefer existing catalog labels exactly when they fit; only propose a new label when necessary
- Labels should be short (1–5 words), title case for display
- Do not duplicate the same genre at multiple ranks

Respond with ONLY valid JSON (no markdown, no explanation):
{"tags":[{"label":"Literary realism","rank":1},{"label":"Western & frontier","rank":2}]}`;
}

export function parseGenreAssignmentResponse(text) {
  if (typeof text !== "string") {
    throw new Error("Empty model response");
  }

  let raw = text.trim();
  raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain JSON");
  }

  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed.tags)) {
    throw new Error("JSON missing tags array");
  }

  return normalizeGenreTags(parsed.tags);
}

export function normalizeGenreTags(rawTags) {
  const byRank = new Map();

  for (const tag of rawTags) {
    const label = typeof tag?.label === "string" ? tag.label.trim() : "";
    const rank = Number(tag?.rank);
    if (!label) continue;
    if (!Number.isFinite(rank) || rank < 1 || rank > 3) continue;

    const slug = slugifyGenreLabel(label);
    if (!slug) continue;

    if (!byRank.has(rank)) {
      byRank.set(rank, { label, slug, rank: Math.round(rank) });
    }
  }

  const tags = [...byRank.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, tag]) => tag)
    .slice(0, 3);

  const seenSlugs = new Set();
  const deduped = [];
  for (const tag of tags) {
    if (seenSlugs.has(tag.slug)) continue;
    seenSlugs.add(tag.slug);
    deduped.push(tag);
  }

  if (deduped.length === 0) {
    throw new Error("No valid genre tags in model response");
  }
  if (!deduped.some((t) => t.rank === 1)) {
    deduped[0] = { ...deduped[0], rank: 1 };
  }

  return deduped.map((tag, index) => ({ ...tag, rank: index + 1 }));
}
