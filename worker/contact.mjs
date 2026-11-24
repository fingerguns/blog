// The Contact inbox: the /contact/ form posts here instead of to a form
// service, messages live in D1, /admin/inbox lists them, and replies go out
// from me@rommy.blog through Cloudflare Email Sending (the EMAIL binding).
// When someone answers one of those replies, Email Routing hands the email
// to this Worker's email() handler and it joins the same conversation.
//
//   contact_threads   one per conversation (one person, one subject)
//   contact_messages  each message in it, in ("in") or out ("out")
//
// No auto-reply ever goes to the address someone typed into the form: that
// would let anyone use the form to send mail from rommy.blog to a stranger.

import PostalMime from "postal-mime";
import {
  CONTACT_FROM,
  cleanMessageId,
  isPlausibleEmail,
  replySubject,
  replyText,
  stripQuotedReply,
  validateContactSubmission,
} from "../scripts/lib/contact.mjs";
import { escHtml } from "../scripts/lib/html.mjs";
import { JOB_STATUS, recordJobRun } from "./job-runs.mjs";

const FROM_NAME = "Rommy Ghaly";
const STATUSES = ["inbox", "archived", "spam"];
const RATE_WINDOW_SEC = 60 * 60;
const RATE_MAX_PER_WINDOW = 5;
const DAILY_MAX = 200; // across everyone: a flood stops here, not in the inbox
const MAX_BODY_BYTES = 32 * 1024;
const MAX_INBOUND_BYTES = 5 * 1024 * 1024;
const MAX_STORED_BODY = 20000;
const JOB = "contact-email";

let tablesReady = false;

