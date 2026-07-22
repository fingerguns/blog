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
const cssV = `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;

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

const portraitPhotoToggleScript = `    <script>(function(){function init(){document.querySelectorAll(".post .body img:not(.thinking-photo)").forEach(function(img){if(img.dataset.portraitInit)return;function setup(){var w=img.naturalWidth,h=img.naturalHeight;if(!w||!h)return;img.dataset.portraitInit="1";if(h<=w)return;img.classList.add("photo-portrait");img.setAttribute("role","button");img.setAttribute("tabindex","0");img.setAttribute("aria-expanded","false");img.title="Click to enlarge";function toggle(){var ex=img.classList.toggle("photo-expanded");img.setAttribute("aria-expanded",ex?"true":"false");}img.addEventListener("click",toggle);img.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();}});}if(img.complete)setup();else img.addEventListener("load",setup,{once:true});});}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();}());</script>`;

const thinkingLightboxScript = `    <script>(function(){
  var overlay=null,imgEl=null,counterEl=null,urls=[],index=0;
  var touchX=0,touchY=0,touchT=0,swiping=false;
  var SWIPE_MIN=40;
  function ensure(){
    if(overlay)return;
    overlay=document.createElement("div");
    overlay.className="thinking-lightbox";
    overlay.hidden=true;
    overlay.setAttribute("role","dialog");
    overlay.setAttribute("aria-modal","true");
    overlay.setAttribute("aria-label","Photo gallery");
    overlay.innerHTML='<button type="button" class="thinking-lightbox-close" aria-label="Close">&times;</button><button type="button" class="thinking-lightbox-prev" aria-label="Previous photo">‹</button><figure class="thinking-lightbox-figure"><img alt="" draggable="false" /><figcaption class="thinking-lightbox-counter"></figcaption></figure><button type="button" class="thinking-lightbox-next" aria-label="Next photo">›</button>';
    document.body.appendChild(overlay);
    imgEl=overlay.querySelector("img");
    counterEl=overlay.querySelector(".thinking-lightbox-counter");
    overlay.querySelector(".thinking-lightbox-close").addEventListener("click",close);
    overlay.querySelector(".thinking-lightbox-prev").addEventListener("click",function(e){e.stopPropagation();show(index-1);});
    overlay.querySelector(".thinking-lightbox-next").addEventListener("click",function(e){e.stopPropagation();show(index+1);});
    overlay.addEventListener("click",function(e){if(e.target===overlay)close();});
    document.addEventListener("keydown",function(e){
      if(overlay.hidden)return;
      if(e.key==="Escape")close();
      else if(e.key==="ArrowLeft")show(index-1);
      else if(e.key==="ArrowRight")show(index+1);
    });
    overlay.addEventListener("touchstart",function(e){
      if(overlay.hidden||urls.length<2||!e.touches||!e.touches.length)return;
      touchX=e.touches[0].clientX;
      touchY=e.touches[0].clientY;
      touchT=Date.now();
      swiping=true;
    },{passive:true});
    overlay.addEventListener("touchmove",function(e){
      if(!swiping||!e.touches||!e.touches.length)return;
      var dx=e.touches[0].clientX-touchX;
      var dy=e.touches[0].clientY-touchY;
      if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>12){
        if(e.cancelable)e.preventDefault();
      }
    },{passive:false});
    overlay.addEventListener("touchend",function(e){
      if(!swiping)return;
      swiping=false;
      if(urls.length<2)return;
      var t=e.changedTouches&&e.changedTouches[0];
      if(!t)return;
      var dx=t.clientX-touchX;
      var dy=t.clientY-touchY;
      var dt=Date.now()-touchT;
      if(Math.abs(dx)<SWIPE_MIN||Math.abs(dx)<Math.abs(dy))return;
      if(dt>800&&Math.abs(dx)<80)return;
      if(dx<0)show(index+1);
      else show(index-1);
    },{passive:true});
    overlay.addEventListener("touchcancel",function(){swiping=false;},{passive:true});
  }
  function show(i){
    if(!urls.length)return;
    index=(i+urls.length)%urls.length;
    imgEl.src=urls[index];
    counterEl.textContent=urls.length>1?(index+1)+" / "+urls.length:"";
    overlay.classList.toggle("thinking-lightbox--multi",urls.length>1);
  }
  function open(list,start){
    ensure();
    urls=list;
    show(start||0);
    overlay.hidden=false;
    document.documentElement.classList.add("thinking-lightbox-open");
  }
  function close(){
    if(!overlay||overlay.hidden)return;
    overlay.hidden=true;
    imgEl.removeAttribute("src");
    document.documentElement.classList.remove("thinking-lightbox-open");
  }
  function collectUrls(root){
    return Array.prototype.map.call(root.querySelectorAll("img.thinking-photo"),function(img){return img.currentSrc||img.src;}).filter(Boolean);
  }
  function onActivate(btn){
    var grid=btn.closest("[data-gallery], .thinking-photo-grid");
    var single=btn.classList.contains("thinking-photo-tile--single")?btn:null;
    var root=grid||single;
    if(!root)return;
    var list=collectUrls(root);
    if(!list.length)return;
    var start=parseInt(btn.getAttribute("data-gallery-index")||"0",10)||0;
    open(list,start);
  }
  function init(){
    document.addEventListener("click",function(e){
      var btn=e.target.closest(".thinking-photo-tile");
      if(!btn)return;
      e.preventDefault();
      onActivate(btn);
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
}());</script>`;

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

// Grid thumbnails: extract the post's photo (src + alt) from its rendered content_html
function imageSrcAltFromHtml(html) {
  const str = String(html || "");
  const srcM = str.match(/<img[^>]+src=["']([^"']+)["']/i);
  const altM = str.match(/<img[^>]+alt=["']([^"']*)["']/i);
  return { src: srcM ? srcM[1] : "", alt: altM ? altM[1] : "" };
}

// Native video posts render as <video class="thinking-video"> — pull the src so
// the grid can show the first frame as a thumbnail instead of a text card.
function videoSrcFromHtml(html) {
  const str = String(html || "");
  const m =
    str.match(/<video[^>]+class=["'][^"']*thinking-video[^"']*["'][^>]+src=["']([^"']+)["']/i) ||
    str.match(/<video[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*thinking-video[^"']*["']/i);
  if (!m) return "";
  return m[1].replace(/#t=0\.001$/, "");
}

function spotifyEmbedFromHtml(html) {
  const str = String(html || "");
  const m = str.match(
    /open\.spotify\.com\/embed\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/i
  );
  if (!m) return null;
  return { type: m[1].toLowerCase(), id: m[2] };
}

async function fetchSpotifyThumbnail(type, id) {
  try {
    const pageUrl = `https://open.spotify.com/${type}/${id}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(pageUrl)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.thumbnail_url === "string" ? data.thumbnail_url : null;
  } catch {
    return null;
  }
}

