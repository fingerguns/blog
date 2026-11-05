/**
 * Rebuilds index.html, feed.xml, robots.txt, sitemap.xml, and post pages.
 * Reads content from Cloudflare D1 when configured, else data/posts.json.
 * Run from project root: node scripts/build.mjs
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { d1Configured, d1Query, loadBlogDataFromD1 } from "./d1-client.mjs";
import { escHtml, escXml } from "./lib/html.mjs";
import { mergeSectionHints } from "./lib/section-hints.mjs";
import { mergeReadingTabIntros } from "./lib/reading-tab-intros.mjs";
import { thinkingGridThumbUrl, upgradeSpotifyImageUrl, videoPosterKeyFromVideoUrl } from "./lib/media-url.mjs";
import { fetchLinkUnfurl } from "./lib/link-unfurl.mjs";
import { LINKLOG_TAG_LABELS } from "./lib/linklog-tags.mjs";
import { mapWithConcurrency } from "./lib/concurrency.mjs";
import { unfurlableUrls, singlePhotoUrl } from "./lib/thinking-html.mjs";
import {
  firstImageFromHtml,
  hasThinking,
  imageSrcAltFromHtml,
  monthLabelET,
  renderThinkingHtml as renderThinkingHtmlShared,
  spotifyEmbedFromHtml,
  stripMediaMarkup,
  THINKING_GRID_KINDS,
  THINKING_MEDIA_ICONS,
  thinkingContentHtmlFromRow as thinkingContentHtmlFromRowShared,
  thinkingGridItemHtml as thinkingGridItemHtmlShared,
  thinkingGridKind,
  thinkingGridMonthHtml,
  thinkingItemFromRow,
  thinkingListEntryHtml,
  thinkingPostMetaHtml,
  thinkingSlug,
  thinkingSnippet,
  thinkingUnfurlsHtml as thinkingUnfurlsHtmlShared,
  videoSrcFromHtml,
} from "./lib/render/thinking.mjs";
import {
  formatMbDate,
  linkDomain,
  safeSlug,
  stripHtml,
  toETDate,
} from "./lib/render/format.mjs";
import {
  readingGridItemHtml as readingGridItemHtmlShared,
  readingGridMonthHtml,
  readingMonthLabel,
  renderLinklogArchiveItem as renderLinklogArchiveItemShared,
  renderLinklogItem,
  renderPostItem,
  renderReadingFavoriteItem as renderReadingFavoriteItemShared,
  renderReadingItem as renderReadingItemShared,
} from "./lib/render/lists.mjs";
import {
  LIVE_TEMPLATE_PATHS,
  LIVE_TOKENS,
  postPermalinkParts,
  thinkingPermalinkParts,
} from "./lib/render/pages.mjs";
import { bookshopAffiliateUrl, bookshopAffiliateIdFromEnv, isbnFromBookshopUrl } from "./lib/bookshop-affiliate.mjs";
import {
  buildLatestCoverLookup,
  coverForReadingEntryFrom,
  coverFromCacheFor,
  inheritLatestCover,
} from "./lib/reading-cover-inherit.mjs";
import {
  applyReadingFavoritesOverrides,
  loadReadingFavoritesOverrides,
} from "./lib/reading-favorites-overrides.mjs";
import { distanceTextFromSteps } from "./lib/steps-distance.mjs";
import {
  CACHE_NAMESPACES,
  cacheKeysToLookUp,
  loadBuildCache,
  saveBuildCache,
} from "./lib/build-cache.mjs";
import { MAX_TEXT, truncate as truncateSearchText } from "./lib/search.mjs";
import { groupThinkingByPlace, placesBounds } from "./lib/thinking-map.mjs";
import {
  geocodeNeighborhoodLabels,
  haversineKm,
  MAX_REFERENCE_DRIFT_KM,
} from "./lib/geocode-neighborhood.mjs";
import { referencePointsFromRows, LABEL_REFERENCE_SQL } from "./lib/label-references.mjs";
import { jsonForScript } from "./lib/script-json.mjs";
import { findBrokenImages, formatBrokenImages } from "./lib/validate-images.mjs";
import { fetchImageSize } from "./lib/image-size.mjs";
import { DARK_MAP_RECOLOR_JS } from "./lib/map-dark.mjs";
import {
  CONTENT_KIND,
  datedItemSort,
  datetimeSort,
  liveKey,
  liveListAttrs,
  monthKeyET,
  readingSort,
  watermarkMetaHtml,
  withLiveAttrs,
} from "./lib/live-changes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, process.env.BUILD_OUT_DIR || "dist");
const cssV = `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;

// Live publishing watermark: the newest content_changes id this build has
// seen, stamped on every generated page. Read *before* any content, so a
// change that lands mid-build is either in the page or above the watermark
// — never neither. The overlay in the Worker applies everything above it;
// see scripts/lib/live-changes.mjs and worker/live-overlay.mjs.
let liveWatermark = 0;
if (d1Configured()) {
  try {
    const rows = await d1Query("SELECT COALESCE(MAX(id), 0) AS id FROM content_changes");
    liveWatermark = Number(rows[0]?.id) || 0;
  } catch (err) {
    console.warn(`Live watermark: could not read content_changes — ${err.message}`);
  }
}
const liveWatermarkMeta = `    ${watermarkMetaHtml(liveWatermark)}`;

let data;
if (d1Configured()) {
  console.log("Loading content from D1…");
  data = await loadBlogDataFromD1();
} else {
  console.log("D1 not configured — loading data/posts.json");
  data = JSON.parse(readFileSync(join(root, "data/posts.json"), "utf8"));
  const readingFavoritesPath = join(root, "data/reading-favorites.json");
  if (existsSync(readingFavoritesPath)) {
    try {
      data.readingFavorites = JSON.parse(readFileSync(readingFavoritesPath, "utf8"));
    } catch {
      data.readingFavorites = [];
    }
  } else {
    data.readingFavorites = [];
  }
  data.readingGenres = [];
}

const {
  site,
  thinking,
  thinkingPosts = [],
  posts,
  reading,
  readingFavorites: readingFavoritesRaw = [],
  readingGenres: readingGenresRaw = [],
  linklog,
  links,
  optionalColophon,
  sectionHints,
  readingTabIntros,
  ouraSteps = null,
} = data;

const SECTION_HINTS = mergeSectionHints(sectionHints);
const READING_TAB_INTROS = mergeReadingTabIntros(readingTabIntros);

const base = site.url.replace(/\/$/, "");

// What the shared renderers in scripts/lib/render/ read instead of this
// file's scope. Each cache is filled in below as the build loads it; the live
// overlay in the Worker builds the same object from D1.
const renderCtx = {
  base,
  thinkingUnfurls: {},
  spotifyThumbnails: {},
  videoPosters: {},
  photoSize: (url) => thinkingPhotoSize(url),
};
const pageCtx = { base, siteTitle: site.title };
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

const socialsToggleScript = `    <script>(function(){var btn=document.querySelector(".socials-toggle");if(!btn)return;var list=document.getElementById("socials-sublist");btn.addEventListener("click",function(){var open=btn.getAttribute("aria-expanded")==="true";btn.setAttribute("aria-expanded",open?"false":"true");list.hidden=open;});}());</script>`;

const thinkingLightboxScript = `    <script>(function(){
  var overlay=null,imgEl=null,counterEl=null,urls=[],index=0;
  var touchX=0,touchY=0,touchT=0,swiping=false;
  var SWIPE_MIN=40,ZOOM=2;
  var zoomed=false,scale=1,tx=0,ty=0,originX=50,originY=50;
  var panning=false,panStartX=0,panStartY=0,panStartTx=0,panStartTy=0;
  var imgTap={active:false,mx:0,my:0,t:0,moved:false};
  function applyTransform(){
    imgEl.style.transformOrigin=originX+"% "+originY+"%";
    imgEl.style.transform="translate("+tx+"px,"+ty+"px) scale("+scale+")";
  }
  function resetZoom(){
    zoomed=false;scale=1;tx=0;ty=0;originX=50;originY=50;panning=false;
    imgEl.style.transform="";
    imgEl.style.transformOrigin="";
    overlay.classList.remove("thinking-lightbox--zoomed","thinking-lightbox--panning");
  }
  function zoomPoint(clientX,clientY){
    var r=imgEl.getBoundingClientRect();
    if(!r.width||!r.height)return;
    originX=Math.max(0,Math.min(100,((clientX-r.left)/r.width)*100));
    originY=Math.max(0,Math.min(100,((clientY-r.top)/r.height)*100));
    var nw=imgEl.naturalWidth,nh=imgEl.naturalHeight;
    var fitScale=1;
    if(nw&&nh&&r.width&&r.height){
      fitScale=Math.min(Math.max(nw/r.width,nh/r.height),4);
    }
    scale=Math.min(ZOOM,fitScale);
    zoomed=true;
    tx=0;ty=0;
    overlay.classList.add("thinking-lightbox--zoomed");
    applyTransform();
  }
  function toggleZoom(e){
    if(zoomed){resetZoom();return;}
    var x=e.clientX,y=e.clientY;
    if(x==null&&e.changedTouches&&e.changedTouches[0]){
      x=e.changedTouches[0].clientX;y=e.changedTouches[0].clientY;
    }
    if(x==null)return;
    zoomPoint(x,y);
  }
  function startPan(clientX,clientY){
    if(!zoomed)return;
    panning=true;
    panStartX=clientX;panStartY=clientY;panStartTx=tx;panStartTy=ty;
    overlay.classList.add("thinking-lightbox--panning");
  }
  function movePan(clientX,clientY){
    if(!panning)return;
    tx=panStartTx+(clientX-panStartX);
    ty=panStartTy+(clientY-panStartY);
    applyTransform();
  }
  function endPan(){
    if(!panning)return;
    panning=false;
    overlay.classList.remove("thinking-lightbox--panning");
  }
  function ensure(){
    if(overlay)return;
    overlay=document.createElement("div");
    overlay.className="thinking-lightbox";
    overlay.hidden=true;
    overlay.setAttribute("role","dialog");
    overlay.setAttribute("aria-modal","true");
    overlay.setAttribute("aria-label","Photo gallery");
    overlay.innerHTML='<button type="button" class="thinking-lightbox-prev" aria-label="Previous photo">‹</button><figure class="thinking-lightbox-figure"><img alt="" draggable="false" /><figcaption class="thinking-lightbox-counter"></figcaption></figure><button type="button" class="thinking-lightbox-next" aria-label="Next photo">›</button>';
    document.body.appendChild(overlay);
    imgEl=overlay.querySelector("img");
    counterEl=overlay.querySelector(".thinking-lightbox-counter");
    overlay.querySelector(".thinking-lightbox-prev").addEventListener("click",function(e){e.stopPropagation();show(index-1);});
    overlay.querySelector(".thinking-lightbox-next").addEventListener("click",function(e){e.stopPropagation();show(index+1);});
    // No close button: a click or tap anywhere but the photo or the arrows closes.
    // On phones the figure spans the screen, so a tap beside the photo lands on
    // it, not the overlay; treat it as background too.
    overlay.addEventListener("click",function(e){if(!e.target.closest("img, button"))close();});
    imgEl.addEventListener("click",function(e){
      e.stopPropagation();
      if(window.matchMedia("(hover: hover) and (pointer: fine)").matches)toggleZoom(e);
    });
    imgEl.addEventListener("touchstart",function(e){
      if(!e.touches||e.touches.length!==1)return;
      imgTap.active=true;imgTap.moved=false;
      imgTap.mx=e.touches[0].clientX;imgTap.my=e.touches[0].clientY;imgTap.t=Date.now();
      if(zoomed)startPan(imgTap.mx,imgTap.my);
    },{passive:true});
    imgEl.addEventListener("touchmove",function(e){
      if(!imgTap.active||!e.touches||!e.touches.length)return;
      var dx=e.touches[0].clientX-imgTap.mx,dy=e.touches[0].clientY-imgTap.my;
      if(Math.abs(dx)>8||Math.abs(dy)>8)imgTap.moved=true;
      if(zoomed&&panning){
        if(e.cancelable)e.preventDefault();
        movePan(e.touches[0].clientX,e.touches[0].clientY);
      }
    },{passive:false});
    imgEl.addEventListener("touchend",function(e){
      if(!imgTap.active)return;
      imgTap.active=false;
      if(zoomed){
        endPan();
        if(!imgTap.moved)toggleZoom(e);
        return;
      }
      var t=e.changedTouches&&e.changedTouches[0];
      if(!t)return;
      if(!imgTap.moved&&Date.now()-imgTap.t<400){
        toggleZoom(e);
        e.preventDefault();
      }
    },{passive:false});
    imgEl.addEventListener("mousedown",function(e){
      if(e.button!==0||!zoomed)return;
      e.preventDefault();
      startPan(e.clientX,e.clientY);
    });
    document.addEventListener("mousemove",function(e){
      if(!panning)return;
      e.preventDefault();
      movePan(e.clientX,e.clientY);
    });
    document.addEventListener("mouseup",function(){endPan();});
    document.addEventListener("keydown",function(e){
      if(overlay.hidden)return;
      if(e.key==="Escape"){if(zoomed){resetZoom();e.preventDefault();return;}close();}
      else if(!zoomed&&e.key==="ArrowLeft")show(index-1);
      else if(!zoomed&&e.key==="ArrowRight")show(index+1);
    });
    overlay.addEventListener("touchstart",function(e){
      if(overlay.hidden||zoomed||urls.length<2||!e.touches||!e.touches.length)return;
      touchX=e.touches[0].clientX;
      touchY=e.touches[0].clientY;
      touchT=Date.now();
      swiping=true;
    },{passive:true});
    overlay.addEventListener("touchmove",function(e){
      if(!swiping||zoomed||!e.touches||!e.touches.length)return;
      var dx=e.touches[0].clientX-touchX;
      var dy=e.touches[0].clientY-touchY;
      if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>12){
        if(e.cancelable)e.preventDefault();
      }
    },{passive:false});
    overlay.addEventListener("touchend",function(e){
      if(!swiping||zoomed)return;
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
    overlay.addEventListener("touchcancel",function(){swiping=false;imgTap.active=false;endPan();},{passive:true});
  }
  function show(i){
    if(!urls.length)return;
    resetZoom();
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
    resetZoom();
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
          var meta=entry.querySelector(".post-meta");
          if(!meta)meta=entry.querySelector("time.post-date");
          if(meta){
            var sep=document.createElement("span");
            sep.className="post-meta-sep";
            sep.setAttribute("aria-hidden","true");
            sep.textContent="·";
            meta.appendChild(sep);
            meta.appendChild(a);
          }
        });
      }
      if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attachDeleteLinks);else attachDeleteLinks();
      window.addEventListener("pageshow",attachDeleteLinks);
    }());</script>`;

// Writing post pages carry "edit" and "delete" links next to the reading time,
// injected client-side only when an admin session is in this browser's storage
// — the same session check the Thinking delete link uses. The page itself is
// static and public; nothing here is a permission grant, the Worker still
// checks the password on fetch-post/edit-post/delete-post.
const postAdminLinksScript = `    <script>(function(){
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
      function sep(){
        var s=document.createElement("span");
        s.setAttribute("aria-hidden","true");
        s.textContent=" \u00b7 ";
        return s;
      }
      function attachAdminLinks(){
        if(!loadPw())return;
        var article=document.querySelector("article.post[data-slug]");
        if(!article)return;
        if(article.querySelector("a.post-admin-edit"))return;
        var slug=article.getAttribute("data-slug");
        if(!slug)return;
        var meta=article.querySelector(":scope > time .reading-time");
        if(!meta)return;
        var edit=document.createElement("a");
        edit.className="post-admin-edit";
        edit.href="/admin/?post="+encodeURIComponent(slug);
        edit.textContent="edit";
        var unpub=document.createElement("a");
        unpub.className="post-admin-unpublish";
        unpub.href="?unpublish";
        unpub.textContent="unpublish";
        var del=document.createElement("a");
        del.className="post-admin-delete";
        del.href="?delete";
        del.textContent="delete";
        meta.appendChild(sep());
        meta.appendChild(edit);
        meta.appendChild(sep());
        meta.appendChild(unpub);
        meta.appendChild(sep());
        meta.appendChild(del);
      }
      if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attachAdminLinks);else attachAdminLinks();
      window.addEventListener("pageshow",attachAdminLinks);
    }());</script>`;

const postAdminActionPanelHtml = `      <div id="post-admin-panel" class="post-delete-panel" hidden>
        <p class="post-delete-signin" hidden>Sign in at <a href="/admin/">admin</a> on this device, then open this page again.</p>
        <div class="post-delete-confirm" hidden>
          <p class="post-delete-lead"><em class="post-admin-lead"></em></p>
          <p class="post-delete-actions">
            <a href="#" class="post-delete-go"></a>
            ·
            <a class="post-delete-cancel" href="#">Cancel</a>
          </p>
          <p class="post-delete-status" hidden></p>
        </div>
      </div>`;

// ?delete and ?unpublish both confirm here, in the page, rather than in a
// pop-up — the same flow the Thinking archive uses, so it works on a phone.
const postAdminActionScript = `    <script>(function(){
      var API_URL=(function(){var h=location.hostname;if(h==="localhost"||h==="127.0.0.1")return"https://rommy-blog-admin.fingerguns.workers.dev";return"/api/admin";})();
      var SESSION_KEY="admin_session";
      var SESSION_TTL=${30 * 24 * 60 * 60 * 1000};
      var MODES={
        "delete":{
          action:"delete-post",
          lead:"Delete this post and its version history from rommy.blog? Cross-posts already sent to Micro.blog, Bluesky, or Mastodon stay up \u2014 take those down yourself.",
          go:"Delete permanently?",
          working:"Deleting\u2026",
          done:"Deleted. Returning to the archive\u2026",
          fail:"Could not delete.",
          next:"/writing/"
        },
        "unpublish":{
          action:"unpublish-post",
          lead:"Unpublish this post? It comes down from rommy.blog and goes back to Drafts in the admin, keeping its version history, so you can edit and publish it again. Cross-posts already sent stay up.",
          go:"Unpublish?",
          working:"Unpublishing\u2026",
          done:"Unpublished. It's in Drafts \u2014 opening the admin\u2026",
          fail:"Could not unpublish.",
          next:"/admin/"
        }
      };
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
      function initActionPage(){
        var mode=null;
        if(/[?&]delete(?:=|$)/.test(location.search))mode=MODES["delete"];
        else if(/[?&]unpublish(?:=|$)/.test(location.search))mode=MODES["unpublish"];
        if(!mode)return;
        var article=document.querySelector("article.post[data-slug]");
        var panel=document.getElementById("post-admin-panel");
        if(!article||!panel)return;
        var slug=article.getAttribute("data-slug");
        var signin=panel.querySelector(".post-delete-signin");
        var confirm=panel.querySelector(".post-delete-confirm");
        var status=panel.querySelector(".post-delete-status");
        var cancel=panel.querySelector(".post-delete-cancel");
        var lead=panel.querySelector(".post-admin-lead");
        var go=panel.querySelector(".post-delete-go");
        panel.hidden=false;
        try{panel.scrollIntoView({behavior:"smooth",block:"nearest"});}catch(e){}
        if(cancel)cancel.href=location.pathname;
        if(lead)lead.textContent=mode.lead;
        if(go)go.textContent=mode.go;
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
          if(status){status.hidden=false;status.textContent=mode.working;status.className="post-delete-status";}
          (async function(){
            try{
              var res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:mode.action,slug:slug})});
              var data={};
              try{data=await res.json();}catch(err){}
              if(!res.ok)throw new Error(data.error||("Failed (HTTP "+res.status+")"));
              if(status){status.textContent=mode.done;status.className="post-delete-status ok";}
              setTimeout(function(){location.href=mode.next;},900);
            }catch(err){
              if(status){status.textContent=err&&err.message?err.message:mode.fail;status.className="post-delete-status err";}
              go.removeAttribute("aria-disabled");
            }
          })();
        });
      }
      if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initActionPage);else initActionPage();
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
    return typeof data?.thumbnail_url === "string"
      ? upgradeSpotifyImageUrl(data.thumbnail_url)
      : null;
  } catch {
    return null;
  }
}

const THINKING_FILTER_PATH = {
  photo: "images",
  video: "videos",
  audio: "audio",
  youtube: "youtube",
  spotify: "music",
  text: "text",
};
const THINKING_PATH_FILTER = Object.fromEntries(
  Object.entries(THINKING_FILTER_PATH).map(([kind, segment]) => [segment, kind])
);

function thinkingContentHtmlFromRow(p, options = {}) {
  return thinkingContentHtmlFromRowShared(p, renderCtx, options);
}

function renderThinkingHtml(thinking) {
  return renderThinkingHtmlShared(thinking, renderCtx);
}

function toIsoZ(p) {
  const d = p.datetime ? new Date(p.datetime) : new Date(`${p.date}T12:00:00.000Z`);
  return d.toISOString();
}

// A Writing post page, its varying slots filled from postPermalinkParts().
// The build also writes it once with LIVE_TOKENS in every slot, as the
// template the live overlay fills (see scripts/lib/render/pages.mjs).
function postPageHtml(v) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${liveWatermarkMeta}
    <title>${v.title}</title>
    <script>(function(){var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t||'dark');}());</script>
${v.og}
    <link rel="icon" href="../../favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="../../favicon.png" />
    <link rel="preload" href="/media/fonts/abc-areal/v1/ABCArealVariable.woff2" as="font" type="font/woff2" crossorigin />
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
    <article class="post" data-slug="${v.slug}">
      <a class="post-back" href="../../index.html" aria-label="Home">←</a>
      <h1>${v.heading}</h1>
      <time datetime="${v.displayDate}"><span>${v.displayDate}</span><span class="reading-time">${v.readMins} min read</span></time>
      <div class="body">
        ${v.body}
      </div>
${postAdminActionPanelHtml}
      <section class="webmentions" id="webmentions" hidden aria-labelledby="wm-heading"></section>
      <script>(function(){
        var url=${v.postUrlJson};
        // webmention.io relays attacker-controlled h-card fields (author.url,
        // m.url) — only ever assign them as href if they're http(s), so a
        // crafted javascript: URI in a webmention can't run when clicked.
        function safeHref(u){return /^https?:\/\//i.test(String(u||''))?u:'#';}
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
                a.href=safeHref((m.author&&m.author.url)||m.url);a.target='_blank';a.rel='noopener';
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
                var a=document.createElement('a');a.href=safeHref((m.author&&m.author.url)||m.url);a.target='_blank';a.rel='noopener';a.textContent=(m.author&&m.author.name)||'Anonymous';meta.appendChild(a);
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
${v.pager}
      <a class="back-to-top" href="#">↑ Top</a>
      <footer class="site-footer">
        <p class="footer-row footer-row-toggle"><span>&copy; 2026 ${escHtml(site.author)}</span><a href="#" class="theme-toggle" id="theme-toggle" role="button"></a><a href="/search/" class="footer-icon" aria-label="Search" title="Search"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/></svg></a></p>
        <p class="footer-row"><span>Subscribe via <a href="../../feed.xml" type="application/atom+xml" class="footer-icon" aria-label="Atom feed" title="Atom feed"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg></a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';b.innerHTML=t==='dark'?'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>':'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';b.setAttribute('aria-label',l);b.title=l;localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'dark');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingLightboxScript}
${postAdminLinksScript}
${postAdminActionScript}
  </body>
</html>
`;
}

const latest = ordered[0];
const feedUpdated = latest ? toIsoZ(latest) : new Date("2020-01-01T12:00:00.000Z").toISOString();

const MAX_PER_SECTION = 5;

// Single-photo Thinking notes: a landscape photo renders at the column's full
// width in its own aspect ratio, while portrait and square ones keep the square
// crop. D1 doesn't store dimensions, so the build reads them from each photo's
// header (a ranged GET of the first 64 KB) once and keeps them in build_cache.
// A miss is cached as `false` and the photo simply stays square; a photo's
// size never changes, so nothing is retried.
const thinkingPhotoSizeCache = await loadBuildCache(CACHE_NAMESPACES.THINKING_PHOTO_SIZES);
{
  const urls = new Set();
  for (const p of [...thinkingPosts, thinking]) {
    if (!p) continue;
    const url = singlePhotoUrl(p.media_url, p.media_type, base, p.media_urls || []);
    if (url) urls.add(url);
  }
  const missing = cacheKeysToLookUp(thinkingPhotoSizeCache, urls);
  if (missing.length > 0) {
    console.log(`Measuring ${missing.length} Thinking photo(s)…`);
    await mapWithConcurrency(missing, 6, async (url) => {
      thinkingPhotoSizeCache[url] = (await fetchImageSize(url)) || false;
    });
  }
}
await saveBuildCache(CACHE_NAMESPACES.THINKING_PHOTO_SIZES, thinkingPhotoSizeCache);

function thinkingPhotoSize(url) {
  return thinkingPhotoSizeCache[url] || null;
}

// Thinking posts from D1 (populated by the admin Worker on every post/delete)
const microblogItems = thinkingPosts.map((p) => thinkingItemFromRow(p, renderCtx));

// Thinking link cards: every link in a note (YouTube and Spotify aside, which
// already render as players) gets an Open Graph preview card beneath the note,
// on the homepage, the archive, and the permalink. The note's text is rendered
// fresh from D1 on every build, so this covers old notes and new ones alike:
// any URL not yet in the cache is fetched here, and a new note's links are
// fetched on the rebuild the Worker triggers after posting. A miss is cached
// as `false` and not retried, as on Sharing — a site that blocks scrapers
// would otherwise cost a timeout on every build. The cards are kept out of
// content_html on purpose: the grid, search, og:image and og:description all
// read that string, and a linked page's image or blurb must not become the
// note's own.
const thinkingUnfurlCache = await loadBuildCache(CACHE_NAMESPACES.THINKING_UNFURLS);
{
  const urls = new Set();
  for (const p of thinkingPosts) for (const u of unfurlableUrls(p.text)) urls.add(u);
  for (const u of unfurlableUrls(thinking?.text)) urls.add(u);
  const missing = cacheKeysToLookUp(thinkingUnfurlCache, urls);
  if (missing.length > 0) {
    console.log(`Fetching ${missing.length} link preview(s) for Thinking…`);
    await mapWithConcurrency(missing, 6, async (url) => {
      thinkingUnfurlCache[url] = (await fetchLinkUnfurl(url)) || false;
    });
  }
}
await saveBuildCache(CACHE_NAMESPACES.THINKING_UNFURLS, thinkingUnfurlCache);

renderCtx.thinkingUnfurls = thinkingUnfurlCache;

/** Preview cards for the links in a note's text; "" when there are none. */
function thinkingUnfurlsHtml(text) {
  return thinkingUnfurlsHtmlShared(text, renderCtx);
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

function sortReadingByYmDesc(a, b) {
  const ay = String(a.ym || "");
  const by = String(b.ym || "");
  if (ay !== by) return by.localeCompare(ay);
  const aAt = a.added_at ? new Date(a.added_at).getTime() : 0;
  const bAt = b.added_at ? new Date(b.added_at).getTime() : 0;
  if (aAt !== bAt) return bAt - aAt;
  return (b.id || 0) - (a.id || 0);
}

const orderedReading = [...(reading || [])].sort(sortReadingByYmDesc);
const readingAffiliateUrlByCanonical = new Map();
const readingLinkUrl = (r) => readingAffiliateUrlByCanonical.get(r.url) || bookshopAffiliateUrl(r.url);
const renderReadingItem = (r) => renderReadingItemShared(r, readingLinkUrl(r));

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
const readingCoverCache = await loadBuildCache(CACHE_NAMESPACES.READING_COVERS);

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

function coverFromCache(url) {
  return coverFromCacheFor(url, readingCoverCache);
}

function coverForReadingEntry(r) {
  return coverForReadingEntryFrom(r, readingCoverCache);
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

async function resolveIsbnForReading(title, url) {
  const fromUrl = isbnFromBookshopUrl(url);
  if (fromUrl) return fromUrl;

  const byTitle = await openLibraryJson(
    `/search.json?limit=1&fields=isbn,title&q=${encodeURIComponent(title)}`
  );
  const hit = byTitle?.docs?.[0];
  if (!hit?.isbn?.length || !titlesMatch(title, hit.title)) return null;
  return hit.isbn.find((value) => String(value).length === 13) || hit.isbn[0];
}

// Entries with a manually-chosen cover_url (picked in the admin from the
// Open Library / Apple Books / Google Books candidates) skip the automatic
// lookup entirely — that choice always wins.
const missingCovers = orderedReading.filter(
  (r) => r.url && !r.cover_url && !coverFromCache(r.url)
);
if (missingCovers.length > 0) {
  console.log(`Looking up ${missingCovers.length} book cover(s) via Open Library…`);
  await mapWithConcurrency(missingCovers, 6, async (r) => {
    const cover = await fetchBookCover(r.title, r.url);
    if (cover) {
      readingCoverCache[r.url] = cover;
    } else {
      console.log(`  no cover found for "${r.title}" — will retry next build`);
    }
  });
  await saveBuildCache(CACHE_NAMESPACES.READING_COVERS, readingCoverCache);
}

const bookshopAffiliateId = bookshopAffiliateIdFromEnv();
for (const r of orderedReading) {
  let affiliate = bookshopAffiliateUrl(r.url, bookshopAffiliateId);
  if (affiliate === r.url && /bookshop\.org/i.test(r.url || "")) {
    const isbn = await resolveIsbnForReading(r.title, r.url);
    if (isbn) affiliate = `https://bookshop.org/a/${bookshopAffiliateId}/${isbn}`;
  }
  readingAffiliateUrlByCanonical.set(r.url, affiliate);
}

let readingFavorites = Array.isArray(readingFavoritesRaw) ? readingFavoritesRaw : [];
if (!readingFavorites.length && !d1Configured()) {
  readingFavorites = loadReadingFavoritesOverrides(root);
}
if (!Array.isArray(readingFavorites)) readingFavorites = [];

const readingFavoritesOverrides = loadReadingFavoritesOverrides(root);
readingFavorites = applyReadingFavoritesOverrides(readingFavorites, readingFavoritesOverrides);

const sortReadingFavoritesByTitle = (a, b) =>
  String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });

