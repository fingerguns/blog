import { getToken, isShareable, shareLink, warningsOf } from "./api.js";

const form = document.getElementById("form");
const titleInput = document.getElementById("title");
const urlLine = document.getElementById("url");
const shareBtn = document.getElementById("share");
const status = document.getElementById("status");

function show(kind, build) {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.replaceChildren();
  build(status);
}

function text(parent, tag, value, className) {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
}

function showError(message, withOptionsLink = false) {
  show("bad", (s) => {
    text(s, "span", message);
    if (withOptionsLink) {
      s.append(" ");
      const a = text(s, "a", "Open options");
      a.href = "#";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }
  });
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const pageUrl = tab?.url || "";

if (!(await getToken())) {
  showError("Add your share token first.", true);
} else if (!isShareable(pageUrl)) {
  showError("This page can't be shared — only web pages (http or https) can.");
} else {
  form.hidden = false;
  titleInput.value = (tab.title || "").trim();
  urlLine.textContent = pageUrl;
  urlLine.title = pageUrl;
  titleInput.focus();
  titleInput.select();
}

// Enter shares; Shift+Enter adds a line break to the title.
titleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  shareBtn.disabled = true;
  shareBtn.textContent = "Sharing…";
  status.hidden = true;
  try {
    const result = await shareLink(pageUrl, titleInput.value);
    const warnings = warningsOf(result);
    form.hidden = true;
    show(warnings.length ? "bad" : "ok", (s) => {
      const done = document.createElement("div");
      done.className = "done";
      text(done, "strong", "✓ Shared to rommy.blog");
      if (result.entry?.title) text(done, "span", result.entry.title);
      if (Array.isArray(result.tags) && result.tags.length) {
        text(done, "span", result.tags.map((t) => `#${t}`).join(" "), "tags");
      }
      s.appendChild(done);
      if (warnings.length) {
        text(s, "p", "Some cross-posts didn't go out:");
        const ul = document.createElement("ul");
        for (const w of warnings) text(ul, "li", w);
        s.appendChild(ul);
      }
    });
    // A clean share closes itself; one with warnings stays to be read.
    if (!warnings.length) setTimeout(() => window.close(), 1600);
  } catch (err) {
    shareBtn.disabled = false;
    shareBtn.textContent = "Share";
    showError(err.message, /token/i.test(err.message));
  }
});
