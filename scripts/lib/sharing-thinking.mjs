// A Sharing link is published to Thinking the same way it is published to
// Micro.blog, Bluesky and Mastodon: one post, with the same words, in one
// more place. handleSharing (worker/update-thinking.js) builds the text once
// with sharingPostText and sends it to all four.
//
// Imported by the Worker, so no Node built-ins here.

import { hashtagWordsForTags } from "./linklog-tags.mjs";
import { thinkingSlugFromDate } from "./thinking-slug.mjs";

/** "Title #tag #words\n\nurl" — the cross-post text, and the Thinking note's text. */
export function sharingPostText({ title, url, tags = [] }) {
  const hashtags = hashtagWordsForTags(tags)
    .map((w) => `#${w}`)
    .join(" ");
  return hashtags ? `${title} ${hashtags}\n\n${url}` : `${title}\n\n${url}`;
}

/**
 * Candidate Thinking slugs for a post made at `date`: its own minute first,
 * then each minute after. Slugs are per-minute (YYYY-MM-DD-HHMM, US Eastern),
 * so a link shared in the same minute as a note — or two links shared within
 * a minute — need the next free one rather than overwriting each other.
 */
export function thinkingSlugCandidates(date, count = 10) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(thinkingSlugFromDate(new Date(date.getTime() + i * 60_000)));
  return out;
}
