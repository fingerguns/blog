/**
 * Rebuilds index.html, feed.xml, robots.txt, sitemap.xml, and post pages.
 * Reads content from Cloudflare D1 when configured, else data/posts.json.
 * Run from project root: node scripts/build.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { d1Configured, loadBlogDataFromD1 } from "./d1-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let data;
if (d1Configured()) {
  console.log("Loading content from D1…");
  data = await loadBlogDataFromD1();
} else {
  console.log("D1 not configured — loading data/posts.json");
  data = JSON.parse(readFileSync(join(root, "data/posts.json"), "utf8"));
}

const { site, thinking, posts, reading, linklog, links, optionalColophon } = data;

const base = site.url.replace(/\/$/, "");
const toSortableMs = (p) => {
  // Prefer full datetime for same-day ordering; fall back to date at noon UTC.
  const dt = p.datetime ? new Date(p.datetime) : new Date(`${p.date}T12:00:00.000Z`);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const sortDesc = (a, b) => {
  const aMs = toSortableMs(a);
  const bMs = toSortableMs(b);
  if (aMs !== bMs) return bMs - aMs; // newest first

  // deterministic tie-break
  return String(a.slug || "").localeCompare(String(b.slug || ""));
};
const ordered = [...posts].sort(sortDesc);

function escXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const GA_ID = "G-L1CC5F3DP8";
const gaSnippet = `    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;

const portraitPhotoToggleScript = `    <script>(function(){function init(){document.querySelectorAll(".microblog-body img, .post .body img").forEach(function(img){if(img.dataset.portraitInit)return;function setup(){var w=img.naturalWidth,h=img.naturalHeight;if(!w||!h)return;img.dataset.portraitInit="1";if(h<=w)return;img.classList.add("photo-portrait");img.setAttribute("role","button");img.setAttribute("tabindex","0");img.setAttribute("aria-expanded","false");img.title="Click to enlarge";function toggle(){var ex=img.classList.toggle("photo-expanded");img.setAttribute("aria-expanded",ex?"true":"false");}img.addEventListener("click",toggle);img.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();}});}if(img.complete)setup();else img.addEventListener("load",setup,{once:true});});}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();}());</script>`;

const thinkingAdminDeleteScript = `    <script>(function(){
      var API_URL=(function(){var h=location.hostname;if(h==="localhost"||h==="127.0.0.1")return"https://rommy-blog-admin.fingerguns.workers.dev";return"/api/admin";})();
      var SESSION_KEY="admin_session";
      var SESSION_TTL=${30 * 24 * 60 * 60 * 1000};
      function loadPw(){
        try{
          var raw=localStorage.getItem(SESSION_KEY);
          if(raw){
            var s=JSON.parse(raw);
            if(s&&s.pw&&s.ts&&Date.now()-s.ts<SESSION_TTL)return s.pw;
          }
          raw=sessionStorage.getItem(SESSION_KEY);
          if(raw){
            var tab=JSON.parse(raw);
            if(tab&&tab.pw)return tab.pw;
          }
        }catch(e){}
        return null;
      }
      async function deleteThinking(link,entry){
        var slug=entry.getAttribute("data-slug");
        var mbUrl=entry.getAttribute("data-microblog-url")||"";
        var pw=loadPw();
        if(!pw){alert("Sign in at /admin/ on this device first.");return;}
        if(!slug||!confirm("Delete this Thinking post from rommy.blog and Micro.blog? Bluesky too if we saved it when you posted."))return;
        link.setAttribute("aria-disabled","true");
        try{
          var res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:"delete-thinking",slug:slug,microblog_url:mbUrl})});
          var data={};
          try{data=await res.json();}catch(e){}
          if(!res.ok)throw new Error(data.error||("Delete failed (HTTP "+res.status+")"));
          var msg=["Deleted. Site will rebuild shortly."];
          if(data.microblogWarning)msg.push(data.microblogWarning);
          if(data.blueskyWarning)msg.push(data.blueskyWarning);
          else if(data.blueskyDeleted)msg.push("Bluesky: Deleted.");
          else if(data.blueskySkipped)msg.push("Bluesky: No saved post to delete (older posts may need manual removal).");
          alert(msg.join("\\n"));
          if(entry.classList.contains("post"))location.href="/thinking/";
          else entry.remove();
        }catch(err){
          var errMsg=err&&err.message?err.message:"Could not delete.";
          if(/failed to fetch|networkerror|load failed/i.test(errMsg)){
            errMsg="Request blocked or offline. If you use Brave, try turning Shields off for rommy.blog or sign in again at /admin/.";
          }
          alert(errMsg);
          link.removeAttribute("aria-disabled");
        }
      }
      function attachDelete(entry){
        if(entry.querySelector(".thinking-delete"))return;
        var link=document.createElement("a");
        link.href="javascript:void(0)";
        link.className="thinking-delete";
        link.setAttribute("role","button");
        link.textContent="delete";
        link.addEventListener("click",function(e){
          e.preventDefault();
          deleteThinking(link,entry);
        });
        var time=entry.querySelector("time.post-date");
        if(time){time.appendChild(document.createTextNode(" · "));time.appendChild(link);}
        else entry.appendChild(link);
      }
      function init(){
        if(!loadPw())return;
        document.querySelectorAll(".microblog-entry[data-slug]").forEach(attachDelete);
      }
      if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
    }());</script>`;

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Wraps bare URLs in <a> tags. Must run after escHtml() so we only match
// real URLs, not anything inside existing HTML attributes.
function autoLink(html) {
  return html.replace(/https?:\/\/[^\s<>"]+/g, (url) => {
    // Strip trailing punctuation that's likely not part of the URL
    const clean = url.replace(/[.,;:!?)"']+$/, "");
    const trail = url.slice(clean.length);
    return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>${trail}`;
  });
}

// Renders plain text as microblog-style HTML: double newlines → <p> paragraphs,
// single newlines → <br>, bare URLs → hyperlinks.
function textToMicroblogHtml(text) {
  const paras = String(text).split(/\n\n+/).filter(Boolean);
  if (!paras.length) return "";
  return `<div class="microblog-body">${paras.map((p) => `<p>${autoLink(escHtml(p).replace(/\n/g, "<br>"))}</p>`).join("")}</div>`;
}

function defaultOgImage() {
  return `${base}/favicon.png`;
}

function ogMetaTags({ type = "website", title, description = "", url, image }) {
  const img = image || defaultOgImage();
  const large = img !== defaultOgImage();
  const lines = [
    `    <meta property="og:type" content="${type}" />`,
    `    <meta property="og:title" content="${escHtml(title)}" />`,
    `    <meta property="og:url" content="${escHtml(url)}" />`,
    `    <meta property="og:site_name" content="${escHtml(site.title)}" />`,
    `    <meta property="og:image" content="${escHtml(img)}" />`,
    `    <meta name="twitter:card" content="${large ? "summary_large_image" : "summary"}" />`,
    `    <meta name="twitter:title" content="${escHtml(title)}" />`,
  ];
  if (description) {
    lines.push(`    <meta property="og:description" content="${escHtml(description)}" />`);
    lines.push(`    <meta name="description" content="${escHtml(description)}" />`);
    lines.push(`    <meta name="twitter:description" content="${escHtml(description)}" />`);
  }
  if (large) {
    lines.push(`    <meta name="twitter:image" content="${escHtml(img)}" />`);
  }
  return lines.join("\n");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstImageFromHtml(html) {
  const m = String(html || "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function thinkingSnippet(text, max = 160) {
  const plain = String(text || "").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

function thinkingOgFromItem(item) {
  const description = thinkingSnippet(stripHtml(item.content_html));
  const image = firstImageFromHtml(item.content_html) || defaultOgImage();
  return { description, image };
}

function renderThinkingHtml(thinking) {
  const text = (thinking?.text || "").trim();
  const mediaUrl = thinking?.media_url || "";
  const mediaAlt = thinking?.media_alt || "Photo";
  if (!text && !mediaUrl) return "";
  if (!mediaUrl) return textToMicroblogHtml(text);
  const img = `<p><img class="thinking-photo" src="${escHtml(mediaUrl)}" alt="${escHtml(mediaAlt)}" loading="lazy" decoding="async" /></p>`;
  if (!text) return `<div class="microblog-body">${img}</div>`;
  return textToMicroblogHtml(text).replace("</div>", `${img}</div>`);
}

function hasThinking(thinking) {
  return !!(thinking && ((thinking.text || "").trim() || thinking.media_url));
}

function toIsoZ(p) {
  const d = p.datetime ? new Date(p.datetime) : new Date(`${p.date}T12:00:00.000Z`);
  return d.toISOString();
}

// YYYY-MM-DD in ET, derived from p.datetime when available
function toETDate(p) {
  const d = p.datetime ? new Date(p.datetime) : new Date(`${p.date}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

function readingMins(bodyHtml) {
  const words = String(bodyHtml || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function renderPostPage(p) {
  const slug = safeSlug(p.slug);
  const displayDate = toETDate(p);
  const readMins = readingMins(p.body_html);
  const bodyHtml = p.body_html || "";
  const postUrl = `${base}/posts/${slug}/`;
  const ogImage = firstImageFromHtml(bodyHtml) || defaultOgImage();
  const ogTitle = `${p.title} — ${site.title}`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(ogTitle)}</title>
    <script>(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}());</script>
${ogMetaTags({
  type: "article",
  title: ogTitle,
  description: p.summary || "",
  url: postUrl,
  image: ogImage,
})}
    <link rel="icon" href="../../favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="../../favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="../../styles.css" />
    <link
      rel="alternate"
      type="application/atom+xml"
      title="${escHtml(site.title)}"
      href="../../feed.xml"
    />
${gaSnippet}
  </head>
  <body>
    <article class="post">
      <a class="post-back" href="../../index.html">←</a>
      <h1>${escHtml(p.title)}</h1>
      <time datetime="${escHtml(displayDate)}"><span>${escHtml(displayDate)}</span><span class="reading-time">${readMins} min read</span></time>
      <div class="body">
        ${bodyHtml}
      </div>
      <a class="back-to-top" href="#">↑ Top</a>
      <footer class="site-footer">
        <p class="footer-row">&copy; 2026 ${escHtml(site.author)}<a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="../../feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
  </body>
</html>
`;
}

const latest = ordered[0];
const feedUpdated = latest ? toIsoZ(latest) : new Date("2020-01-01T12:00:00.000Z").toISOString();

const safeSlug = (s) => String(s).replace(/[^a-zA-Z0-9-_]/g, "");

const MAX_PER_SECTION = 5;

// Microblog from micro.blog JSON feed
let microblogItems = [];
try {
  const mbRes = await fetch("https://rommy.micro.blog/feed.json", {
    headers: { "User-Agent": "rommy-blog-builder/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (mbRes.ok) {
    const mbData = await mbRes.json();
    microblogItems = (mbData.items || []).filter(
      (item) => item.content_html && item.date_published >= "2026"
    );
  }
} catch (e) {
  // Graceful fallback — page still builds without network
}

// Changelog from git log
let changelogEntries = [];
try {
  const raw = execSync(
    'git log --pretty=format:"%H|||%ad|||%s" --date=format:"%Y-%m-%d"',
    { cwd: root, encoding: "utf8", env: { ...process.env, TZ: "America/New_York" } }
  );
  changelogEntries = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|||");
      return { hash: parts[0], date: parts[1], message: parts.slice(2).join("|||") };
    });
} catch (e) {
  changelogEntries = [];
}

const renderPostItem = (p, absolute = false) =>
  `          <li>
            <span class="post-date">${escHtml(toETDate(p))}</span>
            <a href="${absolute ? `/posts/${escHtml(safeSlug(p.slug))}/` : `posts/${escHtml(safeSlug(p.slug))}/`}">${escHtml(p.title)}</a>
          </li>`;

function sortReadingDesc(a, b) {
  const aAt = a.added_at ? new Date(a.added_at).getTime() : NaN;
  const bAt = b.added_at ? new Date(b.added_at).getTime() : NaN;
  if (Number.isFinite(aAt) && Number.isFinite(bAt) && aAt !== bAt) return bAt - aAt;
  if (Number.isFinite(aAt) && Number.isFinite(bAt)) return (a.id || 0) - (b.id || 0);
  return 0;
}

const orderedReading = [...(reading || [])].sort(sortReadingDesc);
const renderReadingItem = (r) =>
  `          <li>
            <span class="post-date">${escHtml(r.ym)}</span>
            <a href="${escHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escHtml(r.title)}</a>
          </li>`;

const stripHashtags = (s) => String(s).replace(/\s*#\S+/g, "").trim();

const orderedLinklog = [...(linklog || [])].sort(sortDesc);
const renderLinklogItem = (l) =>
  `          <li>
            <span class="post-date">${escHtml(toETDate(l))}</span>
            <a href="${escHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escHtml(stripHashtags(l.title))}</a>
          </li>`;

// Homepage lists (capped at MAX_PER_SECTION)
const postListHtml = ordered.slice(0, MAX_PER_SECTION).map((p) => renderPostItem(p)).join("\n");
const hasMorePosts = ordered.length > MAX_PER_SECTION;
const postListAllHtml = ordered.map((p) => renderPostItem(p, true)).join("\n");

const readingHtml = orderedReading.slice(0, MAX_PER_SECTION).map(renderReadingItem).join("\n");
const hasMoreReading = orderedReading.length > MAX_PER_SECTION;
const readingAllHtml = orderedReading.map(renderReadingItem).join("\n");

const linklogHtml = orderedLinklog.slice(0, MAX_PER_SECTION).map(renderLinklogItem).join("\n");
const hasMoreLinklog = orderedLinklog.length > MAX_PER_SECTION;
const linklogAllHtml = orderedLinklog.map(renderLinklogItem).join("\n");

const linksHtml = (links || [])
  .map(
    (l) =>
      l.internal
        ? `          <li>
            <a href="${escHtml(l.url)}">${escHtml(l.label)}</a>
          </li>`
        : `          <li>
            <a href="${escHtml(l.url)}" rel="me noopener" target="_blank">${escHtml(l.label)}</a>
          </li>`
  )
  .join("\n");

const descriptionText = typeof site.description === "string" ? site.description.trim() : "";
const descriptionMeta = descriptionText
  ? `    <meta
      name="description"
      content="${escHtml(descriptionText)}"
    />
`
  : "";
const subtitleHtml = descriptionText ? `      <p class="lead">${escHtml(descriptionText)}</p>\n\n` : "";

const thinkingSection = hasThinking(thinking)
  ? `      <section aria-labelledby="now-heading">
        <h2 id="now-heading">Thinking</h2>
        <ol class="post-list">
          <li>
            ${renderThinkingHtml(thinking)}
          </li>
        </ol>
        <a class="see-more" href="/thinking/">→</a>
      </section>
`
  : "";

const colophonText =
  typeof optionalColophon === "string" ? optionalColophon.trim() : "";
const colophonSection = colophonText
  ? `      <section class="colophon" aria-label="Colophon">
        <p>${escHtml(colophonText)}</p>
      </section>
`
  : "";

const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(site.title)}</title>
    <script>(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}());</script>
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escHtml(site.title)}" />
    <meta property="og:url" content="${escHtml(site.url)}/" />
    <meta property="og:site_name" content="${escHtml(site.title)}" />
    <meta property="og:image" content="${escHtml(site.url)}/favicon.png" />
${descriptionText ? `    <meta property="og:description" content="${escHtml(descriptionText)}" />\n` : ""}${descriptionMeta}
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="styles.css" />
    <link
      rel="alternate"
      type="application/atom+xml"
      title="${escHtml(site.title)} (Atom)"
      href="feed.xml"
    />
${gaSnippet}
  </head>
  <body>
    <main>
      <h1 class="site-title">${escHtml(site.title)}</h1>
      <hr class="hr" />
${subtitleHtml}

${thinkingSection}

      <section aria-labelledby="posts-heading">
        <h2 id="posts-heading">Writing</h2>
        <ol class="post-list" reversed>
${postListHtml}
        </ol>
        ${hasMorePosts ? '<a class="see-more" href="/writing/">→</a>' : ""}
      </section>

      <section aria-labelledby="reading-heading">
        <h2 id="reading-heading">Reading</h2>
        <ol class="post-list" reversed>
${readingHtml}
        </ol>
        ${hasMoreReading ? '<a class="see-more" href="/reading/">→</a>' : ""}
      </section>

      <section aria-labelledby="linklog-heading">
        <h2 id="linklog-heading">Sharing</h2>
        <ol class="post-list" reversed>
${linklogHtml}
        </ol>
        ${hasMoreLinklog ? '<a class="see-more" href="/sharing/">→</a>' : ""}
      </section>

      <section aria-labelledby="links-heading">
        <h2 id="links-heading">Elsewhere</h2>
        <ul class="link-list">
${linksHtml}
        </ul>
      </section>

      <footer class="site-footer">
        <p class="footer-row"><span>&copy; 2026 ${escHtml(site.author)} (<a href="/admin/">admin</a>)</span><a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span>Subscribe via <a href="feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a>.</span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>

${colophonSection}    </main>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
  </body>
</html>
`;

const entries = ordered
  .map((p) => {
    const id = `${base}/posts/${safeSlug(p.slug)}/`;
    const t = toIsoZ(p);
    return `  <entry>
    <title>${escXml(p.title)}</title>
    <link href="${id}" rel="alternate" type="text/html" />
    <id>${id}</id>
    <updated>${t}</updated>
    <published>${t}</published>
    <summary type="text">${escXml(p.summary)}</summary>
  </entry>`;
  })
  .join("\n");

const feedXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>${escXml(site.title)}</title>
  <link href="${base}/feed.xml" rel="self" type="application/atom+xml" />
  <link href="${base}/" rel="alternate" type="text/html" />
  <id>${base}/</id>
  <updated>${feedUpdated}</updated>
  <author>
    <name>${escXml(site.author)}</name>
    <email>${escXml(site.authorEmail)}</email>
  </author>
${descriptionText ? `  <subtitle type="text">${escXml(descriptionText)}</subtitle>\n` : ""}${entries}
</feed>
`;

const robotsTxt = `User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${base}/sitemap.xml
`;

// Archive pages
const archiveHead = (title) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(title)} — ${escHtml(site.title)}</title>
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escHtml(title)} — ${escHtml(site.title)}" />
    <meta property="og:url" content="${escHtml(site.url)}/${escHtml(title.toLowerCase())}/" />
    <meta property="og:site_name" content="${escHtml(site.title)}" />
    <meta property="og:image" content="${escHtml(site.url)}/favicon.png" />
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="/styles.css" />
    <script>(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}());</script>
    <link
      rel="alternate"
      type="application/atom+xml"
      title="${escHtml(site.title)} (Atom)"
      href="/feed.xml"
    />
${gaSnippet}
  </head>
  <body>
    <article class="post">
      <a class="post-back" href="/">←</a>
      <h1>${escHtml(title)}</h1>`;

const archiveFoot = `      <footer class="site-footer">
        <p class="footer-row"><span>&copy; 2026 ${escHtml(site.author)} (<a href="/admin/">admin</a>)</span><a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="/feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
    <script>(function(){var BATCH=10;var list=document.querySelector('.post-list');if(!list)return;var items=list.querySelectorAll('li');if(items.length<=BATCH)return;for(var i=BATCH;i<items.length;i++)items[i].hidden=true;var shown=BATCH;var sentinel=document.createElement('div');document.body.appendChild(sentinel);var obs=new IntersectionObserver(function(e){if(!e[0].isIntersecting)return;var next=Math.min(shown+BATCH,items.length);for(var i=shown;i<next;i++)items[i].hidden=false;shown=next;if(shown>=items.length)obs.disconnect();},{rootMargin:'0px'});obs.observe(sentinel);}());</script>
  </body>
</html>
`;

const thinkingArchiveFoot = `      <footer class="site-footer">
        <p class="footer-row"><span>&copy; 2026 ${escHtml(site.author)} (<a href="/admin/">admin</a>)</span><a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="/feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingAdminDeleteScript}
  </body>
</html>
`;

const writingPageHtml = `${archiveHead("Writing")}
      <ol class="post-list" reversed>
${postListAllHtml}
      </ol>
${archiveFoot}`;

const readingPageHtml = `${archiveHead("Reading")}
      <ol class="post-list" reversed>
${readingAllHtml}
      </ol>
${archiveFoot}`;

const sharingPageHtml = `${archiveHead("Sharing")}
      <ol class="post-list" reversed>
${linklogAllHtml}
      </ol>
${archiveFoot}`;

// /now page
const nowMonthYear = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
const currentBook = orderedReading[0];
const nowPageHtml = `${archiveHead("Now")}
      <p class="lead">Updated ${escHtml(nowMonthYear)} &middot; Brooklyn, NY &middot; <a href="https://nownownow.com/about" target="_blank" rel="noopener">What's this?</a></p>
      <div class="now-body">
${hasThinking(thinking) ? `        <h2>Thinking</h2>
        ${renderThinkingHtml(thinking)}
` : ""}${currentBook ? `        <h2>Reading</h2>
        <p><a href="${escHtml(currentBook.url)}" target="_blank" rel="noopener">${escHtml(currentBook.title)}</a></p>
` : ""}        <h2>Working</h2>
        <p>Data by day. Writing when I can. Walking a lot.</p>
        <h2>Living</h2>
        <p>Brooklyn, NY.</p>
      </div>
${archiveFoot}`;

const changelogListHtml = changelogEntries.length > 0
  ? changelogEntries
      .map(
        (c) =>
          `          <li>
            <span class="post-date">${escHtml(c.date)}</span>
            <a href="https://github.com/fingerguns/blog/commit/${escHtml(c.hash)}" target="_blank" rel="noopener">${escHtml(c.message)}</a>
          </li>`
      )
      .join("\n")
  : `          <li><span>No changelog entries yet.</span></li>`;

const changelogPageHtml = `${archiveHead("Changelog")}
      <ol class="post-list" reversed>
${changelogListHtml}
      </ol>
${archiveFoot}`;

// Microblog page — dates/times shown in ET
const etDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const formatMbDate = (iso) => {
  const d = new Date(iso);
  return `${etDateFmt.format(d)} // ${etTimeFmt.format(d)}`;
};
// Slug stays UTC-based so existing URLs don't break
const mbSlug = (iso) => `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;

const thinkingPostHead = (iso, item) => {
  const pageTitle = `${formatMbDate(iso)} — ${site.title}`;
  const pageUrl = `${base}/thinking/${mbSlug(iso)}/`;
  const og = thinkingOgFromItem(item);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(pageTitle)}</title>
    <script>(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}());</script>
${ogMetaTags({
  type: "article",
  title: pageTitle,
  description: og.description,
  url: pageUrl,
  image: og.image,
})}
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="stylesheet" href="/styles.css" />
${gaSnippet}
  </head>
  <body>
    <article class="post microblog-entry" data-slug="${escHtml(mbSlug(iso))}" data-microblog-url="${escHtml(item.url || "")}">
      <a class="post-back" href="/thinking/">←</a>`;
};

const thinkingPostFoot = `      <footer class="site-footer">
        <p class="footer-row"><span>&copy; 2026 ${escHtml(site.author)} (<a href="/admin/">admin</a>)</span><a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="/feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingAdminDeleteScript}
  </body>
</html>`;

const microblogEntriesHtml = microblogItems.length > 0
  ? microblogItems.map((item) => {
      const slug = mbSlug(item.date_published);
      return `        <div class="microblog-entry" data-slug="${escHtml(slug)}" data-microblog-url="${escHtml(item.url || "")}">
          <div class="microblog-body">${item.content_html}</div>
          <time class="post-date" datetime="${escHtml(item.date_published)}"><a href="/thinking/${escHtml(slug)}/">${escHtml(formatMbDate(item.date_published))}</a></time>
        </div>`;
    }).join("\n")
  : `        <p style="color:var(--muted)">No posts yet.</p>`;

const microblogPageHtml = `${archiveHead("Thinking")}
      <div class="microblog-feed">
${microblogEntriesHtml}
      </div>
${thinkingArchiveFoot}`;

const archiveUrls = [
  ...(hasMorePosts ? [`${base}/writing/`] : []),
  ...(hasMoreReading ? [`${base}/reading/`] : []),
  ...(hasMoreLinklog ? [`${base}/sharing/`] : []),
];

const urls = [
  `${base}/`,
  `${base}/feed.xml`,
  `${base}/about/`,
  `${base}/contact/`,
  `${base}/colophon/`,
  `${base}/now/`,
  `${base}/changelog/`,
  `${base}/thinking/`,
  ...microblogItems.map((item) => `${base}/thinking/${mbSlug(item.date_published)}/`),
  ...archiveUrls,
  ...ordered.map((p) => `${base}/posts/${safeSlug(p.slug)}/`),
];

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escXml(u)}</loc>
  </url>`
  )
  .join("\n")}
</urlset>
`;

writeFileSync(join(root, "index.html"), indexHtml, "utf8");
writeFileSync(join(root, "feed.xml"), feedXml, "utf8");
writeFileSync(join(root, "robots.txt"), robotsTxt, "utf8");
writeFileSync(join(root, "sitemap.xml"), sitemapXml, "utf8");

// Archive pages: written when section exceeds MAX_PER_SECTION, removed when it doesn't
const manageArchive = (needed, dir, html) => {
  if (needed) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "index.html"), html, "utf8");
  } else {
    rmSync(join(root, dir), { recursive: true, force: true });
  }
};

manageArchive(hasMorePosts, "writing", writingPageHtml);
manageArchive(hasMoreReading, "reading", readingPageHtml);
manageArchive(hasMoreLinklog, "sharing", sharingPageHtml);

mkdirSync(join(root, "now"), { recursive: true });
writeFileSync(join(root, "now/index.html"), nowPageHtml, "utf8");

mkdirSync(join(root, "changelog"), { recursive: true });
writeFileSync(join(root, "changelog/index.html"), changelogPageHtml, "utf8");

mkdirSync(join(root, "thinking"), { recursive: true });
for (const ent of readdirSync(join(root, "thinking"))) {
  const entPath = join(root, "thinking", ent);
  if (ent !== "index.html" && statSync(entPath).isDirectory()) {
    rmSync(entPath, { recursive: true, force: true });
  }
}
writeFileSync(join(root, "thinking/index.html"), microblogPageHtml, "utf8");
rmSync(join(root, "microblog"), { recursive: true, force: true });

// Individual thinking post pages
for (const item of microblogItems) {
  const slug = mbSlug(item.date_published);
  const postHtml = `${thinkingPostHead(item.date_published, item)}
      <div class="microblog-body" style="margin-top:1.5rem">${item.content_html}</div>
      <time class="post-date" style="display:block;margin-top:0.75rem" datetime="${escHtml(item.date_published)}">${escHtml(formatMbDate(item.date_published))}</time>
${thinkingPostFoot}`;
  mkdirSync(join(root, "thinking", slug), { recursive: true });
  writeFileSync(join(root, "thinking", slug, "index.html"), postHtml, "utf8");
}

// Writing post pages — generated from D1; skip when using posts.json fallback
if (d1Configured()) {
  rmSync(join(root, "posts"), { recursive: true, force: true });
  for (const p of ordered) {
    const slug = safeSlug(p.slug);
    mkdirSync(join(root, "posts", slug), { recursive: true });
    writeFileSync(join(root, "posts", slug, "index.html"), renderPostPage(p), "utf8");
  }
}

console.log("Wrote index.html, feed.xml, robots.txt, sitemap.xml, now/index.html, changelog/index.html, thinking/, and posts/");
