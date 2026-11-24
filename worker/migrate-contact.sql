-- Contact inbox (worker/contact.mjs). The Worker also creates these on first
-- use (ensureContactTables); this file is the same schema for a fresh database:
--   wrangler d1 execute rommy-blog-db --remote --file=migrate-contact.sql
CREATE TABLE IF NOT EXISTS contact_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'inbox',
  unread INTEGER NOT NULL DEFAULT 1,
  preview TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contact_threads_status ON contact_threads (status, updated_at);
CREATE INDEX IF NOT EXISTS contact_threads_email ON contact_threads (email, updated_at);
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  source TEXT NOT NULL,
  body TEXT NOT NULL,
  message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contact_messages_thread ON contact_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS contact_messages_mid ON contact_messages (message_id);
CREATE TABLE IF NOT EXISTS contact_rate_limit (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
