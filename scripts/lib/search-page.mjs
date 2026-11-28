/**
 * Browser entry point for /search/. Copied to dist/search.js at build time.
 *
 * The import specifier below is the name search.mjs takes in dist/, not its
 * name here — this file is only ever executed by the browser, never imported
 * by Node, so that specifier is resolved against dist/ and nothing else. The
 * matching logic itself lives in search.mjs and is covered by `npm test`.
 */

import { search, tokenize, excerpt, KIND_LABELS } from "./search-core.js";
// render/format.mjs in the repo; copied to dist/date-format.js beside this file.
import { dayMonthYearFromIsoDay, formatMbDate, formatMonthYear } from "./date-format.js";

const input = document.getElementById("search-input");
const status = document.getElementById("search-status");
const results = document.getElementById("search-results");
const form = document.getElementById("search-form");

let docs = null;
let loadError = null;

function setStatus(message) {
  status.textContent = message;
}

// Each kind's date as its own section shows it (scripts/lib/render/format.mjs):
// Thinking "27 Nov 2026 // 21:10", Writing and Sharing "21 Nov 2026", Reading and
// Must Reads "Nov 2026".
function formatDate(iso, kind) {
  if (!iso) return "";
  if (kind === "reading" || kind === "must-read") return formatMonthYear(iso);
  if (/^\d{4}-\d{2}$/.test(String(iso))) return formatMonthYear(iso);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  if (kind === "thinking") return formatMbDate(iso);
  return dayMonthYearFromIsoDay(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d));
}

/** Wrap matched terms in <mark>, escaping everything else. */
function highlight(text, terms) {
  const escaped = text.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );
  if (terms.length === 0) return escaped;
  const pattern = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");
  return escaped.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

function render(query) {
  results.innerHTML = "";

  if (loadError) {
    setStatus(loadError);
    return;
  }
  if (!docs) {
    setStatus("Loading…");
    return;
  }
  if (!query.trim()) {
    setStatus(`${docs.length} items indexed. Type to search.`);
    return;
  }

  const terms = tokenize(query);
  const hits = search(docs, query);

  if (hits.length === 0) {
    setStatus(`No matches for “${query}”.`);
    return;
  }
  setStatus(`${hits.length}${hits.length === 50 ? "+" : ""} match${hits.length === 1 ? "" : "es"}`);

  const frag = document.createDocumentFragment();
  for (const { doc } of hits) {
    const li = document.createElement("li");
    li.className = "search-result";

    const external = /^https?:\/\//.test(doc.u);
    const title = doc.t || excerpt(doc, terms, { radius: 40 }) || "(untitled)";
    const snippet = doc.t ? excerpt(doc, terms) : "";

    li.innerHTML =
      `<a class="search-result-title" href="${doc.u}"` +
      (external ? ' target="_blank" rel="noopener"' : "") +
      `>${highlight(title, terms)}</a>` +
      `<span class="search-result-meta">` +
      `<span class="search-kind">${KIND_LABELS[doc.k] || doc.k}</span>` +
      (doc.d ? `<time>${formatDate(doc.d, doc.k)}</time>` : "") +
      `</span>` +
      (snippet ? `<p class="search-result-snippet">${highlight(snippet, terms)}</p>` : "");

    frag.appendChild(li);
  }
  results.appendChild(frag);
}

/** Keep ?q= in the URL so a search can be linked or reloaded. */
function syncUrl(query) {
  const url = new URL(window.location.href);
  if (query.trim()) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  window.history.replaceState(null, "", url);
}

let debounce;
input.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    render(input.value);
    syncUrl(input.value);
  }, 120);
});

// Enter should not navigate — results are already live.
form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(debounce);
  render(input.value);
  syncUrl(input.value);
});

// "/" focuses the box, the way most search UIs behave.
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
    input.select();
  }
});

setStatus("Loading…");

fetch("/search-index.json")
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then((data) => {
    docs = data;
    const initial = new URL(window.location.href).searchParams.get("q") || "";
    if (initial) input.value = initial;
    render(input.value);
    input.focus();
  })
  .catch((err) => {
    loadError = `Could not load the search index (${err.message}).`;
    render(input.value);
  });