function youtubeIdFromHtml(html) {
  const str = String(html || "");
  const m =
    str.match(/youtube-nocookie\.com\/embed\/([\w-]{11})/i) ||
    str.match(/youtube\.com\/embed\/([\w-]{11})/i);
  return m ? m[1] : null;
}

function youtubeThumbnailUrl(id) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

// "July 2026" in ET, used to group Thinking grid items by month
function monthLabelET(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(d);
}

// Grid thumbnails: which non-photo media (if any) a post's rendered
// content_html contains, so the text card can show a small icon badge.
function thinkingMediaKind(html) {
  const str = String(html || "");
  if (/class="thinking-video"/.test(str)) return "video";
  if (/class="thinking-audio"/.test(str)) return "audio";
  if (/class="thinking-youtube"/.test(str)) return "youtube";
  if (/class="thinking-spotify/.test(str)) return "spotify";
  return "";
}

// Strip media elements (video/audio/embeds) out of content_html before
// computing a text snippet, so their fallback inner text (e.g. "Video")
// never leaks into the grid card when there's no caption.
function stripMediaMarkup(html) {
  return String(html || "")
    .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, "")
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, "")
    .replace(/<div class="thinking-youtube">[\s\S]*?<\/div>/gi, "")
    .replace(/<div class="thinking-spotify[^"]*">[\s\S]*?<\/div>/gi, "");
}