const orderedReadingFavorites = [...readingFavorites]
  .filter((r) => r && r.title && r.url)
  .sort(sortReadingFavoritesByTitle);

const readingGenres = Array.isArray(readingGenresRaw)
  ? [...readingGenresRaw].sort((a, b) =>
      String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" })
    )
  : [];

for (const r of orderedReadingFavorites) {
  if (!r.cover_url || !r.url) continue;
  readingCoverCache[r.url] = r.cover_url;
  const isbn = isbnFromBookshopUrl(r.url);
  if (isbn) {
    readingCoverCache[`https://bookshop.org/a/${bookshopAffiliateId}/${isbn}`] = r.cover_url;
  }
}

const readingFavoritesAffiliateUrlByCanonical = new Map();
const readingFavoriteLinkUrl = (r) =>
  readingFavoritesAffiliateUrlByCanonical.get(r.url) || bookshopAffiliateUrl(r.url, bookshopAffiliateId);

for (const r of orderedReadingFavorites) {
  let affiliate = bookshopAffiliateUrl(r.url, bookshopAffiliateId);
  if (affiliate === r.url && /bookshop\.org/i.test(r.url || "")) {
    const isbn = await resolveIsbnForReading(r.title, r.url);
    if (isbn) affiliate = `https://bookshop.org/a/${bookshopAffiliateId}/${isbn}`;
  }
  readingFavoritesAffiliateUrlByCanonical.set(r.url, affiliate);
}

