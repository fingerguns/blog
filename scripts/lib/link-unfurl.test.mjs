// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LINK_UNFURL_USER_AGENT,
  UNFURL_FETCHER_CACHE_KEY,
  UNFURL_FETCHER_ID,
  fallbackUnfurlFromUrl,
  fetchLinkUnfurl,
  fetchLinkUnfurlResult,
  invalidateUnfurlMisses,
  isUnfurlMiss,
  knownSiteName,
  parseLinkUnfurl,
  unfurlCacheValue,
  unfurlHit,
} from "./link-unfurl.mjs";
import { thinkingUnfurlsHtml } from "./render/thinking.mjs";
import { renderLinklogArchiveItem } from "./render/lists.mjs";

const PAGE = "https://example.com/articles/one";

test("reads Open Graph title, image, description and site name", () => {
  const html = `<head>
    <meta property="og:title" content="A Title" />
    <meta property="og:image" content="/img/cover.jpg" />
    <meta property="og:description" content="About it." />
    <meta property="og:site_name" content="Example" />
  </head>`;
  assert.deepEqual(parseLinkUnfurl(html, PAGE), {
    title: "A Title",
    image: "https://example.com/img/cover.jpg",
    description: "About it.",
    siteName: "Example",
  });
});

test("an apostrophe inside a double-quoted value does not cut it short", () => {
  const html = `<meta property="og:title" content="Don't Look Up">`;
  assert.equal(parseLinkUnfurl(html, PAGE).title, "Don't Look Up");
});

test("content before property is read too", () => {
  const html = `<meta content='Reversed' name="twitter:title">`;
  assert.equal(parseLinkUnfurl(html, PAGE).title, "Reversed");
});

test("falls back to <title>, decoding entities", () => {
  const html = `<title>\n  Caf&#233; &amp; Bar &#x2014; Home\n</title>`;
  assert.equal(parseLinkUnfurl(html, PAGE).title, "Café & Bar — Home");
});

test("a non-http image is dropped", () => {
  const html = `<meta property="og:title" content="T"><meta property="og:image" content="javascript:alert(1)">`;
  assert.equal(parseLinkUnfurl(html, PAGE).image, null);
});

test("a page with nothing to show yields null", () => {
  assert.equal(parseLinkUnfurl("<html><body>hi</body></html>", PAGE), null);
});

test("reads a title with attributes on the tag, as NYTimes serves", () => {
  const html = `<title data-rh="true">Tech Billionaires Face Tricky Political Waters</title>
    <meta property="og:title" content="Tech Billionaires Face Tricky Political Waters After Democratic Midterm Sweep"/>
    <meta property="og:image" content="https://static01.nyt.com/images/cover.jpg"/>
    <meta property="og:description" content="Many donated money to President Trump’s favored causes."/>
    <meta property="og:site_name" content="The New York Times"/>`;
  const parsed = parseLinkUnfurl(html, "https://www.nytimes.com/article");
  assert.equal(
    parsed.title,
    "Tech Billionaires Face Tricky Political Waters After Democratic Midterm Sweep"
  );
  assert.equal(parsed.image, "https://static01.nyt.com/images/cover.jpg");
  assert.equal(parsed.siteName, "The New York Times");
});

test("invalidateUnfurlMisses drops false entries once per fetcher identity", () => {
  const cache = {
    "https://ok.example/": { title: "Ok" },
    "https://blocked.example/": false,
  };
  invalidateUnfurlMisses(cache);
  assert.deepEqual(cache["https://ok.example/"], { title: "Ok" });
  assert.equal("https://blocked.example/" in cache, false);
  assert.equal(cache[UNFURL_FETCHER_CACHE_KEY], UNFURL_FETCHER_ID);

  cache["https://blocked.example/"] = false;
  invalidateUnfurlMisses(cache);
  assert.equal(cache["https://blocked.example/"], false, "a later build must not keep retrying");
});

test("invalidateUnfurlMisses refetches misses after the fetcher identity changes", () => {
  const cache = {
    [UNFURL_FETCHER_CACHE_KEY]: "old-bot",
    "https://blocked.example/": false,
  };
  invalidateUnfurlMisses(cache, "new-bot");
  assert.equal("https://blocked.example/" in cache, false);
  assert.equal(cache[UNFURL_FETCHER_CACHE_KEY], "new-bot");
});

