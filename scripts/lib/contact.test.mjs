// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cleanMessageId,
  isPlausibleEmail,
  replySubject,
  replyText,
  stripQuotedReply,
  validateContactSubmission,
} from "./contact.mjs";

const ok = { name: "Ada Lovelace", email: "Ada@Example.com", message: "Hello there.", elapsed_ms: 12000 };

test("a normal submission is cleaned and accepted", () => {
  const r = validateContactSubmission({ ...ok, name: "  Ada\r\nLovelace ", message: "Line one\r\nLine two\n\n\n\n\nEnd" });
  assert.deepEqual(r, { ok: true, name: "Ada Lovelace", email: "ada@example.com", message: "Line one\nLine two\n\n\nEnd" });
});

test("a filled honeypot or a too-fast submit is flagged as spam", () => {
  assert.equal(validateContactSubmission({ ...ok, website: "http://spam.example" }).spam, true);
  assert.equal(validateContactSubmission({ ...ok, elapsed_ms: 400 }).spam, true);
  // No timing sent at all (an old cached page) is not held against anyone.
  assert.equal(validateContactSubmission({ ...ok, elapsed_ms: undefined }).ok, true);
});

test("missing or bad fields get a message a person can act on", () => {
  assert.match(validateContactSubmission({ ...ok, name: "" }).error, /name/);
  assert.match(validateContactSubmission({ ...ok, email: "nope" }).error, /email/);
  assert.match(validateContactSubmission({ ...ok, email: "a@b.com\r\nBcc: x@y.com" }).error, /email/);
  assert.match(validateContactSubmission({ ...ok, message: "   " }).error, /message/);
  assert.match(validateContactSubmission({ ...ok, message: "x".repeat(10001) }).error, /10,000/);
  assert.equal(validateContactSubmission(null).ok, false);
});

test("isPlausibleEmail", () => {
  assert.equal(isPlausibleEmail("me@rommy.blog"), true);
  assert.equal(isPlausibleEmail("a b@c.com"), false);
  assert.equal(isPlausibleEmail("<a@c.com>"), false);
  assert.equal(isPlausibleEmail("a@localhost"), false);
});

test("stripQuotedReply keeps only the new text of an emailed reply", () => {
  const gmail = "Thanks, that helps!\n\nOn Mon, Nov 24, 2026 at 9:02 AM Rommy Ghaly <me@rommy.blog>\nwrote:\n> Here is the answer.\n> Bye";
  assert.equal(stripQuotedReply(gmail), "Thanks, that helps!");
  const apple = "Sounds good.\n\nOn Nov 24, 2026, at 9:02 AM, Rommy Ghaly <me@rommy.blog> wrote:\n\n> Here";
  assert.equal(stripQuotedReply(apple), "Sounds good.");
  const outlook = "Great.\n\nFrom: Rommy Ghaly <me@rommy.blog>\nSent: Monday\nTo: Ada";
  assert.equal(stripQuotedReply(outlook), "Great.");
  assert.equal(stripQuotedReply("Cheers\n-- \nAda\nSent from my phone"), "Cheers");
  assert.equal(stripQuotedReply("Plain note\n> quoted tail\n>"), "Plain note");
  // Nothing new above the quote: keep everything rather than store nothing.
  assert.equal(stripQuotedReply("> only quote"), "> only quote");
});

test("replySubject adds one Re:", () => {
  assert.equal(replySubject(null), "Re: Your message on rommy.blog");
  assert.equal(replySubject("Re: RE: Fwd: Hello"), "Re: Hello");
  assert.equal(replySubject("Hi\r\nBcc: x"), "Re: Hi Bcc: x");
});

test("replyText quotes the message it answers", () => {
  assert.equal(replyText("Thanks!", null), "Thanks!");
  assert.equal(
    replyText("Thanks!", { body: "Hello\n\nThere", name: "Ada", when: "Nov 24, 2026, 9:00 AM" }),
    "Thanks!\n\nOn Nov 24, 2026, 9:00 AM, Ada wrote:\n> Hello\n>\n> There"
  );
});

test("cleanMessageId accepts only <local@domain>", () => {
  assert.equal(cleanMessageId(" <abc.123@mail.example> "), "<abc.123@mail.example>");
  assert.equal(cleanMessageId("abc@mail.example"), null);
  assert.equal(cleanMessageId("<abc>"), null);
  assert.equal(cleanMessageId(null), null);
});