const latestCoverLookup = buildLatestCoverLookup(orderedReading, coverForReadingEntry);
let inheritedFavoriteCovers = 0;
for (const r of orderedReadingFavorites) {
  const inherited = inheritLatestCover(r, latestCoverLookup);
  if (inherited) {
    readingCoverCache[r.url] = inherited;
    inheritedFavoriteCovers++;
  }
}
if (inheritedFavoriteCovers > 0) {
  console.log(
    `Using ${inheritedFavoriteCovers} cover(s) from Latest for Books Everyone Should Read…`
  );
}

const favoritesMissingCovers = orderedReadingFavorites.filter(
  (r) => r.url && !r.cover_url && !coverFromCache(r.url)
);
if (favoritesMissingCovers.length > 0) {
  console.log(`Looking up ${favoritesMissingCovers.length} favorite book cover(s) via Open Library…`);
  await mapWithConcurrency(favoritesMissingCovers, 6, async (r) => {
    const cover = await fetchBookCover(r.title, r.url);
    if (cover) {
      readingCoverCache[r.url] = cover;
    } else {
      console.log(`  no cover found for favorite "${r.title}" — will retry next build`);
    }
  });
  await saveBuildCache(CACHE_NAMESPACES.READING_COVERS, readingCoverCache);
}

const orderedLinklog = [...(linklog || [])].sort(sortDesc);
const linklogTagCounts = new Map();
for (const l of orderedLinklog) {
  for (const slug of Array.isArray(l.tags) ? l.tags : []) {
    linklogTagCounts.set(slug, (linklogTagCounts.get(slug) || 0) + 1);
  }
}
const linklogTagOptions = [...linklogTagCounts.entries()]
  .map(([slug, count]) => ({ slug, count, label: LINKLOG_TAG_LABELS[slug] || slug }))
  .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

const linklogTagFilterHtml =
  linklogTagOptions.length > 0
    ? `      <div class="linklog-tag-filter">
        <select class="linklog-tag-select" aria-label="Filter by tag">
          <option value="">All (${orderedLinklog.length})</option>
${linklogTagOptions
  .map((t) => `          <option value="${escHtml(t.slug)}">${escHtml(t.label)} (${t.count})</option>`)
  .join("\n")}
        </select>
      </div>`
    : "";

// Tag filter and infinite scroll in one script: the scroll pages through the
// items that match the filter, so loading a batch never reveals other tags.
// The page opts out of archiveFoot's generic scroll, which knows no filter.
const linklogFilterScript = `    <script>(function(){
var list=document.querySelector('.post-list');
if(!list)return;
var sel=document.querySelector('.linklog-tag-select');
var items=[].slice.call(list.querySelectorAll('li'));
var BATCH=10;var matches=[];var shown=0;
var sentinel=document.createElement('div');
list.parentNode.insertBefore(sentinel,list.nextSibling);
function matchesTag(li,v){
  if(!v)return true;
  var tags=(li.getAttribute('data-tags')||'').split(/\\s+/).filter(Boolean);
  return tags.indexOf(v)!==-1;
}
function reveal(){
  var next=Math.min(shown+BATCH,matches.length);
  for(var i=shown;i<next;i++)matches[i].hidden=false;
  shown=next;
}
var obs=new IntersectionObserver(function(e){
  if(!e[0].isIntersecting||shown>=matches.length)return;
  reveal();
  // Re-observe so a sentinel still on screen after a short batch fires again.
  obs.unobserve(sentinel);obs.observe(sentinel);
},{rootMargin:'0px'});
function apply(){
  var v=sel?sel.value:'';
  matches=items.filter(function(li){return matchesTag(li,v);});
  items.forEach(function(li){li.hidden=true;});
  shown=0;reveal();
  obs.unobserve(sentinel);obs.observe(sentinel);
}
if(sel)sel.addEventListener('change',apply);
apply();
}());</script>`;