test("fetchLinkUnfurl sends the preview-crawler user-agent", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, ua: init.headers["user-agent"] });
    return {
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "",
    };
  };
  try {
    assert.equal(await fetchLinkUnfurl("https://www.nytimes.com/article"), null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].ua, LINK_UNFURL_USER_AGENT);
    assert.match(seen[0].ua, /Twitterbot/);
    assert.match(seen[0].ua, /fingergunsbot/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** Run `fn` with fetch answering `respond(url, init)`. */
async function withFetch(respond, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => respond(url, init);
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}
const page = (status, body = "", type = "text/html") => ({
  ok: status >= 200 && status < 300,
  status,
  url: "",
  headers: new Headers({ "content-type": type }),
  text: async () => body,
});

test("fetchLinkUnfurlResult names why there is no card", async () => {
  assert.deepEqual(await withFetch(() => page(403), () => fetchLinkUnfurlResult(PAGE)), { miss: "http-403" });
  assert.deepEqual(await withFetch(() => page(200, "%PDF", "application/pdf"), () => fetchLinkUnfurlResult(PAGE)), {
    miss: "not-html",
  });
  assert.deepEqual(await withFetch(() => page(200, "<html></html>"), () => fetchLinkUnfurlResult(PAGE)), {
    miss: "no-preview",
  });
  assert.deepEqual(
    await withFetch(
      () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
      () => fetchLinkUnfurlResult(PAGE)
    ),
    { miss: "timeout" }
  );
  assert.deepEqual(
    await withFetch(
      () => {
        throw new TypeError("fetch failed");
      },
      () => fetchLinkUnfurlResult(PAGE)
    ),
    { miss: "network" }
  );
  const ok = await withFetch(
    () => page(200, '<meta property="og:title" content="Hello">'),
    () => fetchLinkUnfurlResult(PAGE)
  );
  assert.equal(ok.unfurl.title, "Hello");
});

test("unfurlCacheValue stores a hit as-is and a miss with its reason", () => {
  const now = new Date("2026-11-07T18:50:02.000Z");
  assert.deepEqual(unfurlCacheValue({ unfurl: { title: "Hi" } }, now), { title: "Hi" });
  assert.deepEqual(unfurlCacheValue({ miss: "http-403" }, now), { miss: "http-403", at: "2026-11-07T18:50:02.000Z" });
});

test("old false and new { miss } entries are both misses", () => {
  assert.equal(isUnfurlMiss(false), true);
  assert.equal(isUnfurlMiss({ miss: "http-403" }), true);
  assert.equal(isUnfurlMiss({ title: "Hi" }), false);
  assert.equal(isUnfurlMiss(undefined), false);
  assert.equal(unfurlHit({ miss: "http-403" }), null);
  assert.equal(unfurlHit(false), null);
  assert.deepEqual(unfurlHit({ title: "Hi" }), { title: "Hi" });
});

test("invalidateUnfurlMisses drops reasoned misses too", () => {
  const cache = { [UNFURL_FETCHER_CACHE_KEY]: "old-bot", "https://blocked.example/": { miss: "http-403", at: "x" } };
  invalidateUnfurlMisses(cache, "new-bot");
  assert.equal("https://blocked.example/" in cache, false);
});

test("fallbackUnfurlFromUrl rebuilds a title from a readable slug", () => {
  assert.deepEqual(
    fallbackUnfurlFromUrl(
      "https://www.reuters.com/world/trump-orders-doj-look-into-democrats-threatening-people-2026-11-07/"
    ),
    {
      title: "Trump orders DOJ look into democrats threatening people",
      image: null,
      description: null,
      siteName: "Reuters",
      fallback: true,
    }
  );
  assert.equal(
    fallbackUnfurlFromUrl("https://www.reuters.com/business/media-telecom/galliano-met-call-off-2027-exhibition-following-backlash-2026-08-31")
      .title,
    "Galliano met call off 2027 exhibition following backlash"
  );
  assert.equal(fallbackUnfurlFromUrl("https://example.org/blog/why-tea-is-better.html").siteName, "example.org");
  assert.equal(fallbackUnfurlFromUrl("https://example.org/blog/why-tea-is-better.html").title, "Why tea is better");
});

test("fallbackUnfurlFromUrl gives up on slugs that are not words", () => {
  for (const url of [
    "https://example.com/",
    "https://example.com/p/8f3a9c2e7b1d",
    "https://example.com/watch?v=abc",
    "https://example.com/2026/11/07/",
    "https://example.com/a-b",
    "https://example.com/x7f-q9z-k2m-p4r",
    "not a url",
  ]) {
    assert.equal(fallbackUnfurlFromUrl(url), null, url);
  }
});

test("knownSiteName matches subdomains of known publications only", () => {
  assert.equal(knownSiteName("https://www.nytimes.com/x"), "The New York Times");
  assert.equal(knownSiteName("https://cooking.nytimes.com/x"), "The New York Times");
  assert.equal(knownSiteName("https://notnytimes.com/x"), null);
});

const REUTERS = "https://www.reuters.com/world/trump-orders-doj-look-into-democrats-threatening-people-2026-11-07/";

test("a Thinking note gets a fallback card for a blocked link, and none for an unfetched one", () => {
  const text = `Loser shit.\n\n${REUTERS}`;
  for (const miss of [false, { miss: "http-403", at: "x" }]) {
    const html = thinkingUnfurlsHtml(text, { thinkingUnfurls: { [REUTERS]: miss } });
    assert.match(html, /class="linklog-card-meta">Reuters</);
    assert.match(html, /class="linklog-card-title">Trump orders DOJ look into democrats threatening people</);
    assert.doesNotMatch(html, /linklog-card-thumb/);
  }
  assert.equal(thinkingUnfurlsHtml(text, { thinkingUnfurls: {} }), "");
});

test("a Sharing card for a blocked link keeps its title and names the publication", () => {
  const l = { url: REUTERS, title: "DOJ story", datetime: "2026-11-07T18:50:00Z", tags: [] };
  for (const miss of [false, { miss: "http-403", at: "x" }, null]) {
    const html = renderLinklogArchiveItem(l, miss);
    assert.match(html, / · Reuters</);
    assert.match(html, /linklog-card-title">DOJ story</);
  }
});

test("fallbackUnfurlFromUrl rejoins contractions a slug split apart", () => {
  assert.equal(
    fallbackUnfurlFromUrl(
      "https://www.bloomberg.com/news/articles/2026-11-12/microsoft-says-it-s-working-to-fix-outlook-copilot-outage?srnd=homepage-americas"
    ).title,
    "Microsoft says it’s working to fix outlook copilot outage"
  );
  assert.equal(
    fallbackUnfurlFromUrl("https://example.com/news/we-don-t-know-why-the-uk-s-plan-failed").title,
    "We don’t know why the UK’s plan failed"
  );
  assert.equal(
    fallbackUnfurlFromUrl("https://example.com/health/why-vitamin-d-matters-more-now").title,
    "Why vitamin d matters more now"
  );
});
