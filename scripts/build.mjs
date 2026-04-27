/**
 * Rebuilds index.html and feed.xml from data/posts.json
 * Run from project root: node scripts/build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const data = JSON.parse(readFileSync(join(root, "data/posts.json"), "utf8"));
const { site, posts, links, optionalColophon } = data;

const base = site.url.replace(/\/$/, "");
const sortDesc = (a, b) => {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  // deterministic tie-break for same-day posts
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

function toIsoZ(dateStr) {
  const d = new Date(dateStr + "T12:00:00.000Z");
  return d.toISOString();
}

const latest = ordered[0];
const feedUpdated = latest ? toIsoZ(latest.date) : toIsoZ("2020-01-01");

const safeSlug = (s) => String(s).replace(/[^a-zA-Z0-9-_]/g, "");

const postListHtml = ordered
  .map(
    (p) => `          <li>
            <span class="post-date">${escHtml(p.date)}</span>
            <a href="posts/${escHtml(safeSlug(p.slug))}.html">${escHtml(p.title)}</a>
          </li>`
  )
  .join("\n");

const linksHtml = (links || [])
  .map(
    (l) => `          <li>
            <a href="${escHtml(l.url)}" rel="me noopener">${escHtml(l.label)}</a>
          </li>`
  )
  .join("\n");

const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(site.title)}</title>
    <meta
      name="description"
      content="${escHtml(site.description)}"
    />
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
      <p class="lead">${escHtml(site.description)}</p>

      <section aria-labelledby="posts-heading">
        <h2 id="posts-heading">Writing</h2>
        <ol class="post-list" reversed>
${postListHtml}
        </ol>
      </section>

      <section aria-labelledby="links-heading">
        <h2 id="links-heading">Elsewhere</h2>
        <ul class="link-list">
${linksHtml}
        </ul>
      </section>

      <footer class="site-footer">
        <p>
          Subscribe via
          <a href="feed.xml" type="application/atom+xml">Atom feed</a>
          (add <code>feed.xml</code> to your reader).
        </p>
      </footer>

      <section class="colophon" aria-label="Colophon">
        <p>${escHtml(optionalColophon || "")}</p>
      </section>
    </main>
  </body>
</html>
`;

const entries = ordered
  .map((p) => {
    const id = `${base}/posts/${safeSlug(p.slug)}.html`;
    const t = toIsoZ(p.date);
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
  <subtitle type="text">${escXml(site.description)}</subtitle>
${entries}
</feed>
`;

writeFileSync(join(root, "index.html"), indexHtml, "utf8");
writeFileSync(join(root, "feed.xml"), feedXml, "utf8");
console.log("Wrote index.html and feed.xml");
