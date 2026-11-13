-- Where each Sharing link was cross-posted, so deleting the link
-- (delete-sharing) can delete those posts too. Rows from before this
-- migration stay NULL: their cross-posts were never recorded.
ALTER TABLE linklog ADD COLUMN microblog_url TEXT;
ALTER TABLE linklog ADD COLUMN bluesky_uri TEXT;
ALTER TABLE linklog ADD COLUMN mastodon_uri TEXT;
