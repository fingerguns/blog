/**
 * Rebuilds index.html, feed.xml, robots.txt, and sitemap.xml from data/posts.json
 * Run from project root: node scripts/build.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const data = JSON.parse(readFileSync(join(root, "data/posts.json"), "utf8"));
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

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toIsoZ(p) {
  const d = p.datetime ? new Date(p.datetime) : new Date(`${p.date}T12:00:00.000Z`);
  return d.toISOString();
}

const latest = ordered[0];
const feedUpdated = latest ? toIsoZ(latest) : new Date("2020-01-01T12:00:00.000Z").toISOString();

const safeSlug = (s) => String(s).replace(/[^a-zA-Z0-9-_]/g, "");

const MAX_PER_SECTION = 5;

// Changelog from git log
let changelogEntries = [];
try {
  const raw = execSync(
    'git log --pretty=format:"%H|||%ad|||%s" --date=format:"%Y-%m-%d"',
    { cwd: root, encoding: "utf8" }
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
            <span class="post-date">${escHtml(p.date)}</span>
            <a href="${absolute ? `/posts/${escHtml(safeSlug(p.slug))}/` : `posts/${escHtml(safeSlug(p.slug))}/`}">${escHtml(p.title)}</a>
          </li>`;

const orderedReading = [...(reading || [])].sort((a, b) => {
  const aYm = String(a.ym || "");
  const bYm = String(b.ym || "");
  if (aYm !== bYm) return aYm < bYm ? 1 : -1;
  return String(a.title || "").localeCompare(String(b.title || ""));
});
const renderReadingItem = (r) =>
  `          <li>
            <span class="post-date">${escHtml(r.ym)}</span>
            <a href="${escHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escHtml(r.title)}</a>
          </li>`;

const stripHashtags = (s) => String(s).replace(/\s*#\S+/g, "").trim();

const orderedLinklog = [...(linklog || [])].sort(sortDesc);
const renderLinklogItem = (l) =>
  `          <li>
            <span class="post-date">${escHtml(l.date)}</span>
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

const thinkingSection =
  thinking && thinking.text
    ? `      <section aria-labelledby="now-heading">
        <h2 id="now-heading">Now</h2>
        <ol class="post-list">
          <li>
            <span>${escHtml(thinking.text)}</span>
          </li>
        </ol>
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
        ${hasMorePosts ? '<a class="see-more" href="/writing/">See more →</a>' : ""}
      </section>

      <section aria-labelledby="reading-heading">
        <h2 id="reading-heading">Reading</h2>
        <ol class="post-list" reversed>
${readingHtml}
        </ol>
        ${hasMoreReading ? '<a class="see-more" href="/reading/">See more →</a>' : ""}
      </section>

      <section aria-labelledby="linklog-heading">
        <h2 id="linklog-heading">Sharing</h2>
        <ol class="post-list" reversed>
${linklogHtml}
        </ol>
        ${hasMoreLinklog ? '<a class="see-more" href="/sharing/">See more →</a>' : ""}
      </section>

      <section aria-labelledby="links-heading">
        <h2 id="links-heading">Elsewhere</h2>
        <ul class="link-list">
${linksHtml}
        </ul>
      </section>

      <footer class="site-footer">
        <p class="footer-row">&copy; 2026 ${escHtml(site.author)}<a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span>Subscribe via <a href="feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a>.</span><a href="/changelog/">Changelog</a></p>
      </footer>

${colophonSection}    </main>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
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
  </head>
  <body>
    <article class="post">
      <a class="post-back" href="/">← Home</a>
      <h1>${escHtml(title)}</h1>`;

const archiveFoot = `      <footer class="site-footer">
        <p class="footer-row">&copy; 2026 ${escHtml(site.author)}<a href="#" class="theme-toggle" id="theme-toggle"></a></p>
        <p class="footer-row"><span><a href="/feed.xml" type="application/atom+xml">Atom feed</a> or <a href="https://buttondown.com/rommy" target="_blank" rel="noopener">Buttondown</a></span><a href="/changelog/">Changelog</a></p>
      </footer>
    </article>
    <script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var h=document.documentElement;function set(t){h.setAttribute('data-theme',t);b.textContent=t==='dark'?'Light mode':'Dark mode';localStorage.setItem('theme',t);}set(localStorage.getItem('theme')||'light');b.addEventListener('click',function(e){e.preventDefault();set(h.getAttribute('data-theme')==='dark'?'light':'dark');});}());</script>
    <script>(function(){var BATCH=10;var list=document.querySelector('.post-list');if(!list)return;var items=list.querySelectorAll('li');if(items.length<=BATCH)return;for(var i=BATCH;i<items.length;i++)items[i].hidden=true;var shown=BATCH;var sentinel=document.createElement('div');list.parentNode.insertBefore(sentinel,list.nextSibling);var obs=new IntersectionObserver(function(e){if(!e[0].isIntersecting)return;var next=Math.min(shown+BATCH,items.length);for(var i=shown;i<next;i++)items[i].hidden=false;shown=next;if(shown>=items.length)obs.disconnect();},{rootMargin:'200px'});obs.observe(sentinel);}());</script>
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
const nowMonthYear = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
const currentBook = orderedReading[0];
const nowPageHtml = `${archiveHead("Now")}
      <p class="lead">Updated ${escHtml(nowMonthYear)} &middot; Brooklyn, NY &middot; <a href="https://nownownow.com/about" target="_blank" rel="noopener">What's this?</a></p>
      <div class="body">
${thinking && thinking.text ? `        <h2>Thinking</h2>
        <p>${escHtml(thinking.text)}</p>
` : ""}${currentBook ? `        <h2>Reading</h2>
        <p><a href="${escHtml(currentBook.url)}" target="_blank" rel="noopener">${escHtml(currentBook.title)}</a></p>
` : ""}        <h2>Working</h2>
        <p>Data by day. Writing when I can. Walking more than I should have to explain.</p>
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

const archiveUrls = [
  ...(hasMorePosts ? [`${base}/writing/`] : []),
  ...(hasMoreReading ? [`${base}/reading/`] : []),
  ...(hasMoreLinklog ? [`${base}/sharing/`] : []),
];

const urls = [
  `${base}/`,
  `${base}/feed.xml`,
  `${base}/now/`,
  `${base}/changelog/`,
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

console.log("Wrote index.html, feed.xml, robots.txt, sitemap.xml, now/index.html, and changelog/index.html");