// The tooltip sits beside the heading, not inside it, so the heading's text
// (and the accessible name of any section labelled by it) stays just the
// label; the hint is attached as a description instead.
const sectionHeading = (label, tag, id) => {
  const hint = SECTION_HINTS[label];
  const idAttr = id ? ` id="${id}"` : "";
  const tipId = `hint-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `<div class="section-head"><${tag}${idAttr}><span class="section-hint" tabindex="0" aria-describedby="${tipId}">${escHtml(label)}</span></${tag}><div class="section-hint-tip" id="${tipId}" role="tooltip">${escHtml(hint)}</div></div>`;
};

// Homepage lists (capped at MAX_PER_SECTION)
const postListHtml = ordered.slice(0, MAX_PER_SECTION).map((p) => renderPostItem(p)).join("\n");
const hasMorePosts = ordered.length > MAX_PER_SECTION;
const postListAllHtml = ordered
  .map((p) => withLiveAttrs(renderPostItem(p, true), liveKey(CONTENT_KIND.POST, p.slug), datedItemSort(p)))
  .join("\n");

const readingHtml = orderedReading.slice(0, MAX_PER_SECTION).map(renderReadingItem).join("\n");
const hasMoreReading = orderedReading.length > MAX_PER_SECTION;
const hasReadingArchive = orderedReading.length > 0 || orderedReadingFavorites.length > 0;
const readingAllHtml = orderedReading
  .map((r) => withLiveAttrs(renderReadingItem(r), liveKey(CONTENT_KIND.READING, r.id), readingSort(r)))
  .join("\n");

// Sharing archive unfurls: fetch each shared link's Open Graph image/
// description once and cache locally, so /sharing/ can show rich preview
// cards without re-scraping every URL on every build. This covers both
// existing (historical) and newly added links, since any linklog entry
// not yet in the cache gets fetched here. The homepage Sharing section
// intentionally stays plain links — see renderLinklogItem above.
const linklogUnfurlCache = await loadBuildCache(CACHE_NAMESPACES.LINKLOG_UNFURLS);

const missingUnfurls = orderedLinklog.filter((l) => !(l.url in linklogUnfurlCache));
if (missingUnfurls.length > 0) {
  console.log(`Fetching ${missingUnfurls.length} link preview(s) for Sharing archive…`);
  await mapWithConcurrency(missingUnfurls, 6, async (l) => {
    linklogUnfurlCache[l.url] = (await fetchLinkUnfurl(l.url)) || false;
  });
}
await saveBuildCache(CACHE_NAMESPACES.LINKLOG_UNFURLS, linklogUnfurlCache);

const renderLinklogArchiveItem = (l) => renderLinklogArchiveItemShared(l, linklogUnfurlCache[l.url] || null);

const linklogHtml = orderedLinklog.slice(0, MAX_PER_SECTION).map(renderLinklogItem).join("\n");
const hasMoreLinklog = orderedLinklog.length > MAX_PER_SECTION;
const linklogAllHtml = orderedLinklog
  .map((l) => withLiveAttrs(renderLinklogArchiveItem(l), liveKey(CONTENT_KIND.LINKLOG, l.id), datedItemSort(l)))
  .join("\n");

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

const socialsHtml = `          <li class="link-list-socials">
            <button type="button" class="socials-toggle" aria-expanded="false" aria-controls="socials-sublist">
              Feeds<span class="socials-chevron" aria-hidden="true"></span>
            </button>
            <ul class="socials-sublist" id="socials-sublist" hidden>
              <li>
                <a href="https://bsky.app/profile/rommy.nyc" rel="me noopener" target="_blank">Bluesky</a>
              </li>
              <li>
                <a href="https://mas.to/@rommy" rel="me noopener" target="_blank">Mastodon</a>
              </li>
              <li>
                <a href="https://rommy.micro.blog/" rel="me noopener" target="_blank">micro.blog</a>
              </li>
            </ul>
          </li>`;

const descriptionText = typeof site.description === "string" ? site.description.trim() : "";
const descriptionMeta = descriptionText
  ? `    <meta
      name="description"
      content="${escHtml(descriptionText)}"
    />
`
  : "";
const subtitleHtml = descriptionText ? `      <p class="lead">${escHtml(descriptionText)}</p>\n\n` : "";

// The fold-down Thinking composer: hidden from everyone but a browser with an
// admin session, and the composer itself (/thinking-composer.js, shared with
// the admin's Thinking tab) is only fetched on the first open. Posting
// reloads the page, and the live overlay shows the new note at once.
const CARET_DOWN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CARET_UP = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const homeComposerHtml = `      <div class="home-composer" id="home-composer" hidden>
        <button type="button" class="home-composer-toggle home-composer-open" aria-expanded="false" aria-controls="home-composer-fold" aria-label="Write a Thinking note">${CARET_DOWN}</button>
        <div class="home-composer-fold" id="home-composer-fold">
          <div class="home-composer-panel" inert>
            <div id="home-composer-mount"></div>
            <button type="button" class="home-composer-toggle home-composer-close" aria-controls="home-composer-fold" aria-label="Hide the composer">${CARET_UP}</button>
          </div>
        </div>
      </div>
`;
const homeComposerScript = `    <script>(function(){
      var SESSION_KEY="admin_session";
      var SESSION_TTL=${30 * 24 * 60 * 60 * 1000};
      var API_URL=(function(){var h=location.hostname;if(h==="localhost"||h==="127.0.0.1")return"https://rommy-blog-admin.fingerguns.workers.dev";return"/api/admin";})();
      function loadPw(){
        try{
          var raw=localStorage.getItem(SESSION_KEY);
          if(raw){var s=JSON.parse(raw);if(s&&s.pw&&s.ts&&Date.now()-s.ts<SESSION_TTL)return s.pw;}
          raw=sessionStorage.getItem(SESSION_KEY);
          if(raw){var tab=JSON.parse(raw);if(tab&&tab.pw)return tab.pw;}
        }catch(e){}
        return null;
      }
      var wrap=document.getElementById("home-composer");
      if(!wrap||!loadPw())return;
      wrap.hidden=false;
      var openBtn=wrap.querySelector(".home-composer-open");
      var closeBtn=wrap.querySelector(".home-composer-close");
      var panel=wrap.querySelector(".home-composer-panel");
      var mountEl=document.getElementById("home-composer-mount");
      var composer=null,loading=null;
      function load(){
        if(loading)return loading;
        loading=new Promise(function(resolve,reject){
          if(window.ThinkingComposer){resolve();return;}
          var s=document.createElement("script");
          s.src="/thinking-composer.js?v=${cssV}";
          s.onload=function(){resolve();};
          s.onerror=function(){loading=null;reject(new Error("Could not load the composer."));};
          document.head.appendChild(s);
        });
        return loading;
      }
      function setOpen(open){
        wrap.classList.toggle("is-open",open);
        openBtn.setAttribute("aria-expanded",open?"true":"false");
        panel.inert=!open;
        if(open){if(composer)setTimeout(composer.focus,500);}else openBtn.focus({preventScroll:true});
      }
      openBtn.addEventListener("click",function(){
        load().then(function(){
          if(!composer){
            composer=window.ThinkingComposer.mount(mountEl,{
              apiUrl:API_URL,
              getPassword:loadPw,
              idPrefix:"home-t",
              signedOutMessage:"Sign in at rommy.blog/admin/ on this device, then try again.",
              onSaved:function(){setTimeout(function(){location.reload();},1200);}
            });
          }
          setOpen(true);
        },function(err){openBtn.title=err.message;});
      });
      closeBtn.addEventListener("click",function(){setOpen(false);});
    }());</script>`;

const latestThinkingItem = microblogItems[0];
const thinkingSection = hasThinking(thinking)
  ? `      <section aria-labelledby="now-heading">
        ${sectionHeading("Thinking", "h2", "now-heading")}
        <ol class="post-list"${liveListAttrs("home-thinking")}>
          <li>
            <div class="microblog-entry">
              ${renderThinkingHtml(thinking)}
              ${latestThinkingItem ? thinkingPostMetaHtml(latestThinkingItem, thinkingSlug(latestThinkingItem)) : ""}
            </div>
          </li>
        </ol>
        <a class="see-more" href="/thinking/" aria-label="All thinking">→</a>
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
${liveWatermarkMeta}
    <title>${escHtml(site.title)}</title>
    <script>(function(){var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t||'dark');}());</script>
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escHtml(site.title)}" />
    <meta property="og:url" content="${escHtml(site.url)}/" />
    <meta property="og:site_name" content="${escHtml(site.title)}" />
    <meta property="og:image" content="${escHtml(site.url)}/favicon.png" />
${descriptionText ? `    <meta property="og:description" content="${escHtml(descriptionText)}" />\n` : ""}${descriptionMeta}
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <link rel="preload" href="/media/fonts/abc-areal/v1/ABCArealVariable.woff2" as="font" type="font/woff2" crossorigin />
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
${homeComposerHtml}
${thinkingSection}

      <section aria-labelledby="posts-heading">
        ${sectionHeading("Writing", "h2", "posts-heading")}
        <ol class="post-list" reversed${liveListAttrs("home-writing")}>
${postListHtml}
        </ol>
        ${hasMorePosts ? '<a class="see-more" href="/writing/" aria-label="All writing">→</a>' : ""}
      </section>

      <section aria-labelledby="reading-heading">
        ${sectionHeading("Reading", "h2", "reading-heading")}
        <ol class="post-list" reversed${liveListAttrs("home-reading")}>
${readingHtml}
        </ol>
        ${hasMoreReading ? '<a class="see-more" href="/reading/latest/" aria-label="All reading">→</a>' : ""}
      </section>

      <section aria-labelledby="linklog-heading">
        ${sectionHeading("Sharing", "h2", "linklog-heading")}
        <ol class="post-list" reversed${liveListAttrs("home-linklog")}>
${linklogHtml}
        </ol>
        ${hasMoreLinklog ? '<a class="see-more" href="/sharing/" aria-label="All sharing">→</a>' : ""}
      </section>

      <section aria-labelledby="links-heading">
        <h2 id="links-heading">Elsewhere</h2>
        <ul class="link-list">
${linksHtml}
${socialsHtml}
        </ul>
      </section>

      <footer class="site-footer">
        <p class="footer-row footer-row-toggle"><span>&copy; 2026 ${escHtml(site.author)} <a href="/admin/" class="footer-icon" aria-label="Admin" title="Admin"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg></a></span><a href="#" class="theme-toggle" id="theme-toggle" role="button"></a><a href="/search/" class="footer-icon" aria-label="Search" title="Search"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/></svg></a></p>
        <p class="footer-row"><span>Subscribe via <a href="feed.xml" type="application/atom+xml" class="footer-icon" aria-label="Atom feed" title="Atom feed"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg></a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>

${colophonSection}    </main>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';b.innerHTML=t==='dark'?'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>':'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';b.setAttribute('aria-label',l);b.title=l;localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'dark');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${socialsToggleScript}
${portraitPhotoToggleScript}
${thinkingLightboxScript}
${homeComposerScript}
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
Disallow: /_live/

Sitemap: ${base}/sitemap.xml
`;

// Archive pages
const archiveHead = (title, headingHtml, extraHead = "") => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${liveWatermarkMeta}
    <title>${escHtml(title)} — ${escHtml(site.title)}</title>
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escHtml(title)} — ${escHtml(site.title)}" />
    <meta property="og:url" content="${escHtml(site.url)}/${escHtml(title.toLowerCase())}/" />
    <meta property="og:site_name" content="${escHtml(site.title)}" />
    <meta property="og:image" content="${escHtml(site.url)}/favicon.png" />
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <link rel="preload" href="/media/fonts/abc-areal/v1/ABCArealVariable.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/styles.css?v=${cssV}" />
    <script>(function(){var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t||'dark');}());</script>
    <link
      rel="alternate"
      type="application/atom+xml"
      title="${escHtml(site.title)} (Atom)"
      href="/feed.xml"
    />
${gaSnippet}
${extraHead}
  </head>
  <body>
    <article class="post">
      <a class="post-back" href="/" aria-label="Home">←</a>
      ${headingHtml ?? `<h1>${escHtml(title)}</h1>`}`;

const archiveFoot = (extraScripts = "", { infiniteScroll = true } = {}) => `      <footer class="site-footer">
        <p class="footer-row footer-row-toggle"><span>&copy; 2026 ${escHtml(site.author)} <a href="/admin/" class="footer-icon" aria-label="Admin" title="Admin"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg></a></span><a href="#" class="theme-toggle" id="theme-toggle" role="button"></a><a href="/search/" class="footer-icon" aria-label="Search" title="Search"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/></svg></a></p>
        <p class="footer-row"><span>Subscribe via <a href="/feed.xml" type="application/atom+xml" class="footer-icon" aria-label="Atom feed" title="Atom feed"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg></a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';b.innerHTML=t==='dark'?'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>':'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';b.setAttribute('aria-label',l);b.title=l;localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'dark');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingLightboxScript}
${infiniteScroll ? `    <script>(function(){var BATCH=10;var list=document.querySelector('.post-list');if(!list)return;var items=list.querySelectorAll('li');if(items.length<=BATCH)return;for(var i=BATCH;i<items.length;i++)items[i].hidden=true;var shown=BATCH;var sentinel=document.createElement('div');document.body.appendChild(sentinel);var obs=new IntersectionObserver(function(e){if(!e[0].isIntersecting)return;var next=Math.min(shown+BATCH,items.length);for(var i=shown;i<next;i++)items[i].hidden=false;shown=next;if(shown>=items.length)obs.disconnect();},{rootMargin:'0px'});obs.observe(sentinel);}());</script>` : ""}
${extraScripts}
  </body>
</html>
`;

const thinkingViewToggleScript = `    <script>(function(){
var wrap=document.querySelector('.thinking-views');
if(!wrap)return;
var viewBtns=document.querySelectorAll('.thinking-view-btn');
var filterBtns=document.querySelectorAll('.thinking-filter-btn');
var items=document.querySelectorAll('.thinking-grid-item');
var listEntries=document.querySelectorAll('.microblog-feed .microblog-entry[data-kind]');
var months=document.querySelectorAll('.thinking-grid-month');
var kinds=${JSON.stringify(THINKING_GRID_KINDS)};
var FILTER_PATH=${JSON.stringify(THINKING_FILTER_PATH)};
var PATH_FILTER=${JSON.stringify(THINKING_PATH_FILTER)};
var gridMediaObs=null;
var mediaQueue=[];
var mediaInflight=0;
var MEDIA_MAX=4;
function defaultFilters(){var all={};kinds.forEach(function(k){all[k]=false;});return all;}
var active=defaultFilters();
function anyFilterActive(){return kinds.some(function(k){return active[k];});}
function normPath(){return location.pathname.replace(/\\/+$/,'')||'/';}
function filterFromPath(){
  var p=normPath();
  if(p==='/thinking')return null;
  if(p.indexOf('/thinking/')!==0)return null;
  var seg=p.slice('/thinking/'.length);
  if(!seg||seg.indexOf('/')>=0)return null;
  return PATH_FILTER[seg]||null;
}
function pathForFilters(){
  for(var i=0;i<kinds.length;i++){
    var k=kinds[i];
    if(active[k]){var seg=FILTER_PATH[k];if(seg)return'/thinking/'+seg+'/';}
  }
  return'/thinking/';
}
function syncPath(skipPath){
  if(skipPath)return;
  var want=pathForFilters();
  if(location.pathname!==want)history.replaceState(null,'',want);
}
function setFiltersFromPath(){
  var fromPath=filterFromPath();
  if(fromPath){kinds.forEach(function(kind){active[kind]=(kind===fromPath);});}
  else{active=defaultFilters();}
}
// One element per call, so its handlers close over their own binding. Inlining
// this in the drain loop shared a single function-scoped var across every
// iteration: each handler then revealed whichever tile the loop happened to
// reach last, and the rest stayed at opacity 0 with their bytes already in.
function startGridMedia(el){
  var url=el.getAttribute('data-src');
  if(!url)return false;
  mediaInflight++;
  function done(){
    el.removeEventListener('load',done);
    el.removeEventListener('error',done);
    el.classList.add('is-loaded');
    mediaInflight--;
    drainMediaQueue();
  }
  el.addEventListener('load',done);
  el.addEventListener('error',done);
  el.src=url;
  el.removeAttribute('data-src');
  el.dataset.loaded='1';
  if(gridMediaObs)gridMediaObs.unobserve(el);
  return true;
}
function drainMediaQueue(){
  if(wrap.getAttribute('data-view')!=='grid')return;
  while(mediaInflight<MEDIA_MAX&&mediaQueue.length){
    var el=mediaQueue.shift();
    if(!el||el.dataset.loaded==='1')continue;
    startGridMedia(el);
  }
}
function hydrateGridMedia(el){
  if(el.dataset.loaded==='1'||el.dataset.queued==='1')return;
  if(!el.getAttribute('data-src'))return;
  el.dataset.queued='1';
  mediaQueue.push(el);
  drainMediaQueue();
}
function scanGridMedia(){
  if(!gridMediaObs){
    gridMediaObs=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting)hydrateGridMedia(e.target);});
    },{rootMargin:'80px'});
  }
  wrap.querySelectorAll('.thinking-grid-item img[data-src]').forEach(function(el){gridMediaObs.unobserve(el);});
  mediaQueue=mediaQueue.filter(function(el){return el.isConnected&&!el.closest('.thinking-grid-item[hidden]');});
  if(wrap.getAttribute('data-view')!=='grid')return;
  wrap.querySelectorAll('.thinking-grid-item:not([hidden]) img[data-src]').forEach(function(el){
    if(el.dataset.loaded!=='1'&&el.dataset.queued!=='1')gridMediaObs.observe(el);
  });
}
function applyFilters(){
  var on=anyFilterActive();
  filterBtns.forEach(function(b){var k=b.getAttribute('data-filter');b.setAttribute('aria-pressed',active[k]?'true':'false');});
  items.forEach(function(el){var k=el.getAttribute('data-kind');el.hidden=on&&!active[k];});
  listEntries.forEach(function(el){var k=el.getAttribute('data-kind');el.hidden=on&&!active[k];});
  months.forEach(function(section){section.hidden=!section.querySelector('.thinking-grid-item:not([hidden])');});
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
  setFiltersFromPath();
  applyFilters();
  filterBtns.forEach(function(b){
    b.addEventListener('click',function(){
      var k=b.getAttribute('data-filter');
      if(active[k]){active[k]=false;}
      else{kinds.forEach(function(kind){active[kind]=(kind===k);});}
      applyFilters();
      syncPath();
      b.blur();
    });
  });
  window.addEventListener('popstate',function(){setFiltersFromPath();applyFilters();});
}else{scanGridMedia();}
}());</script>`;


