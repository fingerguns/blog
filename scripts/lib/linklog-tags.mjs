/** Prompt + parsing for Sharing (linklog) topic-tag assignment. */

// Fixed taxonomy — unlike Reading genres this is a closed set, not
// open-ended, since it backs a fixed dropdown filter on /sharing/.
export const LINKLOG_TAG_LABELS = {
  art: "Art & Artists",
  architecture: "Architecture & Design",
  books: "Books & Writing",
  food: "Food & Recipes",
  film: "Film, TV & Comedy",
  politics: "Politics & Current Events",
  science: "Science & Health",
  society: "Society & Culture",
  history: "History & Archaeology",
  tech: "Tech & Business",
  sports: "Sports",
  outdoors: "Outdoors & Travel",
  blogging: "Blogging & Web Culture",
  photography: "Photography",
  lifestyle: "Lifestyle & Style",
};

export function buildLinklogTagPrompt(entry) {
  const options = Object.entries(LINKLOG_TAG_LABELS)
    .map(([slug, label]) => `- ${slug}: ${label}`)
    .join("\n");

  return `Assign 1–2 topic tags to this link shared on rommy.blog's Sharing (linklog) section, from the fixed list below — do not invent new tags.

Link title: ${entry.title}
URL: ${entry.url}

Available tags (slug: label):
${options}

Rules:
- Pick 1 or 2 slugs from the list above that best fit the link
- Prefer 1 tag; use 2 only when the link genuinely spans two topics
- Respond with the exact slug strings shown, not the labels

Respond with ONLY valid JSON (no markdown, no explanation):
{"tags":["food"]}`;
}

export function parseLinklogTagResponse(text) {
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

  const valid = parsed.tags
    .map((t) => String(t || "").trim().toLowerCase())
    .filter((slug) => slug in LINKLOG_TAG_LABELS);

  const deduped = [...new Set(valid)].slice(0, 2);
  if (deduped.length === 0) {
    throw new Error("No valid tags in model response");
  }

  return deduped;
}
