// The Contact inbox's pure helpers: checking a form submission, and turning
// an emailed reply into just the new text. No Node built-ins: the Worker
// (worker/contact.mjs) imports this.

export const CONTACT_LIMITS = {
  name: 200,
  email: 254,
  message: 10000,
};

/** The address every reply is sent from, and the one Email Routing hands the Worker. */
export const CONTACT_FROM = "me@rommy.blog";

// Deliberately loose: one @, a dot in the domain, no spaces or angle
// brackets. Real validation is whether the reply arrives.
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export function isPlausibleEmail(s) {
  return typeof s === "string" && s.length <= CONTACT_LIMITS.email && EMAIL_RE.test(s);
}

/** Collapses a single-line field: no control characters, no line breaks. */
function oneLine(s) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Keeps line breaks but drops other control characters. */
function multiLine(s) {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * Checks a Contact form submission. Returns { ok: true, name, email, message }
 * or { ok: false, error, spam }. `spam` marks a bot (honeypot filled, or
 * submitted faster than a person can type) so the caller can pretend it
 * worked instead of teaching the bot what tripped.
 */
export function validateContactSubmission(input, { minElapsedMs = 3000 } = {}) {
  const body = input && typeof input === "object" ? input : {};
  if (oneLine(body.website)) return { ok: false, error: "Rejected", spam: true };
  const elapsed = Number(body.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < minElapsedMs) {
    return { ok: false, error: "Rejected", spam: true };
  }

  const name = oneLine(body.name);
  const email = oneLine(body.email).toLowerCase();
  const message = multiLine(body.message);
  if (!name) return { ok: false, error: "Please add your name." };
  if (name.length > CONTACT_LIMITS.name) return { ok: false, error: "That name is too long." };
  if (!isPlausibleEmail(email)) return { ok: false, error: "Please check your email address." };
  if (!message) return { ok: false, error: "Please write a message." };
  if (message.length > CONTACT_LIMITS.message) {
    return { ok: false, error: `Messages are limited to ${CONTACT_LIMITS.message.toLocaleString("en-US")} characters.` };
  }
  return { ok: true, name, email, message };
}

// Where a mail client starts quoting the message being replied to. Gmail
// wraps its "On … wrote:" line when it is long, so the pattern allows the
// "wrote:" to land on the next line.
const QUOTE_HEADERS = [
  /^On .{4,400}?(?:\n.{0,200}?)?wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^_{10,}\s*$/m,
  /^From:\s.+\n(?:Sent|Date):\s.+$/m,
  /^Le .{4,400}?a écrit\s*:\s*$/m,
  /^Am .{4,400}?schrieb .{0,200}:\s*$/m,
];

/**
 * The new part of an emailed reply: the quoted earlier message and the
 * signature delimiter are cut off. Falls back to the whole text if cutting
 * would leave nothing.
 */
export function stripQuotedReply(text) {
  const full = multiLine(text);
  let cut = full.length;
  for (const re of QUOTE_HEADERS) {
    const m = re.exec(full);
    if (m && m.index < cut) cut = m.index;
  }
  let body = full.slice(0, cut);
  // A bare "-- " line starts a signature (RFC 3676).
  const sig = /^-- ?$/m.exec(body);
  if (sig) body = body.slice(0, sig.index);
  // Trailing "> " lines are quoting with no header above them.
  const lines = body.split("\n");
  while (lines.length && (/^\s*>/.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  body = lines.join("\n").trim();
  return body || full;
}

/** "Re: …" once, however many times the subject has already been replied to. */
export function replySubject(subject) {
  const s = oneLine(subject).replace(/^(?:(?:re|aw|sv|fwd?)\s*:\s*)+/i, "");
  return `Re: ${s || "Your message on rommy.blog"}`.slice(0, 900);
}

/** A reply's plain text with the message it answers quoted beneath it. */
export function replyText(body, quoted) {
  const reply = multiLine(body);
  if (!quoted || !quoted.body) return reply;
  const when = quoted.when ? `On ${quoted.when}, ` : "";
  const who = quoted.name ? `${quoted.name} wrote:` : "you wrote:";
  const lines = multiLine(quoted.body).split("\n").map((l) => (l ? `> ${l}` : ">"));
  return `${reply}\n\n${when}${who}\n${lines.join("\n")}`;
}

/** A Message-ID header value, or null when it isn't one ("<…@…>"). */
export function cleanMessageId(value) {
  const s = oneLine(value);
  return /^<[^<>\s]+@[^<>\s]+>$/.test(s) && s.length <= 500 ? s : null;
}