const writingPageHtml = `${archiveHead("Writing", sectionHeading("Writing", "h1"))}
      <ol class="post-list" reversed${liveListAttrs("writing")}>
${postListAllHtml}
      </ol>
${archiveFoot()}`;

const sharingPageHtml = `${archiveHead("Sharing", sectionHeading("Sharing", "h1"))}
${linklogTagFilterHtml}
      <ol class="post-list linklog-archive-list" reversed${liveListAttrs("linklog")}>
${linklogAllHtml}
      </ol>
${archiveFoot(linklogFilterScript, { infiniteScroll: false })}`;

// /now page
const nowMonthYear = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
const currentBook = orderedReading[0];
const nowTodayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const nowMovingHtml = (() => {
  if (!ouraSteps?.day) return "";
  const stepsText = Number(ouraSteps.steps).toLocaleString("en-US");
  const distanceText = distanceTextFromSteps(ouraSteps.steps);
  const stepsWithDistance = distanceText ? `${stepsText} steps (${distanceText})` : `${stepsText} steps`;
  if (ouraSteps.day === nowTodayEt) {
    return `        <h2>Walking</h2>
        <p>${stepsWithDistance} today.</p>
`;
  }
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
  }).format(new Date(`${ouraSteps.day}T12:00:00`));
  return `        <h2>Walking</h2>
        <p>${stepsWithDistance} on ${escHtml(dayLabel)}.</p>
`;
})();
const nowMapHead = `    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css"
      crossorigin="anonymous"
    />`;
const nowLocationHtml = `        <h2>Current Location</h2>
        <p class="now-location-label" id="now-location-label"><span id="now-location-status">Loading map…</span></p>
        <div id="now-location-map" class="now-location-map" role="region" aria-label="Current neighborhood map"></div>
`;
const nowLocationMapScript = `    <script>(function(){
  var mapEl=document.getElementById('now-location-map');
  if(!mapEl)return;
  var statusEl=document.getElementById('now-location-status');
  var labelEl=document.getElementById('now-location-label');
  var apiUrl=(function(){var h=location.hostname;if(h==='localhost'||h==='127.0.0.1')return'https://rommy-blog-admin.fingerguns.workers.dev/api/locations/now';return'/api/locations/now';})();
  var maplibreSrc='https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js';
  function isDark(){return document.documentElement.getAttribute('data-theme')==='dark';}
  ${DARK_MAP_RECOLOR_JS}
  function escLabel(label){
    return String(label).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  }
  function loadMapLibre(){
    if(typeof maplibregl!=='undefined')return Promise.resolve();
    return new Promise(function(resolve,reject){
      var existing=document.querySelector('script[data-now-maplibre="1"]');
      if(existing){
        existing.addEventListener('load',function(){resolve();},{once:true});
        existing.addEventListener('error',function(){reject(new Error('MapLibre failed to load'));},{once:true});
        return;
      }
      var s=document.createElement('script');
      s.src=maplibreSrc;
      s.crossOrigin='anonymous';
      s.dataset.nowMaplibre='1';
      s.onload=function(){resolve();};
      s.onerror=function(){reject(new Error('MapLibre failed to load'));};
      document.head.appendChild(s);
    });
  }
  function showMapError(message){
    mapEl.textContent=message;
    mapEl.classList.add('now-location-map--error');
  }
  function initMap(west,south,east,north){
    return loadMapLibre().then(function(){
      if(typeof maplibregl==='undefined')throw new Error('MapLibre unavailable');
      var mlStyles={
        light:'https://tiles.openfreemap.org/styles/liberty',
        dark:'https://tiles.openfreemap.org/styles/dark'
      };
      var neighborhoodGeojson={
        type:'Feature',
        geometry:{
          type:'Polygon',
          coordinates:[[
            [west,south],
            [east,south],
            [east,north],
            [west,north],
            [west,south]
          ]]
        }
      };
      var mlMap=new maplibregl.Map({
        container:mapEl,
        style:mlStyles[isDark()?'dark':'light'],
        bounds:[[west,south],[east,north]],
        fitBoundsOptions:{padding:20,maxZoom:15},
        scrollZoom:false,
        attributionControl:false
      });
      mlMap.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');
      mlMap.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
      function collapseAttribution(){
        var el=mapEl.querySelector('.maplibregl-ctrl-attrib');
        if(!el)return;
        el.classList.add('maplibregl-compact');
        el.classList.remove('maplibregl-compact-show');
        el.removeAttribute('open');
      }
      function applyNeighborhoodLayers(){
        try{
          if(mlMap.getLayer('now-neighborhood-fill'))mlMap.removeLayer('now-neighborhood-fill');
          if(mlMap.getLayer('now-neighborhood-line'))mlMap.removeLayer('now-neighborhood-line');
          if(mlMap.getSource('now-neighborhood'))mlMap.removeSource('now-neighborhood');
          mlMap.addSource('now-neighborhood',{type:'geojson',data:neighborhoodGeojson});
          mlMap.addLayer({
            id:'now-neighborhood-fill',
            type:'fill',
            source:'now-neighborhood',
            paint:{'fill-color':'#2563eb','fill-opacity':0.18}
          });
          mlMap.addLayer({
            id:'now-neighborhood-line',
            type:'line',
            source:'now-neighborhood',
            paint:{'line-color':'#2563eb','line-width':2}
          });
        }catch(err){
          console.error('Neighborhood layer update failed',err);
        }
      }
      function refreshNeighborhoodOverlay(){
        collapseAttribution();
        mlMap.once('idle',function(){
          applyNeighborhoodLayers();
          collapseAttribution();
        });
      }
      mlMap.on('load',refreshNeighborhoodOverlay);
      mlMap.on('style.load',refreshNeighborhoodOverlay);
      // Lift the dark basemap out of near-black. Re-applied on every styledata
      // because a theme swap replaces the whole style. See lib/map-dark.mjs.
      mlMap.on('styledata',function(){if(isDark())recolorDarkBasemap(mlMap);});
      mlMap.on('error',function(e){
        if(e&&e.error)console.error('MapLibre map error',e.error);
      });
      window.__nowSetMapBasemap=function(){
        mlMap.setStyle(mlStyles[isDark()?'dark':'light']);
      };
      setTimeout(function(){mlMap.resize();},50);
      setTimeout(function(){mlMap.resize();},300);
    }).catch(function(err){
      console.error('MapLibre init failed',err);
      showMapError('Map unavailable.');
    });
  }
  fetch(apiUrl).then(function(r){return r.ok?r.json():null;}).then(function(data){
    if(!data||!data.ok||!data.bbox||!data.label){
      if(statusEl)statusEl.textContent='Location unavailable.';
      mapEl.hidden=true;
      return;
    }
    if(statusEl)statusEl.remove();
    var west=data.bbox[0],south=data.bbox[1],east=data.bbox[2],north=data.bbox[3];
    if(labelEl){
      var href=data.osmUrl||'https://www.openstreetmap.org/search?query='+encodeURIComponent(data.label);
      labelEl.innerHTML='<a href="'+href.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener">'+escLabel(data.label)+'</a>';
    }
    initMap(west,south,east,north);
    new MutationObserver(function(){
      if(window.__nowSetMapBasemap)window.__nowSetMapBasemap();
    }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }).catch(function(){
    if(statusEl)statusEl.textContent='Could not load location.';
    mapEl.hidden=true;
  });
})();</script>`;
const nowPageHtml = `${archiveHead("Now", undefined, nowMapHead)}
      <p class="lead">Updated ${escHtml(nowMonthYear)} &middot; Brooklyn, NY &middot; <a href="https://nownownow.com/about" target="_blank" rel="noopener">What's this?</a></p>
      <div class="now-body">
${hasThinking(thinking) ? `        <h2>Thinking</h2>
        ${renderThinkingHtml(thinking)}
` : ""}${currentBook ? `        <h2>Reading</h2>
        <p><a href="${escHtml(readingLinkUrl(currentBook))}" target="_blank" rel="noopener">${escHtml(currentBook.title)}</a></p>
` : ""}        <h2>Working</h2>
        <p>Building data agents, skills, semantic layers, and contexts at CircleCI.</p>
${nowMovingHtml}${nowLocationHtml}      </div>
${archiveFoot(nowLocationMapScript)}`;

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
      <p class="lead">This is the site's own commit history, generated straight from Git — every change to the code, published as it happens. Some entries are user-facing (a new page, a redesign); others are internal plumbing (a dependency bump, a CSS fix) that won't mean much unless you're curious how the site is built. See the <a href="/colophon/">colophon</a> for how it all fits together.</p>
      <ol class="post-list" reversed>
${changelogListHtml}
      </ol>
${archiveFoot()}`;

// A Thinking note's page, its varying slots filled from
// thinkingPermalinkParts(); written once more with LIVE_TOKENS as the
// template the live overlay fills (see scripts/lib/render/pages.mjs).
const thinkingPostHead = (v) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${liveWatermarkMeta}
    <title>${v.title}</title>
    <script>(function(){var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t||'dark');}());</script>
${v.og}
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="stylesheet" href="/styles.css?v=${cssV}" />
${gaSnippet}
  </head>
  <body>
    <article class="post microblog-entry" data-slug="${v.slug}" data-microblog-url="${v.microblogUrl}">
      <nav class="thinking-crumb" aria-label="Breadcrumb">
        <h1 class="site-title"><a href="/">${escHtml(site.title)}</a></h1>
        <div class="thinking-crumb-trail">
          <h2 class="thinking-crumb-heading"><a href="/thinking/">Thinking</a></h2><span class="thinking-crumb-meta"><span class="thinking-crumb-sep" aria-hidden="true"> // </span><time class="thinking-crumb-date" datetime="${v.crumbIso}" aria-current="page">${v.crumbDate}</time></span>
        </div>
      </nav>`;

const thinkingPostFoot = `      <footer class="site-footer">
        <p class="footer-row footer-row-toggle"><span>&copy; 2026 ${escHtml(site.author)} <a href="/admin/" class="footer-icon" aria-label="Admin" title="Admin"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg></a></span><a href="#" class="theme-toggle" id="theme-toggle" role="button"></a><a href="/search/" class="footer-icon" aria-label="Search" title="Search"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/></svg></a></p>
        <p class="footer-row"><span>Subscribe via <a href="/feed.xml" type="application/atom+xml" class="footer-icon" aria-label="Atom feed" title="Atom feed"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg></a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';b.innerHTML=t==='dark'?'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>':'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';b.setAttribute('aria-label',l);b.title=l;localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'dark');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingLightboxScript}
${thinkingDeleteLinkScript}
${thinkingDeleteConfirmScript}
  </body>
</html>`;

const microblogListHtml = (items) =>
  items.length > 0
    ? items
        .map((item) =>
          withLiveAttrs(
            thinkingListEntryHtml(item, renderCtx),
            liveKey(CONTENT_KIND.THINKING, thinkingSlug(item)),
            datetimeSort(item.date_published)
          )
        )
        .join("\n")
    : `        <p style="color:var(--muted)">No posts yet.</p>`;

function thinkingGridGroupsHtml(items) {
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
    .map((g) =>
      thinkingGridMonthHtml(
        g.label,
        g.items
          .map((item) =>
            withLiveAttrs(
              thinkingGridItemHtmlShared(item, renderCtx),
              liveKey(CONTENT_KIND.THINKING, thinkingSlug(item)),
              datetimeSort(item.date_published)
            )
          )
          .join("\n"),
        monthKeyET(g.items[0].date_published)
      )
    )
    .join("\n");
}

