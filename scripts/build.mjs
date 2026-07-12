/**
 * Rebuilds index.html, feed.xml, robots.txt, sitemap.xml, and post pages.
 * Reads content from Cloudflare D1 when configured, else data/posts.json.
 * Run from project root: node scripts/build.mjs
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { d1Configured, loadBlogDataFromD1 } from "./d1-client.mjs";
import { escHtml, escXml } from "./lib/html.mjs";
import { mergeSectionHints } from "./lib/section-hints.mjs";
import { renderThinkingContentHtml } from "./lib/thinking-html.mjs";
import { thinkingSlugFromIso } from "./lib/thinking-slug.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, process.env.BUILD_OUT_DIR || "dist");
const cssV = new Date().toISOString().slice(0, 10);

let data;
if (d1Configured()) {
  console.log("Loading content from D1…");
  data = await loadBlogDataFromD1();
} else {
  console.log("D1 not configured — loading data/posts.json");
  data = JSON.parse(readFileSync(join(root, "data/posts.json"), "utf8"));
}

const { site, thinking, thinkingPosts = [], posts, reading, linklog, links, optionalColophon, sectionHints } = data;

const SECTION_HINTS = mergeSectionHints(sectionHints);

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

const GA_ID = "G-L1CC5F3DP8";
const gaSnippet = `    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;

const portraitPhotoToggleScript = `    <script>(function(){function init(){document.querySelectorAll(".microblog-body img, .post .body img").forEach(function(img){if(img.dataset.portraitInit)return;function setup(){var w=img.naturalWidth,h=img.naturalHeight;if(!w||!h)return;img.dataset.portraitInit="1";if(h<=w)return;img.classList.add("photo-portrait");img.setAttribute("role","button");img.setAttribute("tabindex","0");img.setAttribute("aria-expanded","false");img.title="Click to enlarge";function toggle(){var ex=img.classList.toggle("photo-expanded");img.setAttribute("aria-expanded",ex?"true":"false");}img.addEventListener("click",toggle);img.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();}});}if(img.complete)setup();else img.addEventListener("load",setup,{once:true});});}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();}());</script>`;

const thinkingDeleteLinkScript = `    <script>(function(){
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
      function attachDeleteLinks(){
        if(!loadPw())return;
        document.querySelectorAll(".microblog-entry[data-slug]").forEach(function(entry){
          if(entry.querySelector("a.thinking-delete"))return;
          var slug=entry.getAttribute("data-slug");
          if(!slug)return;
          var a=document.createElement("a");
          a.href=entry.classList.contains("post")?("?delete"):("/thinking/"+slug+"/?delete");
          a.className="thinking-delete";
          a.textContent="delete";
          var time=entry.querySelector("time.post-date");
          if(time){time.appendChild(document.createTextNode(" · "));time.appendChild(a);}
        });
      }
      if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attachDeleteLinks);else attachDeleteLinks();
      window.addEventListener("pageshow",attachDeleteLinks);
    }());</script>`;

const thinkingDeleteConfirmScript = `    <script>(function(){
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
      function initDeletePage(){
        if(!/[?&]delete(?:=|$)/.test(location.search))return;
        var entry=document.querySelector(".microblog-entry[data-slug]");
        var panel=document.getElementById("thinking-delete-panel");
        if(!entry||!panel)return;
        var slug=entry.getAttribute("data-slug");
        var mbUrl=entry.getAttribute("data-microblog-url")||"";
        var signin=panel.querySelector(".thinking-delete-signin");
        var confirm=panel.querySelector(".thinking-delete-confirm");
        var status=panel.querySelector(".thinking-delete-status");
        var cancel=panel.querySelector(".thinking-delete-cancel");
        var go=panel.querySelector(".thinking-delete-go");
        panel.hidden=false;
        try{panel.scrollIntoView({behavior:"smooth",block:"nearest"});}catch(e){}
        if(cancel)cancel.href=location.pathname;
        var pw=loadPw();
        if(!pw){
          if(signin)signin.hidden=false;
          if(confirm)confirm.hidden=true;
          return;
        }
        if(signin)signin.hidden=true;
        if(confirm)confirm.hidden=false;
        if(!go||go.dataset.bound)return;
        go.dataset.bound="1";
        go.addEventListener("click",function(e){
          e.preventDefault();
          if(go.getAttribute("aria-disabled")==="true")return;
          go.setAttribute("aria-disabled","true");
          if(status){status.hidden=false;status.textContent="Deleting…";status.className="thinking-delete-status";}
          (async function(){
            try{
              var res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:"delete-thinking",slug:slug,microblog_url:mbUrl})});
              var data={};
              try{data=await res.json();}catch(err){}
              if(!res.ok)throw new Error(data.error||("Delete failed (HTTP "+res.status+")"));
              if(status){status.textContent="Deleted. Returning to archive…";status.className="thinking-delete-status ok";}
              setTimeout(function(){location.href="/thinking/";},900);
            }catch(err){
              if(status){status.textContent=err&&err.message?err.message:"Could not delete.";status.className="thinking-delete-status err";}
              go.removeAttribute("aria-disabled");
            }
          })();
        });
      }
      if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initDeletePage);else initDeletePage();
    }());</script>`;

const thinkingDeletePanelHtml = `      <div id="thinking-delete-panel" class="thinking-delete-panel" hidden>
        <p class="thinking-delete-signin" hidden>Sign in at <a href="/admin/">admin</a> on this device, then open this page again with <code>?delete</code>.</p>
        <div class="thinking-delete-confirm" hidden>
          <p class="thinking-delete-lead"><em>Delete this post from rommy.blog and Micro.blog? Bluesky too if we saved it when you posted.</em></p>
          <p class="thinking-delete-actions">
            <a href="#" class="thinking-delete-go">Delete permanently?</a>
            ·
            <a class="thinking-delete-cancel" href="#">Cancel</a>
          </p>
          <p class="thinking-delete-status" hidden></p>
        </div>
      </div>`;

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

function thinkingContentHtmlFromRow(p, options = {}) {
  const fromSource = renderThinkingContentHtml(
    p.text,
    p.media_url,
    p.media_alt,
    p.media_type,
    base,
    options
  );
  if (fromSource) return fromSource;
  return p.content_html || "";
}

function renderThinkingHtml(thinking) {
  const inner = renderThinkingContentHtml(
    thinking?.text,
    thinking?.media_url,
    thinking?.media_alt,
    thinking?.media_type,
    base
  );
  if (!inner) return "";
  return `<div class="microblog-body">${inner}</div>`;
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
    <link rel="stylesheet" href="../../styles.css?v=${cssV}" />
    <link
      rel="alternate"
      type="application/atom+xml"
      title="${escHtml(site.title)}"
      href="../../feed.xml"
    />
    <link rel="webmention" href="https://webmention.io/rommy.blog/webmention" />
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
      <section class="webmentions" id="webmentions" hidden aria-labelledby="wm-heading"></section>
      <script>(function(){
        var url=${JSON.stringify(postUrl)};
        fetch('https://webmention.io/api/mentions.jf2?target='+encodeURIComponent(url)+'&per-page=100&sort-by=published')
          .then(function(r){return r.json();})
          .then(function(d){
            var all=d.children||[];
            if(!all.length)return;
            var reactions=all.filter(function(m){return m['wm-property']==='like-of'||m['wm-property']==='bookmark-of'||m['wm-property']==='repost-of';});
            var comments=all.filter(function(m){return m['wm-property']==='in-reply-to'||m['wm-property']==='mention-of';});
            var s=document.getElementById('webmentions');
            var h=document.createElement('h2');h.id='wm-heading';h.textContent='Webmentions';s.appendChild(h);
            if(reactions.length){
              var rx=document.createElement('div');rx.className='wm-reactions';
              reactions.forEach(function(m){
                var a=document.createElement('a');
                a.href=(m.author&&m.author.url)||m.url;a.target='_blank';a.rel='noopener';
                var name=(m.author&&m.author.name)||'?';a.title=name;
                if(m.author&&m.author.photo){var img=document.createElement('img');img.src=m.author.photo;img.alt=name;img.loading='lazy';a.appendChild(img);}
                else{a.textContent=name.charAt(0).toUpperCase();}
                rx.appendChild(a);
              });
              s.appendChild(rx);
            }
            if(comments.length){
              var cl=document.createElement('div');cl.className='wm-comments';
              comments.forEach(function(m){
                var item=document.createElement('div');item.className='wm-comment';
                var meta=document.createElement('div');meta.className='wm-comment-meta';
                var a=document.createElement('a');a.href=(m.author&&m.author.url)||m.url;a.target='_blank';a.rel='noopener';a.textContent=(m.author&&m.author.name)||'Anonymous';meta.appendChild(a);
                if(m.published){var t=document.createElement('time');t.dateTime=m.published;t.textContent=' · '+m.published.slice(0,10);meta.appendChild(t);}
                item.appendChild(meta);
                if(m.content&&m.content.text){var p=document.createElement('p');p.className='wm-comment-text';p.textContent=m.content.text.slice(0,500);item.appendChild(p);}
                cl.appendChild(item);
              });
              s.appendChild(cl);
            }
            s.removeAttribute('hidden');
          }).catch(function(){});
      }());</script>
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

// Thinking posts from D1 (populated by the admin Worker on every post/delete)
const microblogItems = thinkingPosts.map((p) => ({
  _slug: p.slug,
  content_html: thinkingContentHtmlFromRow(p),
  date_published: p.datetime,
  url: p.microblog_url || "",
  media_type: p.media_type || "",
}));

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

const sectionHeading = (label, tag, id) => {
  const hint = SECTION_HINTS[label];
  const idAttr = id ? ` id="${id}"` : "";
  return `<${tag}${idAttr}><span class="section-hint" tabindex="0" aria-label="About ${escHtml(label)}">${escHtml(label)}<span class="section-hint-tip" role="tooltip">${escHtml(hint)}</span></span></${tag}>`;
};

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
        ${sectionHeading("Thinking", "h2", "now-heading")}
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
    <link rel="stylesheet" href="styles.css?v=${cssV}" />
    <link
      rel="alternate"
      type="application/atom+xml"
      title="${escHtml(site.title)} (Atom)"
      href="feed.xml"
    />
    <link rel="webmention" href="https://webmention.io/rommy.blog/webmention" />
${gaSnippet}
  </head>
  <body>
    <main>
      <h1 class="site-title">${escHtml(site.title)}</h1>
      <hr class="hr" />
${subtitleHtml}

${thinkingSection}

      <section aria-labelledby="posts-heading">
        ${sectionHeading("Writing", "h2", "posts-heading")}
        <ol class="post-list" reversed>
${postListHtml}
        </ol>
        ${hasMorePosts ? '<a class="see-more" href="/writing/">→</a>' : ""}
      </section>

      <section aria-labelledby="reading-heading">
        ${sectionHeading("Reading", "h2", "reading-heading")}
        <ol class="post-list" reversed>
${readingHtml}
        </ol>
        ${hasMoreReading ? '<a class="see-more" href="/reading/">→</a>' : ""}
      </section>

      <section aria-labelledby="linklog-heading">
        ${sectionHeading("Sharing", "h2", "linklog-heading")}
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
const archiveHead = (title, headingHtml) => `<!DOCTYPE html>
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
    <link rel="stylesheet" href="/styles.css?v=${cssV}" />
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
      ${headingHtml ?? `<h1>${escHtml(title)}</h1>`}`;

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
${thinkingDeleteLinkScript}
  </body>
</html>
`;

const writingPageHtml = `${archiveHead("Writing", sectionHeading("Writing", "h1"))}
      <ol class="post-list" reversed>
${postListAllHtml}
      </ol>
${archiveFoot}`;

const readingPageHtml = `${archiveHead("Reading", sectionHeading("Reading", "h1"))}
      <ol class="post-list" reversed>
${readingAllHtml}
      </ol>
${archiveFoot}`;

const sharingPageHtml = `${archiveHead("Sharing", sectionHeading("Sharing", "h1"))}
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
const thinkingSlug = (item) => item._slug || thinkingSlugFromIso(item.date_published);

function thinkingPostCrumb(iso) {
  const dateLabel = formatMbDate(iso);
  return `      <nav class="thinking-crumb" aria-label="Breadcrumb">
        <h1 class="site-title"><a href="/">${escHtml(site.title)}</a></h1>
        <div class="thinking-crumb-trail">
          <h2 class="thinking-crumb-heading"><a href="/thinking/">Thinking</a></h2><span class="thinking-crumb-meta"> // <time class="thinking-crumb-date" datetime="${escHtml(iso)}" aria-current="page">${escHtml(dateLabel)}</time></span>
        </div>
      </nav>`;
}

const thinkingPostHead = (iso, item, slug) => {
  const pageTitle = `${formatMbDate(iso)} — ${site.title}`;
  const pageUrl = `${base}/thinking/${slug}/`;
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
    <link rel="stylesheet" href="/styles.css?v=${cssV}" />
${gaSnippet}
  </head>
  <body>
    <article class="post microblog-entry" data-slug="${escHtml(slug)}" data-microblog-url="${escHtml(item.url || "")}">
${thinkingPostCrumb(iso)}`;
};

const thinkingPostFoot = `      <footer class="site-footer">
        <p class="footer-row"><span>&copy; 2026 ${escHtml(site.author)} (<a href="/admin/">admin</a>)</span><a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="/feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingDeleteLinkScript}
${thinkingDeleteConfirmScript}
  </body>
</html>`;

const microblogEntriesHtml = microblogItems.length > 0
  ? microblogItems.map((item) => {
      const slug = thinkingSlug(item);
      return `        <div class="microblog-entry" data-slug="${escHtml(slug)}" data-microblog-url="${escHtml(item.url || "")}">
          <div class="microblog-body">${item.content_html}</div>
          <time class="post-date" datetime="${escHtml(item.date_published)}"><a href="/thinking/${escHtml(slug)}/">${escHtml(formatMbDate(item.date_published))}</a></time>
        </div>`;
    }).join("\n")
  : `        <p style="color:var(--muted)">No posts yet.</p>`;

const microblogPageHtml = `${archiveHead("Thinking", sectionHeading("Thinking", "h1"))}
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
  ...microblogItems.map((item) => `${base}/thinking/${thinkingSlug(item)}/`),
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

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "index.html"), indexHtml, "utf8");
writeFileSync(join(outDir, "feed.xml"), feedXml, "utf8");
writeFileSync(join(outDir, "robots.txt"), robotsTxt, "utf8");
writeFileSync(join(outDir, "sitemap.xml"), sitemapXml, "utf8");

// Archive pages: written when section exceeds MAX_PER_SECTION, removed when it doesn't
const manageArchive = (needed, dir, html) => {
  if (needed) {
    mkdirSync(join(outDir, dir), { recursive: true });
    writeFileSync(join(outDir, dir, "index.html"), html, "utf8");
  }
};

manageArchive(hasMorePosts, "writing", writingPageHtml);
manageArchive(hasMoreReading, "reading", readingPageHtml);
manageArchive(hasMoreLinklog, "sharing", sharingPageHtml);

mkdirSync(join(outDir, "now"), { recursive: true });
writeFileSync(join(outDir, "now/index.html"), nowPageHtml, "utf8");

mkdirSync(join(outDir, "changelog"), { recursive: true });
writeFileSync(join(outDir, "changelog/index.html"), changelogPageHtml, "utf8");

mkdirSync(join(outDir, "thinking"), { recursive: true });
writeFileSync(join(outDir, "thinking/index.html"), microblogPageHtml, "utf8");

// Individual thinking post pages — preload video on detail pages for faster playback start
for (const item of microblogItems) {
  const slug = thinkingSlug(item);
  const row = thinkingPosts.find((p) => p.slug === slug);
  const detailContent = row
    ? thinkingContentHtmlFromRow(row, { videoPreload: "auto" })
    : item.content_html;
  const postHtml = `${thinkingPostHead(item.date_published, item, slug)}
      <div class="microblog-body">${detailContent}</div>
${thinkingDeletePanelHtml}
${thinkingPostFoot}`;
  mkdirSync(join(outDir, "thinking", slug), { recursive: true });
  writeFileSync(join(outDir, "thinking", slug, "index.html"), postHtml, "utf8");
}

// Writing post pages
for (const p of ordered) {
  const slug = safeSlug(p.slug);
  mkdirSync(join(outDir, "posts", slug), { recursive: true });
  writeFileSync(join(outDir, "posts", slug, "index.html"), renderPostPage(p), "utf8");
}

const STATIC_ENTRIES = ["styles.css", "favicon.png", "about", "admin", "colophon", "contact"];
for (const entry of STATIC_ENTRIES) {
  const src = join(root, entry);
  if (existsSync(src)) {
    cpSync(src, join(outDir, entry), { recursive: true });
  }
}

console.log(`Wrote ${outDir}/ (generated pages + static assets)`);