export async function ensureContactTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS contact_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',
      unread INTEGER NOT NULL DEFAULT 1,
      preview TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS contact_threads_status ON contact_threads (status, updated_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS contact_threads_email ON contact_threads (email, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      source TEXT NOT NULL,
      body TEXT NOT NULL,
      message_id TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS contact_messages_thread ON contact_messages (thread_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS contact_messages_mid ON contact_messages (message_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS contact_rate_limit (
      ip TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_start INTEGER NOT NULL
    )`),
  ]);
  tablesReady = true;
}

const nowIso = () => new Date().toISOString();
const previewOf = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);

function jsonResponse(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

// ─── Public form ──────────────────────────────────────────────────────────────

/** True when this IP may submit again; counts the attempt either way. */
async function allowSubmission(db, ip) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare("SELECT count, window_start FROM contact_rate_limit WHERE ip = ?")
    .bind(ip)
    .first();
  if (!row || now - row.window_start > RATE_WINDOW_SEC) {
    await db
      .prepare(
        `INSERT INTO contact_rate_limit (ip, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = excluded.window_start`
      )
      .bind(ip, now)
      .run();
    return true;
  }
  if (row.count >= RATE_MAX_PER_WINDOW) return false;
  await db.prepare("UPDATE contact_rate_limit SET count = count + 1 WHERE ip = ?").bind(ip).run();
  return true;
}

async function underDailyCap(db) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE direction = 'in' AND created_at > ?")
    .bind(since)
    .first();
  return (row?.n || 0) < DAILY_MAX;
}

/** POST /api/contact — the /contact/ page's form. */
export async function handleContactSubmit(request, env, ctx, clientIp) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!env.DB) return jsonResponse({ error: "Not configured" }, 500);

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return jsonResponse({ error: "That message is too long." }, 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: "That message is too long." }, 413);
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const result = validateContactSubmission(body);
  // A bot gets the same answer a person does, so it learns nothing.
  if (!result.ok && result.spam) return jsonResponse({ ok: true });
  if (!result.ok) return jsonResponse({ error: result.error }, 400);

  const db = env.DB;
  await ensureContactTables(db);
  if (!(await allowSubmission(db, clientIp || "unknown"))) {
    return jsonResponse(
      { error: "Too many messages from here for now. Please try again in an hour." },
      429,
      { "Retry-After": String(RATE_WINDOW_SEC) }
    );
  }
  if (!(await underDailyCap(db))) {
    return jsonResponse({ error: "The inbox is full for today. Please try again tomorrow." }, 429);
  }

  const at = nowIso();
  const thread = await db
    .prepare(
      `INSERT INTO contact_threads (name, email, subject, status, unread, preview, created_at, updated_at)
       VALUES (?, ?, NULL, 'inbox', 1, ?, ?, ?) RETURNING id`
    )
    .bind(result.name, result.email, previewOf(result.message), at, at)
    .first();
  await db
    .prepare(
      `INSERT INTO contact_messages (thread_id, direction, source, body, message_id, created_at)
       VALUES (?, 'in', 'form', ?, NULL, ?)`
    )
    .bind(thread.id, result.message, at)
    .run();

  ctx?.waitUntil?.(notifyNewMessage(env, { name: result.name, preview: previewOf(result.message) }));
  return jsonResponse({ ok: true });
}

/**
 * An optional heads-up for a new message, sent to CONTACT_NOTIFY_TO (a
 * secret, so the address stays out of this public repo). It names who wrote
 * and links to the inbox; the message itself stays in the admin.
 */
async function notifyNewMessage(env, { name, preview }) {
  if (!env.EMAIL || !env.CONTACT_NOTIFY_TO) return;
  try {
    await env.EMAIL.send({
      from: { email: CONTACT_FROM, name: "rommy.blog" },
      to: env.CONTACT_NOTIFY_TO,
      subject: `New message from ${name}`.slice(0, 200),
      text: `${name} wrote: “${preview}…”\n\nRead and reply: https://rommy.blog/admin/inbox`,
      html: `<p>${escHtml(name)} wrote: “${escHtml(preview)}…”</p><p><a href="https://rommy.blog/admin/inbox">Read and reply</a></p>`,
    });
  } catch (err) {
    await recordJobRun(env.DB, { job: JOB, status: JOB_STATUS.FAILED, context: "notify", detail: errorDetail(err) });
  }
}

function errorDetail(err) {
  return [err?.code, err?.message || String(err)].filter(Boolean).join(": ");
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export const CONTACT_ACTIONS = new Set([
  "contact-list",
  "contact-thread",
  "contact-reply",
  "contact-status",
  "contact-delete",
]);

/** Runs one /admin/ inbox action (already authenticated). Returns { status, data }. */
export async function handleContactAdmin(action, payload, env) {
  const db = env.DB;
  await ensureContactTables(db);

  if (action === "contact-list") {
    const status = STATUSES.includes(payload.status) ? payload.status : "inbox";
    const { results } = await db
      .prepare(
        `SELECT t.id, t.name, t.email, t.subject, t.status, t.unread, t.preview, t.created_at, t.updated_at,
                (SELECT COUNT(*) FROM contact_messages m WHERE m.thread_id = t.id) AS messages,
                (SELECT m.direction FROM contact_messages m WHERE m.thread_id = t.id
                  ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_direction
         FROM contact_threads t WHERE t.status = ? ORDER BY t.updated_at DESC LIMIT 200`
      )
      .bind(status)
      .all();
    const counts = await db
      .prepare(
        `SELECT status, COUNT(*) AS n, SUM(unread) AS unread FROM contact_threads GROUP BY status`
      )
      .all();
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, { total: 0, unread: 0 }]));
    for (const row of counts.results || []) {
      if (byStatus[row.status]) byStatus[row.status] = { total: row.n, unread: row.unread || 0 };
    }
    return {
      status: 200,
      data: { ok: true, threads: results || [], counts: byStatus, canReply: Boolean(env.EMAIL) },
    };
  }

  const id = Number(payload.id);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, data: { error: "Missing conversation id" } };
  const thread = await db.prepare("SELECT * FROM contact_threads WHERE id = ?").bind(id).first();
  if (!thread) return { status: 404, data: { error: "That conversation no longer exists." } };

  if (action === "contact-thread") {
    const { results } = await db
      .prepare(
        `SELECT id, direction, source, body, created_at FROM contact_messages
         WHERE thread_id = ? ORDER BY created_at ASC, id ASC`
      )
      .bind(id)
      .all();
    if (thread.unread) {
      await db.prepare("UPDATE contact_threads SET unread = 0 WHERE id = ?").bind(id).run();
    }
    return { status: 200, data: { ok: true, thread: { ...thread, unread: 0 }, messages: results || [] } };
  }

  if (action === "contact-status") {
    const status = payload.status;
    if (status === "unread") {
      await db.prepare("UPDATE contact_threads SET unread = 1 WHERE id = ?").bind(id).run();
      return { status: 200, data: { ok: true } };
    }
    if (!STATUSES.includes(status)) return { status: 400, data: { error: "Unknown status" } };
    await db.prepare("UPDATE contact_threads SET status = ? WHERE id = ?").bind(status, id).run();
    return { status: 200, data: { ok: true } };
  }

  if (action === "contact-delete") {
    await db.batch([
      db.prepare("DELETE FROM contact_messages WHERE thread_id = ?").bind(id),
      db.prepare("DELETE FROM contact_threads WHERE id = ?").bind(id),
    ]);
    return { status: 200, data: { ok: true } };
  }

  if (action === "contact-reply") {
    return sendReply(env, thread, payload.body);
  }

  return { status: 400, data: { error: "Unknown action" } };
}