// Small icon badges for the grid's text-preview cards, indicating the kind
// of media attached (generic play/mic glyphs; brand marks for YouTube/Spotify).
const THINKING_MEDIA_ICONS = {
  photo: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><path d="M6.25 10a1.25 1.25 0 0 1 1.25-1.25h9a1.25 1.25 0 0 1 1.25 1.25v5.25a1.25 1.25 0 0 1-1.25 1.25h-9A1.25 1.25 0 0 1 6.25 15.25V10z" style="fill:var(--bg)"/><path d="M9.25 10V8.35h3.45l.95 1.65H9.25z" style="fill:var(--bg)"/><circle cx="12" cy="13.25" r="3.35" style="fill:var(--text)"/><circle cx="12" cy="13.25" r="1.45" style="fill:var(--bg)"/></svg>`,
  video: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><rect x="6" y="8.5" width="9" height="7" rx="1.3" style="fill:var(--bg)"/><path d="M15 10 L19.5 8 L19.5 16 L15 14 Z" style="fill:var(--bg)"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><path d="M12 6.5a2.25 2.25 0 0 1 2.25 2.25v3a2.25 2.25 0 0 1-4.5 0v-3A2.25 2.25 0 0 1 12 6.5z" style="fill:var(--bg)"/><path d="M8.25 11.75a3.75 3.75 0 0 0 7.5 0M12 15.5v2M10 17.5h4" style="fill:none;stroke:var(--bg);stroke-width:1.1;stroke-linecap:round"/></svg>`,
  youtube: `<svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" rx="5" fill="#FF0000"/><path d="M11 6.2 19 10l-8 3.8V6.2z" fill="#fff"/></svg>`,
  spotify: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954"/><path d="M6.5 9.7c3.4-1 7.2-.8 10.1.9M7.3 12.6c2.8-.8 6-.6 8.4.7M8.1 15.4c2.3-.6 4.9-.5 6.8.6" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`,
  text: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" style="fill:var(--text)"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" font-family="Georgia,'Times New Roman',serif" style="fill:var(--bg)">Tt</text></svg>`,
};

const THINKING_GRID_KINDS = ["photo", "video", "youtube", "spotify", "audio", "text"];

function thinkingGridKind(item, spotifyThumbnails = {}) {
  if (imageSrcAltFromHtml(item.content_html).src) return "photo";
  if (videoSrcFromHtml(item.content_html)) return "video";
  const spotifyEmbed = spotifyEmbedFromHtml(item.content_html);
  if (spotifyEmbed) {
    const key = `${spotifyEmbed.type}:${spotifyEmbed.id}`;
    if (spotifyThumbnails[key]) return "spotify";
  }
  if (youtubeIdFromHtml(item.content_html)) return "youtube";
  const mediaKind = thinkingMediaKind(item.content_html);
  if (mediaKind) return mediaKind;
  return "text";
}

function thinkingGridBadgeHtml(kind) {
  const icon = THINKING_MEDIA_ICONS[kind];
  if (!icon) return "";
  return `<span class="thinking-grid-icon thinking-grid-icon--${kind}" aria-hidden="true">${icon}</span>`;
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
    { ...options, mediaUrls: p.media_urls || [] }
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
    base,
    { mediaUrls: thinking?.media_urls || [] }
  );
  if (!inner) return "";
  return `<div class="microblog-body">${inner}</div>`;
}

function hasThinking(thinking) {
  return !!(
    thinking &&
    ((thinking.text || "").trim() ||
      thinking.media_url ||
      (Array.isArray(thinking.media_urls) && thinking.media_urls.length))
  );
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
${thinkingLightboxScript}
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

// Reading grid: book cover art isn't stored in D1 (reading rows only have
// title/url/ym), so covers are looked up at build time via Open Library's
// public search + covers API and cached locally, so we don't refetch on
// every build. Bookshop.org and IndieBound.org both sit behind Cloudflare
// bot management and reject scraping attempts outright (confirmed 403 /
// challenge responses regardless of User-Agent), so we don't even try
// scraping their pages — Open Library's API is designed for exactly this
// kind of lookup and isn't blocked. Only successful fetches are cached —
// a failed/no-match lookup is simply retried on the next build rather
// than "poisoning" the cache with a permanent null.
const readingCoversPath = join(root, "data/reading-covers.json");
let readingCoverCache = {};
if (existsSync(readingCoversPath)) {
  try {
    readingCoverCache = JSON.parse(readFileSync(readingCoversPath, "utf8"));
  } catch {
    readingCoverCache = {};
  }
}

async function openLibraryJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://openlibrary.org${path}`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// A plain title search ranks by relevance across title+author+etc, so a
// short/generic title (e.g. "Hill") can confidently match a completely
// different, more famous book (e.g. "Think and Grow Rich" by Napoleon
// Hill). Only trust a title-search hit if its own title is basically the
// same string we searched for.
const normalizeTitle = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function titlesMatch(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return Boolean(na && nb) && (na === nb || na.includes(nb) || nb.includes(na));
}

// Cover lookup, most precise first:
// 1. The exact edition record for an ISBN (its own `covers` array) — this is
//    what the book actually looks like on the shelf, not just "a" cover for
//    the work, which matters since Open Library often merges translations
//    and editions of the same work together.
// 2. A search by ISBN, using whatever cover the matched work happens to have.
// 3. A plain title search, for books whose Bookshop.org URL has no ISBN —
//    guarded by titlesMatch() since this path isn't exact-key based.
async function fetchBookCover(title, url) {
  const isbn = /[?&]ean=(\d{9,13})\b/.exec(String(url || ""))?.[1];
  if (isbn) {
    const edition = await openLibraryJson(`/isbn/${isbn}.json`);
    const editionCoverId = edition?.covers?.find((id) => id > 0);
    if (editionCoverId) return `https://covers.openlibrary.org/b/id/${editionCoverId}-L.jpg`;

    const bySearch = await openLibraryJson(
      `/search.json?limit=1&fields=cover_i&q=${encodeURIComponent(`isbn:${isbn}`)}`
    );
    const searchCoverId = bySearch?.docs?.[0]?.cover_i;
    if (searchCoverId) return `https://covers.openlibrary.org/b/id/${searchCoverId}-L.jpg`;
  }

  const byTitle = await openLibraryJson(
    `/search.json?limit=1&fields=cover_i,title&q=${encodeURIComponent(title)}`
  );
  const hit = byTitle?.docs?.[0];
  if (hit?.cover_i && titlesMatch(title, hit.title)) {
    return `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`;
  }
  return null;
}

// Entries with a manually-chosen cover_url (picked in the admin from the
// Open Library / Apple Books / Google Books candidates) skip the automatic
// lookup entirely — that choice always wins.
const missingCovers = orderedReading.filter(
  (r) => r.url && !r.cover_url && !(r.url in readingCoverCache)
);
if (missingCovers.length > 0) {
  console.log(`Looking up ${missingCovers.length} book cover(s) via Open Library…`);
  let fetchedAny = false;
  for (const r of missingCovers) {
    const cover = await fetchBookCover(r.title, r.url);
    if (cover) {
      readingCoverCache[r.url] = cover;
      fetchedAny = true;
    } else {
      console.log(`  no cover found for "${r.title}" — will retry next build`);
    }
  }
  if (fetchedAny) {
    writeFileSync(readingCoversPath, `${JSON.stringify(readingCoverCache, null, 2)}\n`);
  }
}

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
${thinkingLightboxScript}
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
${thinkingLightboxScript}
    <script>(function(){var BATCH=10;var list=document.querySelector('.post-list');if(!list)return;var items=list.querySelectorAll('li');if(items.length<=BATCH)return;for(var i=BATCH;i<items.length;i++)items[i].hidden=true;var shown=BATCH;var sentinel=document.createElement('div');document.body.appendChild(sentinel);var obs=new IntersectionObserver(function(e){if(!e[0].isIntersecting)return;var next=Math.min(shown+BATCH,items.length);for(var i=shown;i<next;i++)items[i].hidden=false;shown=next;if(shown>=items.length)obs.disconnect();},{rootMargin:'0px'});obs.observe(sentinel);}());</script>
  </body>
</html>
`;

const thinkingViewToggleScript = `    <script>(function(){
var wrap=document.querySelector('.thinking-views');
if(!wrap)return;
var viewBtns=document.querySelectorAll('.thinking-view-btn');
var filterBtns=document.querySelectorAll('.thinking-filter-btn');
var items=document.querySelectorAll('.thinking-grid-item');
var months=document.querySelectorAll('.thinking-grid-month');
var kinds=${JSON.stringify(THINKING_GRID_KINDS)};
var filterKey='thinkingGridFiltersV2';
var gridMediaObs=null;
function defaultFilters(){var all={};kinds.forEach(function(k){all[k]=false;});return all;}
function loadFilters(){try{var saved=JSON.parse(localStorage.getItem(filterKey)||'null');if(saved&&typeof saved==='object')return saved;}catch(e){}return defaultFilters();}
var active=loadFilters();
function anyFilterActive(){return kinds.some(function(k){return active[k];});}
function hydrateGridMedia(el){
  if(el.dataset.loaded==='1')return;
  var url=el.getAttribute('data-src');
  if(!url)return;
  el.src=url;
  el.removeAttribute('data-src');
  el.dataset.loaded='1';
  if(gridMediaObs)gridMediaObs.unobserve(el);
}
function scanGridMedia(){
  if(!gridMediaObs){
    gridMediaObs=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting)hydrateGridMedia(e.target);});
    },{rootMargin:'240px'});
  }
  wrap.querySelectorAll('.thinking-grid-item img[data-src], .thinking-grid-item video[data-src]').forEach(function(el){gridMediaObs.unobserve(el);});
  if(wrap.getAttribute('data-view')!=='grid')return;
  wrap.querySelectorAll('.thinking-grid-item:not([hidden]) img[data-src], .thinking-grid-item:not([hidden]) video[data-src]').forEach(function(el){gridMediaObs.observe(el);});
}
function applyFilters(){
  var on=anyFilterActive();
  filterBtns.forEach(function(b){var k=b.getAttribute('data-filter');b.setAttribute('aria-pressed',active[k]?'true':'false');});
  items.forEach(function(el){var k=el.getAttribute('data-kind');el.hidden=on&&!active[k];});
  months.forEach(function(section){section.hidden=!section.querySelector('.thinking-grid-item:not([hidden])');});
  try{localStorage.setItem(filterKey,JSON.stringify(active));}catch(e){}
  scanGridMedia();
}
function setView(v){
  wrap.setAttribute('data-view',v);
  viewBtns.forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-view-btn')===v?'true':'false');});
  localStorage.setItem('thinkingView',v);
  scanGridMedia();
}
if(viewBtns.length){
  setView(localStorage.getItem('thinkingView')||'list');
  viewBtns.forEach(function(b){b.addEventListener('click',function(){setView(b.getAttribute('data-view-btn'));});});
}
if(filterBtns.length){
  applyFilters();
  filterBtns.forEach(function(b){
    b.addEventListener('click',function(){
      var k=b.getAttribute('data-filter');
      if(active[k]){active[k]=false;}
      else{kinds.forEach(function(kind){active[kind]=(kind===k);});}
      applyFilters();
    });
  });
}else{scanGridMedia();}
}());</script>`;

const thinkingArchiveFoot = `      <footer class="site-footer">
        <p class="footer-row"><span>&copy; 2026 ${escHtml(site.author)} (<a href="/admin/">admin</a>)</span><a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="/feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingViewToggleScript}