const spotifyThumbnailCache = await loadBuildCache(CACHE_NAMESPACES.SPOTIFY_THUMBNAILS);

// URL-format upgrades are picked up by saveBuildCache's diff, no flag needed.
for (const [key, url] of Object.entries(spotifyThumbnailCache)) {
  spotifyThumbnailCache[key] = upgradeSpotifyImageUrl(url);
}

const spotifyKeysNeeded = new Set();
for (const item of microblogItems) {
  const embed = spotifyEmbedFromHtml(item.content_html);
  if (embed) spotifyKeysNeeded.add(`${embed.type}:${embed.id}`);
}

const missingSpotifyThumbnails = [...spotifyKeysNeeded].filter((key) => !(key in spotifyThumbnailCache));
if (missingSpotifyThumbnails.length > 0) {
  console.log(`Looking up ${missingSpotifyThumbnails.length} Spotify thumbnail(s)…`);
  await mapWithConcurrency(missingSpotifyThumbnails, 6, async (key) => {
    const [type, id] = key.split(":");
    const thumb = await fetchSpotifyThumbnail(type, id);
    if (thumb) {
      spotifyThumbnailCache[key] = thumb;
    } else {
      console.log(`  no thumbnail for Spotify ${key} — will retry next build`);
    }
  });
}
await saveBuildCache(CACHE_NAMESPACES.SPOTIFY_THUMBNAILS, spotifyThumbnailCache);
renderCtx.spotifyThumbnails = spotifyThumbnailCache;

const videoPosterCache = await loadBuildCache(CACHE_NAMESPACES.VIDEO_POSTERS);

const videoSrcsNeeded = new Set();
for (const item of microblogItems) {
  const videoSrc = videoSrcFromHtml(item.content_html);
  if (videoSrc) videoSrcsNeeded.add(videoSrc);
}