async function sendReply(env, thread, rawBody) {
  const db = env.DB;
  const body = typeof rawBody === "string" ? rawBody.replace(/\r\n?/g, "\n").trim() : "";
  if (!body) return { status: 400, data: { error: "Write a reply first." } };
  if (body.length > MAX_STORED_BODY) return { status: 400, data: { error: "That reply is too long." } };
  if (!env.EMAIL) {
    return {
      status: 500,
      data: { error: "Email sending isn't set up yet: the Worker has no EMAIL binding." },
    };
  }
  if (!isPlausibleEmail(thread.email)) {
    return { status: 400, data: { error: "This conversation has no usable email address." } };
  }

  // Quote the latest message from them, and thread under it when it came by
  // email (form messages have no Message-ID to point at).
  const lastIn = await db
    .prepare(
      `SELECT body, message_id, created_at FROM contact_messages
       WHERE thread_id = ? AND direction = 'in' ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .bind(thread.id)
    .first();
  const { results: ids } = await db
    .prepare(
      `SELECT message_id FROM contact_messages WHERE thread_id = ? AND message_id IS NOT NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(thread.id)
    .all();
  const references = (ids || []).map((r) => cleanMessageId(r.message_id)).filter(Boolean).slice(-10);
  const headers = {};
  const inReplyTo = cleanMessageId(lastIn?.message_id);
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references.length) headers.References = references.join(" ");

  const when = lastIn?.created_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(lastIn.created_at))
    : null;
  const text = replyText(body, lastIn ? { body: lastIn.body, name: thread.name, when } : null);
  const html = text
    .split("\n")
    .map((line) => (line.startsWith(">") ? `<span style="color:#777">${escHtml(line)}</span>` : escHtml(line)))
    .join("<br>\n");

  let sent;
  try {
    sent = await env.EMAIL.send({
      from: { email: CONTACT_FROM, name: FROM_NAME },
      to: { email: thread.email, name: thread.name },
      subject: replySubject(thread.subject),
      text,
      html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">${html}</div>`,
      headers,
    });
  } catch (err) {
    await recordJobRun(db, { job: JOB, status: JOB_STATUS.FAILED, context: `reply:${thread.id}`, detail: errorDetail(err) });
    return { status: 502, data: { error: `The reply wasn't sent. ${errorDetail(err)}` } };
  }

  const at = nowIso();
  // Email Sending returns its own id; when it is a Message-ID, store it so
  // their answer can be matched back by In-Reply-To.
  const sentId = sent?.messageId ? String(sent.messageId) : "";
  const messageId = cleanMessageId(sentId) || cleanMessageId(`<${sentId}>`);
  await db.batch([
    db
      .prepare(
        `INSERT INTO contact_messages (thread_id, direction, source, body, message_id, created_at)
         VALUES (?, 'out', 'admin', ?, ?, ?)`
      )
      .bind(thread.id, body, messageId, at),
    db
      .prepare("UPDATE contact_threads SET updated_at = ?, preview = ?, unread = 0 WHERE id = ?")
      .bind(at, previewOf(`You: ${body}`), thread.id),
  ]);
  await recordJobRun(db, { job: JOB, status: JOB_STATUS.OK, context: `reply:${thread.id}` });
  return { status: 200, data: { ok: true } };
}

