/** Prompt + parsing for Fable-generated Reading tag clouds. */

export const TAG_CLOUD_TABS = {
  latest: "Latest",
  mustReads: "Must Reads",
};

function formatBookLine(book) {
  if (book.author) return `${book.title} — ${book.author}`;
  return book.title;
}

export function buildTagCloudPrompt(tab, books) {
  const tabLabel = TAG_CLOUD_TABS[tab] || tab;
  const bookBlock =
    books.length > 0
      ? books.map((b) => `- ${formatBookLine(b)}`).join("\n")
      : "- (no entries yet)";

  const tabNote =
    tab === "latest"
      ? "Focus on themes visible in this recent two-month window."
      : "Reflect the full curated canon — translation, rediscovery, regional voices, and what ties the list together.";

  return `Analyze this "${tabLabel}" book list from rommy.blog/reading and produce a thematic tag cloud.

Tab: ${tabLabel}
${tabNote}

Rules:
- Return 12–18 tags describing taste and themes (regions, genres, moods, literary movements, translation, era)
- Do NOT use individual book titles or author names as tags
- weight is an integer 1–5 (5 = most central to this list's taste)
- Tags should be short (1–4 words), lowercase except proper nouns/regions

Books:
${bookBlock}

Respond with ONLY valid JSON in this shape (no markdown, no explanation):
{"tags":[{"label":"Mediterranean fiction","weight":5},{"label":"translation","weight":4}]}`;
}

export function parseTagCloudResponse(text) {
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

  const tags = parsed.tags
    .map((tag) => {
      const label = typeof tag?.label === "string" ? tag.label.trim() : "";
      const weight = Number(tag?.weight);
      if (!label) return null;
      if (!Number.isFinite(weight) || weight < 1 || weight > 5) return null;
      return { label, weight: Math.round(weight) };
    })
    .filter(Boolean);

  if (tags.length < 8) {
    throw new Error(`Too few valid tags (${tags.length})`);
  }

  tags.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  return { tags };
}

export function formatTagCloudForDisplay(tab, tagCloud) {
  const tabLabel = TAG_CLOUD_TABS[tab] || tab;
  const lines = [`## ${tabLabel}`, ""];

  for (const { label, weight } of tagCloud.tags) {
    if (weight >= 5) lines.push(`- Weight ${weight}: **${label}**`);
    else if (weight >= 4) lines.push(`- Weight ${weight}: ${label}`);
    else if (weight >= 3) lines.push(`- Weight ${weight}: *${label}*`);
    else lines.push(`- Weight ${weight}: ${label}`);
  }

  const inline = tagCloud.tags
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map(({ label, weight }) => (weight >= 5 ? `**${label}**` : weight >= 3 ? `*${label}*` : label))
    .join(" · ");

  lines.push("", `Inline: ${inline}`, "");
  return lines.join("\n");
}
