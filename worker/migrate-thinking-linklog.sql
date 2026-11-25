-- A Sharing link is also published as a Thinking note (addSharingToThinking
-- in update-thinking.js). linklog_id ties the note to its link, so deleting
-- either deletes both, and a note posted in the same minute moves to the next
-- minute instead of overwriting the shared link. NULL for every other note.
ALTER TABLE thinking_posts ADD COLUMN linklog_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_thinking_posts_linklog_id ON thinking_posts (linklog_id);