${thinkingLightboxScript}
${thinkingDeleteLinkScript}
  </body>
</html>
`;

const writingPageHtml = `${archiveHead("Writing", sectionHeading("Writing", "h1"))}
      <ol class="post-list" reversed>
${postListAllHtml}
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
        <p>On summer holiday in Sifnos.</p>
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
          <h2 class="thinking-crumb-heading"><a href="/thinking/">Thinking</a></h2><span class="thinking-crumb-meta"><span class="thinking-crumb-sep" aria-hidden="true"> // </span><time class="thinking-crumb-date" datetime="${escHtml(iso)}" aria-current="page">${escHtml(dateLabel)}</time></span>
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
${thinkingLightboxScript}
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

// Grid view: same items, grouped by month, one square thumbnail per post
// (photo or video frame when present, else a small text-preview card).
function thinkingGridItemHtml(item, spotifyThumbnails = {}) {
  const slug = thinkingSlug(item);
  const href = `/thinking/${escHtml(slug)}/`;
  const label = escHtml(formatMbDate(item.date_published));
  const kind = thinkingGridKind(item, spotifyThumbnails);
  const { src, alt } = imageSrcAltFromHtml(item.content_html);
  if (kind === "photo" && src) {
    return `          <a class="thinking-grid-item thinking-grid-photo" data-kind="photo" href="${href}" aria-label="${label}">
            <img data-src="${escHtml(src)}" alt="${escHtml(alt || "Photo")}" loading="lazy" decoding="async" />
            ${thinkingGridBadgeHtml("photo")}
          </a>`;
  }
  if (kind === "video") {
    const videoSrc = videoSrcFromHtml(item.content_html);
    const posterSrc = `${videoSrc}${videoSrc.includes("#") ? "" : "#t=0.001"}`;
    return `          <a class="thinking-grid-item thinking-grid-video" data-kind="video" href="${href}" aria-label="${label}">
            <video class="thinking-grid-video-poster" muted playsinline preload="none" data-src="${escHtml(posterSrc)}" aria-hidden="true"></video>
            ${thinkingGridBadgeHtml("video")}
          </a>`;
  }
  if (kind === "spotify") {
    const spotifyEmbed = spotifyEmbedFromHtml(item.content_html);
    const cover = spotifyThumbnails[`${spotifyEmbed.type}:${spotifyEmbed.id}`];
    if (cover) {
      return `          <a class="thinking-grid-item thinking-grid-spotify" data-kind="spotify" href="${href}" aria-label="${label}">
            <img data-src="${escHtml(cover)}" alt="" loading="lazy" decoding="async" />
            ${thinkingGridBadgeHtml("spotify")}
          </a>`;
    }
  }
  if (kind === "youtube") {
    const youtubeId = youtubeIdFromHtml(item.content_html);
    return `          <a class="thinking-grid-item thinking-grid-youtube" data-kind="youtube" href="${href}" aria-label="${label}">
            <img data-src="${escHtml(youtubeThumbnailUrl(youtubeId))}" alt="" loading="lazy" decoding="async" />
            ${thinkingGridBadgeHtml("youtube")}
          </a>`;
  }
  const snippet =
    thinkingSnippet(stripHtml(stripMediaMarkup(item.content_html)), 280) || "(No text)";
  return `          <a class="thinking-grid-item thinking-grid-text" data-kind="${escHtml(kind)}" href="${href}" aria-label="${label}">
            <span class="thinking-grid-text-body">${escHtml(snippet)}</span>${thinkingGridBadgeHtml(kind)}
          </a>`;
}