// retryEmpty: a poster missing today can be backfilled tomorrow, so a cached
// `false` is rechecked rather than trusted. Costs one HEAD per posterless
// video per build.
const missingVideoPosters = cacheKeysToLookUp(videoPosterCache, videoSrcsNeeded, {
  retryEmpty: true,
});
await mapWithConcurrency(missingVideoPosters, 6, async (videoSrc) => {
  const posterKey = videoPosterKeyFromVideoUrl(videoSrc, base);
  if (!posterKey) {
    videoPosterCache[videoSrc] = false;
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/media/${posterKey}`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    videoPosterCache[videoSrc] = res.ok;
  } catch {
    videoPosterCache[videoSrc] = false;
  }
});
await saveBuildCache(CACHE_NAMESPACES.VIDEO_POSTERS, videoPosterCache);
renderCtx.videoPosters = videoPosterCache;

// ── Thinking map view ──────────────────────────────────────────────────────
//
// Posts carry a neighborhood label, never a coordinate, so the map is drawn by
// geocoding the distinct labels forward — see scripts/lib/geocode-neighborhood.mjs
// for why that indirection is deliberate rather than a limitation worked around.
const neighborhoodPlaceCache = await loadBuildCache(CACHE_NAMESPACES.NEIGHBORHOOD_PLACES, {
  skipLegacy: true,
});

const thinkingMapEntries = microblogItems
  .filter((item) => String(item.location_label || "").trim())
  .map((item) => ({
    slug: thinkingSlug(item),
    label: String(item.location_label).trim(),
    kind: thinkingGridKind(item, spotifyThumbnailCache),
    text: stripHtml(item.content_html),
    date: item.date_published,
    dateText: formatMbDate(item.date_published),
  }));

const thinkingMapLabels = new Set(thinkingMapEntries.map((e) => e.label));

// Which "Harris Township"? The bare label does not say, and Nominatim's first
// answer for it is in Michigan while the note was written in Pennsylvania. The
// Worker's geocode_cache read backwards gives the fix that produced each label,
// which is enough to pick the right candidate. Build-time only — the published
// coordinate stays Nominatim's neighborhood centre.
let labelReferences = {};
if (d1Configured()) {
  try {
    labelReferences = referencePointsFromRows(await d1Query(LABEL_REFERENCE_SQL));
  } catch (err) {
    console.warn(`Thinking map: could not read label references — ${err.message}`);
  }
}

// A point already in the cache is re-checked against its reference, so the two
// townships that resolved to Michigan before the reference existed correct
// themselves on the next build instead of needing the row deleted by hand.
for (const [label, point] of Object.entries(neighborhoodPlaceCache)) {
  const reference = labelReferences[label];
  if (!point || !reference) continue;
  const km = haversineKm(reference, point);
  if (km > MAX_REFERENCE_DRIFT_KM) {
    console.log(`  "${label}" cached ${Math.round(km)}km from its fix — re-resolving`);
    delete neighborhoodPlaceCache[label];
  }
}

// retryEmpty: a label that failed to resolve is usually Nominatim being down or
// rate-limiting, not a place that will never exist, and there are only a couple
// of dozen labels. Retrying costs ~1s each on a build that would otherwise skip
// them entirely; trusting the `false` would strand the neighborhood forever.
const missingPlaces = cacheKeysToLookUp(neighborhoodPlaceCache, thinkingMapLabels, {
  retryEmpty: true,
});
if (missingPlaces.length > 0) {
  console.log(`Geocoding ${missingPlaces.length} neighborhood label(s) for the Thinking map…`);
  Object.assign(
    neighborhoodPlaceCache,
    await geocodeNeighborhoodLabels(missingPlaces, {
      references: labelReferences,
      onResult: (label, point) => {
        if (!point) console.log(`  no match for "${label}" — will retry next build`);
      },
    })
  );
}
await saveBuildCache(CACHE_NAMESPACES.NEIGHBORHOOD_PLACES, neighborhoodPlaceCache);

const thinkingMapPlaces = groupThinkingByPlace(thinkingMapEntries, neighborhoodPlaceCache);
const thinkingMapLocatedCount = thinkingMapPlaces.reduce((n, p) => n + p.posts.length, 0);

// The map view: markup is a static shell, everything inside it is drawn by
// thinkingMapScript once the view is actually opened. MapLibre is ~200 KB and
// most visits never switch views, so nothing loads until the tab is clicked.
const thinkingMapViewHtml = `      <div class="thinking-map-wrap">
        <p class="thinking-map-note" id="thinking-map-note">${
          thinkingMapLocatedCount === 0
            ? "No posts have a location yet."
            : `${thinkingMapLocatedCount} post${thinkingMapLocatedCount === 1 ? "" : "s"} across ${thinkingMapPlaces.length} neighborhood${thinkingMapPlaces.length === 1 ? "" : "s"}. Pins sit at the centre of a neighborhood, never at an exact spot.`
        }</p>
        <div class="thinking-map" id="thinking-map" role="region" aria-label="Map of located Thinking posts"></div>
      </div>`;

const thinkingMapScript = `    <script>(function(){
var wrap=document.querySelector('.thinking-views');
if(!wrap)return;
var mapEl=document.getElementById('thinking-map');
if(!mapEl)return;
var PLACES=${jsonForScript(thinkingMapPlaces)};
var ICONS=${jsonForScript(THINKING_MEDIA_ICONS)};
var BOUNDS=${jsonForScript(placesBounds(thinkingMapPlaces))};
if(!PLACES.length)return;
var STYLES={light:'https://tiles.openfreemap.org/styles/liberty',dark:'https://tiles.openfreemap.org/styles/dark'};
var MAPLIBRE_SRC='https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js';
var MAPLIBRE_CSS='https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css';
var map=null,ready=false,starting=false,markers=[],overlay=null,openPlace=null;
function isDark(){return document.documentElement.getAttribute('data-theme')==='dark';}
${DARK_MAP_RECOLOR_JS}
// The stylesheet is not optional decoration: without it .maplibregl-marker
// never gets position:absolute, and every pin stacks in normal document flow
// below the map instead of sitting on it. It is loaded here rather than in the
// page head so a visitor who never opens the map never pays for it.
function loadCss(){
  if(document.querySelector('link[data-thinking-maplibre-css="1"]'))return;
  var link=document.createElement('link');
  link.rel='stylesheet';
  link.href=MAPLIBRE_CSS;
  link.crossOrigin='anonymous';
  link.dataset.thinkingMaplibreCss='1';
  document.head.appendChild(link);
}
function load(){
  loadCss();
  if(typeof maplibregl!=='undefined')return Promise.resolve();
  return new Promise(function(resolve,reject){
    var existing=document.querySelector('script[data-thinking-maplibre="1"]');
    if(existing){existing.addEventListener('load',function(){resolve();});existing.addEventListener('error',reject);return;}
    var el=document.createElement('script');
    el.src=MAPLIBRE_SRC;
    el.crossOrigin='anonymous';
    el.dataset.thinkingMaplibre='1';
    el.onload=function(){resolve();};
    el.onerror=reject;
    document.head.appendChild(el);
  });
}
// The filter buttons are owned by thinkingViewToggleScript. Rather than keep a
// second copy of that state in sync, read the pressed buttons back off the DOM
// whenever the markers are rebuilt — one source of truth, no coupling.
function activeKinds(){
  var on=[];
  document.querySelectorAll('.thinking-filter-btn').forEach(function(b){
    if(b.getAttribute('aria-pressed')==='true')on.push(b.getAttribute('data-filter'));
  });
  return on;
}
function postsFor(place){
  var on=activeKinds();
  if(!on.length)return place.posts;
  return place.posts.filter(function(p){return on.indexOf(p.kind)>=0;});
}
function closeOverlay(){
  openPlace=null;
  if(overlay){overlay.remove();overlay=null;}
  markers.forEach(function(m){m.el.setAttribute('aria-expanded','false');});
}
function openOverlay(place,posts){
  closeOverlay();
  openPlace=place.label;
  overlay=document.createElement('div');
  overlay.className='thinking-map-overlay';
  overlay.addEventListener('click',function(e){e.stopPropagation();});

  var head=document.createElement('div');
  head.className='thinking-map-overlay-head';
  var title=document.createElement('h3');
  title.className='thinking-map-overlay-title';
  title.textContent=place.label;
  var close=document.createElement('button');
  close.type='button';
  close.className='thinking-map-overlay-close';
  close.setAttribute('aria-label','Close');
  close.textContent='×';
  close.addEventListener('click',closeOverlay);
  head.appendChild(title);
  head.appendChild(close);
  overlay.appendChild(head);

  var list=document.createElement('ul');
  list.className='thinking-map-overlay-list';
  posts.forEach(function(p){
    var li=document.createElement('li');
    if(p.text){
      var txt=document.createElement('p');
      txt.className='thinking-map-overlay-text';
      txt.textContent=p.text;
      li.appendChild(txt);
    }
    var link=document.createElement('a');
    link.className='thinking-map-overlay-link';
    link.href='/thinking/'+p.slug+'/';
    link.textContent=p.dateText||'Open post';
    li.appendChild(link);
    list.appendChild(li);
  });
  overlay.appendChild(list);
  mapEl.appendChild(overlay);
}
function collapseAttribution(){
  var el=mapEl.querySelector('.maplibregl-ctrl-attrib');
  if(!el)return;
  el.classList.add('maplibregl-compact');
  el.classList.remove('maplibregl-compact-show');
  el.removeAttribute('open');
}
function pinEl(place,posts){
  var el=document.createElement('button');
  el.type='button';
  el.className='thinking-map-pin';
  el.setAttribute('aria-expanded','false');
  el.setAttribute('aria-label',place.label+' — '+posts.length+' post'+(posts.length===1?'':'s'));
  if(posts.length===1){
    el.classList.add('thinking-map-pin--icon');
    el.innerHTML=ICONS[posts[0].kind]||ICONS.text;
  }else{
    el.classList.add('thinking-map-pin--count');
    el.textContent=String(posts.length);
  }
  el.addEventListener('click',function(e){
    // Without this the click reaches the map canvas underneath and the
    // close-on-map-click handler shuts the overlay in the same gesture.
    e.stopPropagation();
    if(openPlace===place.label){closeOverlay();return;}
    openOverlay(place,posts);
    el.setAttribute('aria-expanded','true');
  });
  return el;
}
function drawMarkers(){
  if(!ready)return;
  markers.forEach(function(m){m.marker.remove();});
  markers=[];
  var stillOpen=false;
  // Reversed: markers stack in insertion order, so the quietest go down first
  // and the busiest neighborhood ends up on top. Added busiest-first, a pin
  // reading "38" would sit under whichever single post shares its block.
  PLACES.slice().reverse().forEach(function(place){
    var posts=postsFor(place);
    if(!posts.length)return;
    if(place.label===openPlace)stillOpen=true;
    var el=pinEl(place,posts);
    if(place.label===openPlace)el.setAttribute('aria-expanded','true');
    markers.push({el:el,marker:new maplibregl.Marker({element:el}).setLngLat([place.lon,place.lat]).addTo(map)});
  });
  // A filter change can hide the neighborhood whose overlay is open; leaving it
  // up would show posts with no pin behind them.
  if(openPlace&&!stillOpen)closeOverlay();
}
function start(){
  if(ready||starting)return;
  starting=true;
  load().then(function(){
    if(typeof maplibregl==='undefined')throw new Error('MapLibre unavailable');
    var opts={container:mapEl,style:STYLES[isDark()?'dark':'light'],scrollZoom:true,attributionControl:false};
    if(BOUNDS){opts.bounds=[[BOUNDS[0],BOUNDS[1]],[BOUNDS[2],BOUNDS[3]]];opts.fitBoundsOptions={padding:48,maxZoom:13};}
    else{opts.center=[PLACES[0].lon,PLACES[0].lat];opts.zoom=12;}
    map=new maplibregl.Map(opts);
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');
    map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    // compact:true only makes the control collapsible; MapLibre still renders it
    // open on a wide enough canvas, so it has to be folded shut explicitly — and
    // again after 'load', which re-expands it. Same fix as the /now/ map.
    collapseAttribution();
    map.on('load',collapseAttribution);
    map.once('idle',collapseAttribution);
    map.on('styledata',function(){if(isDark())recolorDarkBasemap(map);});
    map.on('click',closeOverlay);
    // Markers are DOM elements the map merely positions, so they can go on the
    // moment the Map exists — waiting for 'load' (style parsed + first frame)
    // would leave the pins missing on any browser that throttles rendering in a
    // background tab, where that event can be arbitrarily late or never come.
    ready=true;
    starting=false;
    drawMarkers();
    map.on('load',function(){map.resize();});
    map.on('error',function(e){if(e&&e.error)console.error('Thinking map',e.error);});
  }).catch(function(){
    starting=false;
    mapEl.classList.add('thinking-map--error');
    mapEl.textContent='Map could not be loaded.';
  });
}
new MutationObserver(function(){
  if(wrap.getAttribute('data-view')==='map'){
    start();
    if(map&&ready)setTimeout(function(){map.resize();drawMarkers();},50);
  }
}).observe(wrap,{attributes:true,attributeFilter:['data-view']});
// The type filters are shown in map view too, so the pins have to follow them.
// Watching aria-pressed rather than listening for clicks keeps this a reaction
// to the toggle script's committed state instead of a race against it.
var filterObs=new MutationObserver(function(){drawMarkers();});
document.querySelectorAll('.thinking-filter-btn').forEach(function(b){
  filterObs.observe(b,{attributes:true,attributeFilter:['aria-pressed']});
});
// A theme swap drops every custom layer; HTML markers survive setStyle, so only
// the basemap needs re-pointing.
new MutationObserver(function(){
  if(map&&ready)map.setStyle(STYLES[isDark()?'dark':'light']);
}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
if(wrap.getAttribute('data-view')==='map')start();
}());</script>`;

const thinkingArchiveFoot = `      <footer class="site-footer">
        <p class="footer-row footer-row-toggle"><span>&copy; 2026 ${escHtml(site.author)} <a href="/admin/" class="footer-icon" aria-label="Admin" title="Admin"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg></a></span><a href="#" class="theme-toggle" id="theme-toggle" role="button"></a><a href="/search/" class="footer-icon" aria-label="Search" title="Search"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/></svg></a></p>
        <p class="footer-row"><span>Subscribe via <a href="/feed.xml" type="application/atom+xml" class="footer-icon" aria-label="Atom feed" title="Atom feed"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg></a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';b.innerHTML=t==='dark'?'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>':'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';b.setAttribute('aria-label',l);b.title=l;localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'dark');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${thinkingViewToggleScript}
${thinkingMapScript}
${thinkingLightboxScript}
${thinkingDeleteLinkScript}
  </body>
</html>
`;

const thinkingGridHtml = thinkingGridGroupsHtml(microblogItems);
const microblogEntriesHtml = microblogListHtml(microblogItems);

const THINKING_VIEW_ICONS = {
  list: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="3" rx="1" fill="currentColor"/><rect x="2" y="8.5" width="16" height="3" rx="1" fill="currentColor"/><rect x="2" y="14" width="16" height="3" rx="1" fill="currentColor"/></svg>`,
  grid: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="2" y="11" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="11" width="7" height="7" rx="1" fill="currentColor"/></svg>`,
  map: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.75c-3 0-5.25 2.3-5.25 5.15 0 3.7 4.4 10.05 4.6 10.3a.8.8 0 0 0 1.3 0c.2-.25 4.6-6.6 4.6-10.3 0-2.85-2.25-5.15-5.25-5.15z" fill="currentColor"/><circle cx="10" cy="6.85" r="1.9" fill="var(--bg)"/></svg>`,
};

const THINKING_FILTER_LABELS = {
  photo: "Photos",
  video: "Videos",
  youtube: "YouTube",
  spotify: "Spotify",
  audio: "Audio",
  text: "Text",
};

const thinkingGridFiltersHtml = `        <div class="thinking-grid-filters" role="group" aria-label="Filter by type">
${THINKING_GRID_KINDS.map(
  (kind) =>
    `          <button type="button" class="thinking-filter-btn thinking-filter-btn--${kind}" data-filter="${kind}" aria-pressed="false" aria-label="${THINKING_FILTER_LABELS[kind]}">${THINKING_MEDIA_ICONS[kind]}</button>`
).join("\n")}
        </div>`;

const thinkingArchiveToolbarHtml = `      <div class="thinking-archive-toolbar">
${thinkingGridFiltersHtml}
        <div class="thinking-view-toggle" role="group" aria-label="Switch view">
        <button type="button" class="thinking-view-btn" data-view-btn="list" aria-pressed="true" aria-label="List view">${THINKING_VIEW_ICONS.list}</button>
        <button type="button" class="thinking-view-btn" data-view-btn="grid" aria-pressed="false" aria-label="Grid view">${THINKING_VIEW_ICONS.grid}</button>
        <button type="button" class="thinking-view-btn" data-view-btn="map" aria-pressed="false" aria-label="Map view">${THINKING_VIEW_ICONS.map}</button>
        </div>
      </div>`;

function readingGridItemHtml(r, linkUrlFn = readingLinkUrl, genres = []) {
  return readingGridItemHtmlShared(r, coverForReadingEntry(r), linkUrlFn(r), genres);
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
    .map((g) =>
      readingGridMonthHtml(
        g.label,
        g.items
          .map((r) => withLiveAttrs(readingGridItemHtml(r), liveKey(CONTENT_KIND.READING, r.id), readingSort(r)))
          .join("\n"),
        g.items[0].ym
      )
    )
    .join("\n");
}

const readingGridHtml = readingGridGroupsHtml(orderedReading);

const renderReadingFavoriteItem = (r) => renderReadingFavoriteItemShared(r, readingFavoriteLinkUrl(r));

const readingFavoritesAllHtml = orderedReadingFavorites
  .map((r) => withLiveAttrs(renderReadingFavoriteItem(r), liveKey(CONTENT_KIND.FAVORITE, r.id), r.title))
  .join("\n");

const readingFavoritesGridHtml =
  orderedReadingFavorites.length === 0
    ? ""
    : `        <div class="reading-grid"${liveListAttrs("favorites-grid", { order: "title" })}>
${orderedReadingFavorites
  .map((r) =>
    withLiveAttrs(readingGridItemHtml(r, readingFavoriteLinkUrl, r.genres), liveKey(CONTENT_KIND.FAVORITE, r.id), r.title)
  )
  .join("\n")}
        </div>`;

const readingGenreFiltersHtml =
  readingGenres.length > 0
    ? `      <div class="reading-genre-filter">
        <select class="reading-genre-select" aria-label="Filter by genre">
          <option value="">All genres</option>
${readingGenres
  .map(
    (genre) =>
      `          <option value="${escHtml(genre.slug)}">${escHtml(genre.label)}</option>`
  )
  .join("\n")}
        </select>
      </div>`
    : "";

const readingFavoritesPanelHtml =
  orderedReadingFavorites.length === 0
    ? `      <p class="reading-favorites-empty">No books here yet — check back soon.</p>`
    : `${readingGenreFiltersHtml}
      <ol class="post-list reading-list"${liveListAttrs("favorites", { order: "title" })}>
${readingFavoritesAllHtml}
      </ol>
      <div class="reading-grid-wrap">
${readingFavoritesGridHtml}
      </div>`;

const readingArchiveToolbarHtml = (activeTab = "latest") => `      <div class="reading-archive-toolbar">
        <nav class="reading-tabs" role="tablist" aria-label="Reading lists">
          <button type="button" class="reading-tab" role="tab" data-tab-btn="latest" aria-selected="${activeTab === "latest" ? "true" : "false"}">Latest</button>
          <button type="button" class="reading-tab" role="tab" data-tab-btn="favorites" aria-selected="${activeTab === "favorites" ? "true" : "false"}">Must Reads</button>
        </nav>
        <div class="reading-view-toggle" role="group" aria-label="Switch view">
          <button type="button" class="reading-view-btn" data-view-btn="list" aria-pressed="true" aria-label="List view">${THINKING_VIEW_ICONS.list}</button>
          <button type="button" class="reading-view-btn" data-view-btn="grid" aria-pressed="false" aria-label="Grid view">${THINKING_VIEW_ICONS.grid}</button>
        </div>
      </div>`;

const READING_GENRE_SLUGS = readingGenres.map((g) => g.slug);

const readingArchiveScript = `    <script>(function(){var wrap=document.querySelector('.reading-views');if(!wrap)return;var tabBtns=wrap.querySelectorAll('[data-tab-btn]');var viewBtns=wrap.querySelectorAll('.reading-view-btn');var scrollObs=null;var scrollSentinel=null;var favoritesPanel=wrap.querySelector('[data-tab-panel="favorites"]');var genreFilterSelect=favoritesPanel?favoritesPanel.querySelector('.reading-genre-select'):null;var genreSlugs=${JSON.stringify(READING_GENRE_SLUGS)};var activeGenre=null;var genreFilterActive=false;var TAB_PATH={latest:'/reading/latest/',favorites:'/reading/must-reads/'};var HASH_TAB={latest:'latest','must-reads':'favorites'};function normPath(){return location.pathname.replace(/\\/+$/,'')||'/';}function genreFromPath(){var p=normPath();if(p.indexOf('/reading/must-reads/')!==0)return null;var seg=p.slice('/reading/must-reads/'.length).replace(/\\/+$/,'');if(!seg)return null;return genreSlugs.indexOf(seg)>=0?seg:null;}function pathForGenre(){return activeGenre?'/reading/must-reads/'+activeGenre+'/':'/reading/must-reads/';}function tabFromPath(){var p=normPath();if(p==='/reading/latest')return'latest';if(p==='/reading/must-reads')return'favorites';if(p.indexOf('/reading/must-reads/')===0)return'favorites';return null;}function tabFromHash(){var h=location.hash.replace(/^#/,'');return HASH_TAB[h]||null;}function pathForTab(t){return TAB_PATH[t]||'/reading/latest/';}function activePanel(){return wrap.querySelector('[data-tab-panel="'+wrap.getAttribute('data-tab')+'"]');}function genreItemMatches(el){if(!genreFilterActive||!activeGenre)return true;var tags=(el.getAttribute('data-genres')||'').split(/\\s+/).filter(Boolean);return tags.indexOf(activeGenre)>=0;}function applyGenreFilters(){if(!favoritesPanel)return;var on=genreFilterActive&&activeGenre;if(genreFilterSelect)genreFilterSelect.value=on?activeGenre:'';favoritesPanel.querySelectorAll('.post-list li').forEach(function(el){el.hidden=on&&!genreItemMatches(el);});favoritesPanel.querySelectorAll('.reading-grid-item').forEach(function(el){el.hidden=on&&!genreItemMatches(el);});}function syncGenrePath(skipPath){if(skipPath||wrap.getAttribute('data-tab')!=='favorites')return;var want=pathForGenre();if(location.pathname!==want)history.replaceState(null,'',want);}function setGenreFromPath(){activeGenre=genreFromPath();genreFilterActive=Boolean(activeGenre);}function setTab(t,skipPath){wrap.setAttribute('data-tab',t);tabBtns.forEach(function(b){b.setAttribute('aria-selected',b.getAttribute('data-tab-btn')===t?'true':'false');});if(!skipPath){var want=pathForTab(t);if(location.pathname!==want||location.hash)history.replaceState(null,'',want);if(t!=='favorites'){activeGenre=null;genreFilterActive=false;}}applyGenreFilters();setupInfiniteScroll();}function setView(v){wrap.setAttribute('data-view',v);viewBtns.forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-view-btn')===v?'true':'false');});localStorage.setItem('readingView',v);}function setupInfiniteScroll(){if(scrollObs){scrollObs.disconnect();scrollObs=null;}if(scrollSentinel){scrollSentinel.remove();scrollSentinel=null;}if(wrap.getAttribute('data-tab')==='favorites'&&genreFilterActive&&activeGenre){return;}var panel=activePanel();if(!panel)return;var list=panel.querySelector('.post-list');if(!list)return;var items=list.querySelectorAll('li');items.forEach(function(li){if(!genreFilterActive||!activeGenre)li.hidden=false;});var BATCH=10;if(items.length<=BATCH)return;for(var i=BATCH;i<items.length;i++){if(!genreFilterActive||!activeGenre)items[i].hidden=true;}var shown=BATCH;scrollSentinel=document.createElement('div');scrollSentinel.className='reading-scroll-sentinel';panel.appendChild(scrollSentinel);scrollObs=new IntersectionObserver(function(e){if(!e[0].isIntersecting)return;var next=Math.min(shown+BATCH,items.length);for(var i=shown;i<next;i++){if(!genreFilterActive||!activeGenre)items[i].hidden=false;}shown=next;if(shown>=items.length){scrollObs.disconnect();scrollObs=null;}},{rootMargin:'0px'});scrollObs.observe(scrollSentinel);}var fromHash=tabFromHash();if(fromHash)history.replaceState(null,'',pathForTab(fromHash));setGenreFromPath();var initialTab=tabFromPath()||'latest';setTab(initialTab,true);setView(localStorage.getItem('readingView')||'list');tabBtns.forEach(function(b){b.addEventListener('click',function(){if(b.getAttribute('data-tab-btn')==='favorites'){activeGenre=null;genreFilterActive=false;}setTab(b.getAttribute('data-tab-btn'));});});viewBtns.forEach(function(b){b.addEventListener('click',function(){setView(b.getAttribute('data-view-btn'));});});if(genreFilterSelect){genreFilterSelect.addEventListener('change',function(){var slug=genreFilterSelect.value;if(!slug){activeGenre=null;genreFilterActive=false;}else{activeGenre=slug;genreFilterActive=true;}applyGenreFilters();setupInfiniteScroll();syncGenrePath();});}window.addEventListener('popstate',function(){setGenreFromPath();setTab(tabFromPath()||'latest',true);});}());</script>`;

const readingArchiveFoot = `      <footer class="site-footer">
        <p class="footer-row footer-row-toggle"><span>&copy; 2026 ${escHtml(site.author)} <a href="/admin/" class="footer-icon" aria-label="Admin" title="Admin"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg></a></span><a href="#" class="theme-toggle" id="theme-toggle" role="button"></a><a href="/search/" class="footer-icon" aria-label="Search" title="Search"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/></svg></a></p>
        <p class="footer-row"><span>Subscribe via <a href="/feed.xml" type="application/atom+xml" class="footer-icon" aria-label="Atom feed" title="Atom feed"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg></a></span><span><a href="/changelog/">Changelog</a> // <a href="/colophon/">Colophon</a></span></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';b.innerHTML=t==='dark'?'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>':'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';b.setAttribute('aria-label',l);b.title=l;localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'dark');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
${portraitPhotoToggleScript}
${readingArchiveScript}
${thinkingLightboxScript}
  </body>
</html>
`;

const readingPageHtml = (activeTab = "latest") => `${archiveHead("Reading", sectionHeading("Reading", "h1"))}
    <div class="reading-views" data-view="list" data-tab="${activeTab}">
${readingArchiveToolbarHtml(activeTab)}
      <div class="reading-tab-panel" data-tab-panel="latest">
        <p class="reading-tab-intro">${READING_TAB_INTROS.latest}</p>
        <ol class="post-list reading-list"${liveListAttrs("reading")}>
${readingAllHtml}
        </ol>
        <div class="reading-grid-wrap" data-live-groups="reading-grid">
${readingGridHtml}
        </div>
      </div>
      <div class="reading-tab-panel" data-tab-panel="favorites">
        <p class="reading-tab-intro">${READING_TAB_INTROS.mustReads}</p>
${readingFavoritesPanelHtml}
      </div>
    </div>
${readingArchiveFoot}`;

const microblogPageHtml = `${archiveHead("Thinking", sectionHeading("Thinking", "h1"))}
    <div class="thinking-views" data-view="list">
${thinkingArchiveToolbarHtml}
      <div class="microblog-feed"${liveListAttrs("thinking")}>
${microblogEntriesHtml}
      </div>
      <div class="thinking-grid-wrap" data-live-groups="thinking-grid">
${thinkingGridHtml}
      </div>
${thinkingMapViewHtml}
    </div>
${thinkingArchiveFoot}`;

const archiveUrls = [
  ...(hasMorePosts ? [`${base}/writing/`] : []),
  ...(hasReadingArchive
    ? [
        `${base}/reading/latest/`,
        `${base}/reading/must-reads/`,
        ...readingGenres.map((g) => `${base}/reading/must-reads/${g.slug}/`),
      ]
    : []),
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
  ...Object.values(THINKING_FILTER_PATH).map((segment) => `${base}/thinking/${segment}/`),
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

// ── Search ──────────────────────────────────────────────────────────────────
// The whole corpus is a few hundred short items, so the index ships as one
// JSON file and matching runs in the browser. See scripts/lib/search.mjs.
const searchDocs = [
  ...ordered.map((p) => ({
    k: "writing",
    t: p.title || "",
    x: truncateSearchText(`${p.summary || ""} ${stripHtml(p.body_html)}`.trim(), MAX_TEXT),
    u: `/posts/${safeSlug(p.slug)}/`,
    d: p.datetime || p.date || "",
  })),
  ...microblogItems.map((item) => ({
    k: "thinking",
    t: "",
    x: truncateSearchText(stripHtml(stripMediaMarkup(item.content_html)), MAX_TEXT),
    u: `/thinking/${thinkingSlug(item)}/`,
    d: item.date_published || "",
  })),
  ...orderedReading.map((r) => ({
    k: "reading",
    t: r.title || "",
    x: r.author || "",
    u: r.url || "/reading/latest/",
    d: r.ym || r.added_at || "",
  })),
  ...orderedReadingFavorites.map((r) => ({
    k: "must-read",
    t: r.title || "",
    x: r.author || "",
    u: r.url || "/reading/must-reads/",
    d: r.added_at || "",
  })),
  ...orderedLinklog.map((l) => ({
    k: "sharing",
    t: l.title || "",
    x: linkDomain(l.url) || "",
    u: l.url || "/sharing/",
    d: l.datetime || l.date || "",
  })),
  // A Thinking note with no text (a bare photo, say) has nothing to match on.
].filter((doc) => doc.t || doc.x);

const searchPageHtml = `${archiveHead("Search", null)}
      <form class="search-form" id="search-form" role="search">
        <label class="visually-hidden" for="search-input">Search this site</label>
        <input
          id="search-input"
          type="search"
          name="q"
          placeholder="Search writing, thinking, reading, sharing…"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </form>
      <p class="search-status" id="search-status" aria-live="polite"></p>
      <ul class="search-results" id="search-results"></ul>
${archiveFoot(`    <script type="module" src="/search.js?v=${cssV}"></script>`)}`;

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
const redirectLines = [];
if (hasReadingArchive) {
  for (const [tab, slug] of [
    ["latest", "latest"],
    ["favorites", "must-reads"],
  ]) {
    mkdirSync(join(outDir, "reading", slug), { recursive: true });
    writeFileSync(join(outDir, "reading", slug, "index.html"), readingPageHtml(tab), "utf8");
  }
  for (const genre of readingGenres) {
    mkdirSync(join(outDir, "reading", "must-reads", genre.slug), { recursive: true });
    writeFileSync(
      join(outDir, "reading", "must-reads", genre.slug, "index.html"),
      readingPageHtml("favorites"),
      "utf8"
    );
    redirectLines.push(`/reading/must-reads/${genre.slug} /reading/must-reads/${genre.slug}/ 301`);
  }
  redirectLines.push("/reading /reading/latest/ 301", "/reading/ /reading/latest/ 301");
}
for (const segment of Object.values(THINKING_FILTER_PATH)) {
  redirectLines.push(`/thinking/${segment} /thinking/${segment}/ 301`);
}
if (redirectLines.length) {
  writeFileSync(join(outDir, "_redirects"), `${redirectLines.join("\n")}\n`, "utf8");
}
manageArchive(hasMoreLinklog, "sharing", sharingPageHtml);

mkdirSync(join(outDir, "now"), { recursive: true });
writeFileSync(join(outDir, "now/index.html"), nowPageHtml, "utf8");

mkdirSync(join(outDir, "changelog"), { recursive: true });
writeFileSync(join(outDir, "changelog/index.html"), changelogPageHtml, "utf8");

mkdirSync(join(outDir, "thinking"), { recursive: true });
writeFileSync(join(outDir, "thinking/index.html"), microblogPageHtml, "utf8");
for (const segment of Object.values(THINKING_FILTER_PATH)) {
  mkdirSync(join(outDir, "thinking", segment), { recursive: true });
  writeFileSync(join(outDir, "thinking", segment, "index.html"), microblogPageHtml, "utf8");
}

function thinkingPermalinkPageHtml(v) {
  return `${thinkingPostHead(v)}
      ${v.body}
${thinkingDeletePanelHtml}
${thinkingPostFoot}`;
}

// Individual thinking post pages — preload video on detail pages for faster playback start
for (const item of microblogItems) {
  const slug = thinkingSlug(item);
  const row = thinkingPosts.find((p) => p.slug === slug);
  const detailContent = row
    ? thinkingContentHtmlFromRow(row, { videoPreload: "auto" })
    : item.content_html;
  const parts = thinkingPermalinkParts(item, slug, detailContent, pageCtx, renderCtx);
  const postHtml = thinkingPermalinkPageHtml(parts);
  mkdirSync(join(outDir, "thinking", slug), { recursive: true });
  writeFileSync(join(outDir, "thinking", slug, "index.html"), postHtml, "utf8");
}

// Templates for the live overlay: each permalink page with a LIVE_TOKENS
// marker in every slot that varies. The Worker fills them for a note or post
// the rebuild has not written yet (scripts/lib/render/pages.mjs).
for (const [kind, html] of [
  ["thinking", thinkingPermalinkPageHtml(LIVE_TOKENS)],
  ["post", postPageHtml(LIVE_TOKENS)],
]) {
  const dir = join(outDir, LIVE_TEMPLATE_PATHS[kind]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf8");
}

mkdirSync(join(outDir, "search"), { recursive: true });
writeFileSync(join(outDir, "search/index.html"), searchPageHtml, "utf8");
writeFileSync(join(outDir, "search-index.json"), JSON.stringify(searchDocs), "utf8");
// search.mjs is plain ES module JS with no Node APIs, so it ships to the
// browser as-is. search-page.mjs imports it as "./search-core.js", the name it
// takes in dist/ — that specifier is only ever resolved by the browser.
cpSync(join(root, "scripts/lib/search.mjs"), join(outDir, "search-core.js"));
cpSync(join(root, "scripts/lib/search-page.mjs"), join(outDir, "search.js"));

// Writing post pages
// `ordered` is newest-first, so the newer neighbour is i - 1.
ordered.forEach((p, i) => {
  const slug = safeSlug(p.slug);
  mkdirSync(join(outDir, "posts", slug), { recursive: true });
  const parts = postPermalinkParts(p, ordered[i - 1] || null, ordered[i + 1] || null, pageCtx);
  writeFileSync(join(outDir, "posts", slug, "index.html"), postPageHtml(parts), "utf8");
});

const STATIC_ENTRIES = ["styles.css", "thinking-composer.js", "favicon.png", "about", "admin", "colophon", "contact", "_headers", "_redirects"];
for (const entry of STATIC_ENTRIES) {
  const src = join(root, entry);
  if (existsSync(src)) {
    cpSync(src, join(outDir, entry), { recursive: true });
  }
}

// The watermark as a response header too, so the live overlay can tell from
// the headers alone that a page is current and stream it through untouched.
// It goes *inside* the existing /* block. A second /* block is not merged
// with the first: Pages applied only the later one, and every page lost its
// CSP, X-Frame-Options and HSTS until this was moved.
{
  const headersPath = join(outDir, "_headers");
  const lines = readFileSync(headersPath, "utf8").split("\n");
  const at = lines.findIndex((line) => line.trim() === "/*");
  if (at === -1) throw new Error("_headers has no /* block for X-Live-Watermark");
  lines.splice(at + 1, 0, `  X-Live-Watermark: ${liveWatermark}`);
  writeFileSync(headersPath, lines.join("\n"), "utf8");
}

console.log(`Wrote ${outDir}/ (generated pages + static assets)`);

// ── Every image reference must resolve ─────────────────────────────────────
//
// Run over the finished output rather than over the sources, so it checks what
// actually ships — including pages assembled from several places. The Veri post
// carried `src="veri-ad.png"` for months: Pages answers an unknown path with
// its HTML fallback and a 200, so a browser gets text/html where it expects an
// image and renders a broken one. Nothing 404s and nothing is logged, which is
// why this fails the build instead of warning. See lib/validate-images.mjs.
const builtPages = [];
for (const file of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith(".html")) continue;
  const abs = join(file.parentPath ?? file.path, file.name);
  const rel = relative(outDir, abs);
  const urlPath = `/${rel.replace(/index\.html$/, "").replace(/\\/g, "/")}`;
  builtPages.push({ urlPath, html: readFileSync(abs, "utf8") });
}

const brokenImages = findBrokenImages(builtPages, (target) =>
  existsSync(join(outDir, target))
);
if (brokenImages.length > 0) {
  console.error(`\n${formatBrokenImages(brokenImages)}\n`);
  process.exit(1);
}
console.log(`Checked ${builtPages.length} pages — every image reference resolves.`);