// ─── Incoming email (Email Routing → this Worker) ──────────────────────────────

/** Finds the conversation an emailed reply belongs to, or null for a new one. */
async function findThreadFor(db, sender, threadIds) {
  for (const mid of threadIds) {
    const row = await db
      .prepare("SELECT thread_id FROM contact_messages WHERE message_id = ? LIMIT 1")
      .bind(mid)
      .first();
    if (row) return row.thread_id;
  }
  // No header match (Email Sending's ids aren't always the Message-ID the
  // recipient sees): fall back to the newest conversation with this person.
  const row = await db
    .prepare("SELECT id FROM contact_threads WHERE email = ? AND status != 'spam' ORDER BY updated_at DESC LIMIT 1")
    .bind(sender)
    .first();
  return row ? row.id : null;
}

function senderName(parsed, fallback) {
  const n = parsed?.from?.name ? String(parsed.from.name).replace(/\s+/g, " ").trim() : "";
  return (n || fallback).slice(0, 200);
}

export async function handleInboundEmail(message, env) {
  const to = String(message.to || "").toLowerCase();
  if (to !== CONTACT_FROM) {
    message.setReject("Unknown address");
    return;
  }
  if (message.rawSize > MAX_INBOUND_BYTES) {
    message.setReject("Message too large");
    return;
  }
  const db = env.DB;
  await ensureContactTables(db);

  // The envelope sender is what Cloudflare verified; header From can be forged.
  const sender = String(message.from || "").toLowerCase();
  const raw = await new Response(message.raw).arrayBuffer();
  let parsed;
  try {
    parsed = await PostalMime.parse(raw);
  } catch (err) {
    await recordJobRun(db, { job: JOB, status: JOB_STATUS.FAILED, context: "inbound", detail: errorDetail(err) });
    message.setReject("Could not read message");
    return;
  }

  const text = parsed.text || (parsed.html ? parsed.html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "") : "");
  const body = stripQuotedReply(text).slice(0, MAX_STORED_BODY) || "(empty message)";
  const messageId = cleanMessageId(message.headers.get("message-id"));
  const threadIds = [
    message.headers.get("in-reply-to"),
    ...String(message.headers.get("references") || "").split(/\s+/).reverse(),
  ]
    .map(cleanMessageId)
    .filter(Boolean);

  if (messageId) {
    const dup = await db.prepare("SELECT id FROM contact_messages WHERE message_id = ?").bind(messageId).first();
    if (dup) return; // a redelivery
  }

  const at = nowIso();
  let threadId = await findThreadFor(db, sender, threadIds);
  if (threadId) {
    await db
      .prepare("UPDATE contact_threads SET updated_at = ?, preview = ?, unread = 1, status = CASE WHEN status = 'spam' THEN status ELSE 'inbox' END WHERE id = ?")
      .bind(at, previewOf(body), threadId)
      .run();
  } else {
    const subject = String(parsed.subject || "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
    const row = await db
      .prepare(
        `INSERT INTO contact_threads (name, email, subject, status, unread, preview, created_at, updated_at)
         VALUES (?, ?, ?, 'inbox', 1, ?, ?, ?) RETURNING id`
      )
      .bind(senderName(parsed, sender), sender, subject, previewOf(body), at, at)
      .first();
    threadId = row.id;
  }
  await db
    .prepare(
      `INSERT INTO contact_messages (thread_id, direction, source, body, message_id, created_at)
       VALUES (?, 'in', 'email', ?, ?, ?)`
    )
    .bind(threadId, body, messageId, at)
    .run();

  await notifyNewMessage(env, { name: senderName(parsed, sender), preview: previewOf(body) });
}