function thinkingGridGroupsHtml(items, spotifyThumbnails = {}) {
  if (items.length === 0) {
    return `      <p style="color:var(--muted)">No posts yet.</p>`;
  }
  const groups = [];
  for (const item of items) {
    const label = monthLabelET(item.date_published);
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups
    .map(
      (g) => `      <section class="thinking-grid-month">
        <h2 class="thinking-grid-month-label">${escHtml(g.label)}</h2>
        <div class="thinking-grid">
${g.items.map((item) => thinkingGridItemHtml(item, spotifyThumbnails)).join("\n")}
        </div>
      </section>`
    )
    .join("\n");
}

const spotifyThumbnailsPath = join(root, "data/spotify-thumbnails.json");
let spotifyThumbnailCache = {};
if (existsSync(spotifyThumbnailsPath)) {
  try {
    spotifyThumbnailCache = JSON.parse(readFileSync(spotifyThumbnailsPath, "utf8"));
  } catch {
    spotifyThumbnailCache = {};
  }
}

const spotifyKeysNeeded = new Set();
for (const item of microblogItems) {
  const embed = spotifyEmbedFromHtml(item.content_html);
  if (embed) spotifyKeysNeeded.add(`${embed.type}:${embed.id}`);
}

const missingSpotifyThumbnails = [...spotifyKeysNeeded].filter((key) => !(key in spotifyThumbnailCache));
if (missingSpotifyThumbnails.length > 0) {
  console.log(`Looking up ${missingSpotifyThumbnails.length} Spotify thumbnail(s)…`);
  let fetchedAny = false;
  for (const key of missingSpotifyThumbnails) {
    const [type, id] = key.split(":");
    const thumb = await fetchSpotifyThumbnail(type, id);
    if (thumb) {
      spotifyThumbnailCache[key] = thumb;
      fetchedAny = true;
    } else {
      console.log(`  no thumbnail for Spotify ${key} — will retry next build`);
    }
  }
  if (fetchedAny) {
    writeFileSync(spotifyThumbnailsPath, `${JSON.stringify(spotifyThumbnailCache, null, 2)}\n`);
  }
}

const thinkingGridHtml = thinkingGridGroupsHtml(microblogItems, spotifyThumbnailCache);

const THINKING_VIEW_ICONS = {
  list: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="3" rx="1" fill="currentColor"/><rect x="2" y="8.5" width="16" height="3" rx="1" fill="currentColor"/><rect x="2" y="14" width="16" height="3" rx="1" fill="currentColor"/></svg>`,
  grid: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="2" y="11" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="11" width="7" height="7" rx="1" fill="currentColor"/></svg>`,
};

const THINKING_FILTER_LABELS = {
  photo: "Photos",
  video: "Videos",
  youtube: "YouTube",
  spotify: "Spotify",
  audio: "Audio",
  text: "Text",
};

const thinkingGridFiltersHtml = `        <div class="thinking-grid-filters" role="group" aria-label="Filter grid by type">
${THINKING_GRID_KINDS.map(
  (kind) =>
    `          <button type="button" class="thinking-filter-btn thinking-filter-btn--${kind}" data-filter="${kind}" aria-pressed="false" aria-label="${THINKING_FILTER_LABELS[kind]}">${THINKING_MEDIA_ICONS[kind]}</button>`
).join("\n")}
        </div>`;

const thinkingArchiveToolbarHtml = `      <div class="thinking-archive-toolbar">
        <div class="thinking-view-toggle" role="group" aria-label="Switch view">
        <button type="button" class="thinking-view-btn" data-view-btn="list" aria-pressed="true" aria-label="List view">${THINKING_VIEW_ICONS.list}</button>
        <button type="button" class="thinking-view-btn" data-view-btn="grid" aria-pressed="false" aria-label="Grid view">${THINKING_VIEW_ICONS.grid}</button>
        </div>
${thinkingGridFiltersHtml}
      </div>`;

// Reading grid: a storefront-style catalog — bigger cover art, two columns,
// grouped by month like the Thinking grid, title underneath linking out to
// the Bookshop.org page.
function readingMonthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return "";
  const [, y, mo] = m;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(y), Number(mo) - 1, 1))
  );
}

