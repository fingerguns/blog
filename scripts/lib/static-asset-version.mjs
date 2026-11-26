/**
 * Hand-authored pages (about/, admin/, colophon/, contact/) are copied into
 * dist/ verbatim, and their links to styles.css and the admin's scripts
 * (thinking-composer.js, oura-dashboard.js)
 * carried no version. Pages serves both with a four-hour max-age, so after a
 * deploy those pages kept the old files while the generated ones, which link
 * `styles.css?v=…`, had the new: a style fix reached the admin's Writing editor
 * (styled inline) but not its Thinking composer (styled by styles.css). The
 * build now stamps the same version on these links as it copies the pages.
 */
const VERSIONED_ASSET_LINK = /((?:href|src)="[^"?#]*(?:styles\.css|thinking-composer\.js|oura-dashboard\.js))"/g;

export function versionStaticAssetLinks(html, version) {
  return String(html).replace(VERSIONED_ASSET_LINK, `$1?v=${encodeURIComponent(version)}"`);
}
