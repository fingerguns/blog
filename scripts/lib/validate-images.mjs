/**
 * Catch image references that will not resolve, at build time.
 *
 * The Veri post shipped a broken image for months because nothing checked. Its
 * body carried `src="veri-ad.png"` — a bare relative filename — and Cloudflare
 * Pages answers an unknown path with its HTML fallback and a **200**, so the
 * browser received text/html where it expected an image and rendered a broken
 * one. Nothing 404s, nothing logs, nothing alerts. The only way to notice is to
 * look at the page.
 *
 * That silence is the reason this is a build failure rather than a warning: a
 * warning in a Pages build log is only marginally louder than the 200 that
 * caused the problem.
 *
 * Only locally-resolvable references are checked. External URLs cannot be
 * verified without the network, and `/media/*` is served by the Worker out of
 * R2 rather than from `dist/`, so neither is this function's business. What is
 * left is exactly the class of mistake that bit us: a path that looks like a
 * file in the built site and is not one.
 */

const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']*)["'][^>]*>/gi;

/** Every `src` on an `<img>` in the given HTML, in document order. */
export function imageSources(html) {
  const out = [];
  for (const m of String(html || "").matchAll(IMG_SRC_RE)) out.push(m[1]);
  return out;
}

/**
 * Can this reference be checked against files on disk?
 *
 * Skipped, with reasons:
 *   - empty            a lightbox placeholder the client fills in later
 *   - data:/blob:      carries its own bytes
 *   - http(s):// , //  someone else's server
 *   - /media/*         the Worker serves it from R2, not from dist/
 *   - #, ?             not a path
 */
export function isLocallyCheckable(src) {
  const s = String(src || "").trim();
  if (!s) return false;
  if (/^(?:data|blob|mailto):/i.test(s)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false;
  if (s.startsWith("//")) return false;
  if (s.startsWith("#") || s.startsWith("?")) return false;
  if (s.startsWith("/media/")) return false;
  return true;
}

/**
 * Where a reference should land, as a path relative to the output root.
 *
 * `pageUrlPath` is the page's own directory URL (e.g. `/posts/thing/`), because
 * a relative `src` resolves against the page, not the site root — which is
 * precisely what made `veri-ad.png` point at
 * `/posts/for-the-film-buffs-out-there-veri/veri-ad.png`.
 */
export function resolveToOutputPath(src, pageUrlPath) {
  const clean = String(src).split("#")[0].split("?")[0];
  if (clean.startsWith("/")) return decodeURIComponent(clean.replace(/^\/+/, ""));

  const dir = String(pageUrlPath || "/").replace(/[^/]*$/, "");
  const joined = new URL(clean, `https://x${dir.startsWith("/") ? dir : `/${dir}`}`).pathname;
  return decodeURIComponent(joined.replace(/^\/+/, ""));
}

/**
 * Check every page's images against a set of files that exist.
 *
 * `pages` is `[{ urlPath, html }]`; `exists` answers whether an output-relative
 * path is present. Returns one entry per broken reference rather than throwing,
 * so the caller can report all of them at once — finding them one build at a
 * time would be its own kind of slow.
 */
export function findBrokenImages(pages, exists) {
  const broken = [];
  for (const { urlPath, html } of pages) {
    for (const src of imageSources(html)) {
      if (!isLocallyCheckable(src)) continue;
      const target = resolveToOutputPath(src, urlPath);
      if (!exists(target)) broken.push({ urlPath, src, target });
    }
  }
  return broken;
}

/** A message that says what is wrong and where, without needing a stack trace. */
export function formatBrokenImages(broken) {
  const lines = broken.map(
    (b) => `  ${b.urlPath}\n    src="${b.src}"  ->  dist/${b.target} (missing)`
  );
  return (
    `${broken.length} image reference${broken.length === 1 ? "" : "s"} will not resolve:\n` +
    `${lines.join("\n")}\n\n` +
    `Pages serves an unknown path as HTML with a 200, so these render as broken\n` +
    `images rather than 404s. Upload the file to R2 and reference /media/..., or\n` +
    `add it to the built output.`
  );
}