function readingGridItemHtml(r) {
  const cover = r.cover_url || readingCoverCache[r.url];
  const coverInner = cover
    ? `<img src="${escHtml(cover)}" alt="${escHtml(r.title)}" loading="lazy" decoding="async" />`
    : `<span class="reading-grid-cover-fallback">${escHtml(r.title)}</span>`;
  return `          <a class="reading-grid-item" href="${escHtml(r.url)}" target="_blank" rel="noopener noreferrer">
            <span class="reading-grid-cover">${coverInner}</span>
            <span class="reading-grid-title">${escHtml(r.title)}</span>
          </a>`;
}

function readingGridGroupsHtml(items) {
  if (items.length === 0) {
    return `      <p style="color:var(--muted)">No books yet.</p>`;
  }
  const groups = [];
  for (const item of items) {
    const label = readingMonthLabel(item.ym);
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups
    .map(
      (g) => `      <section class="reading-grid-month">
        <h2 class="reading-grid-month-label">${escHtml(g.label)}</h2>
        <div class="reading-grid">
${g.items.map(readingGridItemHtml).join("\n")}
        </div>
      </section>`
    )
    .join("\n");
}

const readingGridHtml = readingGridGroupsHtml(orderedReading);

const readingViewToggleHtml = `      <div class="reading-view-toggle" role="group" aria-label="Switch view">
        <button type="button" class="reading-view-btn" data-view-btn="list" aria-pressed="true" aria-label="List view">${THINKING_VIEW_ICONS.list}</button>
        <button type="button" class="reading-view-btn" data-view-btn="grid" aria-pressed="false" aria-label="Grid view">${THINKING_VIEW_ICONS.grid}</button>
      </div>`;

const readingViewToggleScript = `    <script>(function(){var wrap=document.querySelector('.reading-views');var btns=document.querySelectorAll('.reading-view-btn');if(!wrap||!btns.length)return;function set(v){wrap.setAttribute('data-view',v);btns.forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-view-btn')===v?'true':'false');});localStorage.setItem('readingView',v);}set(localStorage.getItem('readingView')||'list');btns.forEach(function(b){b.addEventListener('click',function(){set(b.getAttribute('data-view-btn'));});});}());</script>`;

const readingArchiveFoot = `      <footer class="site-footer">
        <p class="footer-row"><span>&copy; 2026 ${escHtml(site.author)} (<a href="/admin/">admin</a>)</span><a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="/feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${readingViewToggleScript}
${thinkingLightboxScript}
    <script>(function(){var BATCH=10;var list=document.querySelector('.post-list');if(!list)return;var items=list.querySelectorAll('li');if(items.length<=BATCH)return;for(var i=BATCH;i<items.length;i++)items[i].hidden=true;var shown=BATCH;var sentinel=document.createElement('div');document.body.appendChild(sentinel);var obs=new IntersectionObserver(function(e){if(!e[0].isIntersecting)return;var next=Math.min(shown+BATCH,items.length);for(var i=shown;i<next;i++)items[i].hidden=false;shown=next;if(shown>=items.length)obs.disconnect();},{rootMargin:'0px'});obs.observe(sentinel);}());</script>
  </body>
</html>
`;

const readingPageHtml = `${archiveHead("Reading", sectionHeading("Reading", "h1"))}
    <div class="reading-views" data-view="list">
${readingViewToggleHtml}
      <ol class="post-list reading-list" reversed>
${readingAllHtml}
      </ol>
      <div class="reading-grid-wrap">
${readingGridHtml}
      </div>
    </div>
${readingArchiveFoot}`;

const microblogPageHtml = `${archiveHead("Thinking", sectionHeading("Thinking", "h1"))}
    <div class="thinking-views" data-view="list">
${thinkingArchiveToolbarHtml}
      <div class="microblog-feed">
${microblogEntriesHtml}
      </div>
      <div class="thinking-grid-wrap">
${thinkingGridHtml}
      </div>
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
