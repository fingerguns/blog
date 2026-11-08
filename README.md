# rommy.blog

Personal blog at [rommy.blog](https://rommy.blog). Plain static HTML at deploy time; content and media are managed through a small admin UI backed by Cloudflare.

Built with [Cursor](https://cursor.com). See the [colophon](https://rommy.blog/colophon/) for the full story of how the site works.

## What you get

- **Static site** — HTML, CSS, Atom feed, sitemap; no runtime npm dependencies on Pages
- **Content in D1** — Writing posts, drafts, Reading, Sharing, and the homepage Thinking blurb
- **Media in R2** — Photos (up to 4 per Thinking post), audio, and video (up to 1 GB) for Thinking; photos for Writing (public bucket)
- **Photo gallery** — a single landscape Thinking photo fills the column width at its own aspect ratio, uncropped; a single portrait or square photo renders as a square crop at two-thirds of the column width; 2–4 render as a cropped, equal-size 2×2 grid; click opens a full-viewport lightbox — the photo swoops up out of its tile, and back into the tile of whichever photo is showing on close — with prev/next, keyboard arrows, infinite swipe on mobile, and an eased click-to-zoom, closed by tapping the backdrop
- **Homepage composer** — in a browser signed in to the admin (the same `admin_session` the post-page edit and delete links look for), a small down-caret appears centred under the rule beneath the site title; it drops the Thinking composer down into view, and an up-caret beneath the composer folds it away. Everyone else sees nothing, and the Worker still checks the password on every post. The composer is one implementation, `thinking-composer.js` at the site root, mounted both here and in the admin's Thinking tab (it builds its own markup; its styles live in `styles.css` under `.thinking-composer`). The homepage only fetches it on the first open, and after a post reloads so the live overlay shows the new note straight away
- **Admin** — Password-protected UI at `/admin/` (Thinking, Writing, Reading, Sharing, Location, Health, Login). Every tab has its own URL — `/admin/thinking`, `/admin/writing`, `/admin/reading`, `/admin/sharing`, `/admin/location`, `/admin/health`, and `/admin/login` (`/admin/` opens Login too) — so a tab can be bookmarked, reloaded, and reached with the back button. Those paths are not files: `_redirects` rewrites each one to the single admin page (a 200 rewrite, so the address bar keeps the tab's URL), which reads `location.pathname` to decide which tab to open, and pushes a new URL when you switch tabs. Everything but Login is behind the password: arriving at a working tab's URL signed out — or reaching one with the back button after signing out — sends you to [rommy.blog](https://rommy.blog). That bounce is a courtesy, not a boundary — every one of those URLs serves the same file, and what protects the content is Cloudflare Access on the `/admin` prefix plus the password the Worker demands on every API call
- **Health tab** — Cron syncs, rebuilds, and syndication attempts record their outcome to D1 (`job_runs`); the **Health** tab in `/admin/` lists every job's last run plus a recent-run log, and its tab dot is visible from whichever tab you're on, so a silent background failure stops being silent. The dot reads by recency, not by history: **red** when a job's *latest* run failed or a scheduled job has gone stale, **amber** when a job failed inside the 7-day window but has succeeded since, **green** when the window is clean. A blip a job has already recovered from no longer holds the dot red for the rest of the week. A redundant Pages deploy hook — a publish fires it more than once within seconds, and Pages answers the second call `304` because the build is already queued — records as `skipped` rather than as a failure
- **Cross-posting** — Thinking can publish to [Micro.blog](https://micro.blog) (Micropub), [Bluesky](https://bsky.app), and [Mastodon](https://joinmastodon.org) when configured; photos, audio, and video render as native attachments/players in each feed (see [Audio & Video Syndication](#audio--video-syndication) below), with the Thinking permalink included in the syndicated text alongside native media. Writing, Reading, and Sharing cross-posts to Bluesky include link cards, as does a text-only Thinking note that contains a link (the card is that link's, fetched at post time); large og:image thumbnails are compressed to ≤ 1 MB before upload
- **Comments** — [Webmentions](https://webmention.io) on Writing posts: incoming likes, reposts, and replies are received by webmention.io and rendered client-side; [Bridgy](https://brid.gy) bridges Mastodon replies/boosts back in
- **Writing editor** — [Quill](https://quilljs.com/) with image upload, text wrap (left / right / center / full), drafts, and post version history
- **Managing published posts** — the Writing tab's **Published** sub-tab lists every published post (newest first) with a link to the live page plus Edit, Unpublish, and Delete. Post pages carry matching `edit`, `unpublish`, and `delete` links beside the reading time, injected client-side only when a signed-in admin session is present in that browser. Edit lands on `/admin/?post=<slug>`, which loads the post and settles on `/admin/writing`; Unpublish and Delete open the post at `?unpublish` / `?delete` and confirm on the page rather than in a pop-up (the same flow the Thinking archive uses, so it works on a phone)
  - **Unpublish** takes the post off the site and writes its text back to Drafts, *keeping* `post_versions` — republishing derives the same slug from the same title, so the history continues. Republishing does send a fresh cross-post
  - **Delete** drops the post *and* its version history
  - Neither retracts cross-posts already sent to Micro.blog, Bluesky, or Mastodon — Writing posts don't store their syndication URLs. The Worker still checks the password on `fetch-post` / `edit-post` / `unpublish-post` / `delete-post`
- **Writing archive views** — [`/writing/`](https://rommy.blog/writing/) has two icon buttons right-aligned on the heading's line: **collapsed** (date and title, the default) and **expanded** (every post in full, one after another, like a feed). Each expanded post opens with the same header as its permalink: the title at the permalink's size (linking to it), then the date with `N min read · N views` opposite. Views come from one request to `GET /api/views?kind=posts` (`handleThinkingViews` in `worker/page-views.mjs`, which answers Thinking counts by default), made the first time the feed is opened. The choice is remembered per browser in `localStorage` (`writing-view`). Each list item carries its body in a `<template>` (`renderPostItem(p, true, { withBody: true })` in `scripts/lib/render/lists.mjs`, also used by the live overlay's `writing` list), which the browser parses but never renders or loads media for, so the collapsed view renders and fetches exactly what it did before — though the page's HTML roughly doubles, since every body ships with it; expanding clones the bodies in with lazy-loaded images and works with the archive's infinite scroll. Without JavaScript the buttons stay hidden and the page is the collapsed list. Writing, Reading and Sharing carry the same floating **Back to top** button as Thinking (`archiveBackToTopHtml`/`archiveBackToTopScript` in `build.mjs`, opted into via `archiveFoot`'s `backToTop` option)
- **Post pager** — every Writing post ends with Older / Newer links to its neighbours in the archive (`rel="prev"` / `rel="next"`), above **↑ Top**
- **Design tokens** — `styles.css` defines the palette and an eight-step type scale (`--fs-xs` … `--fs-3xl`) on `:root`; every fixed font size uses a step. Light-mode muted gray is `#666666` (≥ 4.5:1 on the page background, WCAG AA); every link, button and field shows one `:focus-visible` ring; icon-only links (`←`, `→`) carry `aria-label`s and the theme toggle has `role="button"`
- **Social previews** — Open Graph / Twitter meta on Writing and Thinking permalinks (first in-post image, or a native video's still frame, or the favicon)
- **Link cards in Thinking** — every URL in a note stays an inline link (the visible label drops `https://` and, past 40 characters, ends in an ellipsis; the href is still the full URL, and the syndicated text is sent unshortened) and also unfurls into a preview card (source, title, image, description) beneath the note — on the homepage, the `/thinking/` archive, and the permalink — except YouTube links (native video embed) and Spotify links (native track/album/playlist/episode/show/artist embed), which render as players below the note instead. A link whose page can't be read (a bot gate, a timeout, no preview tags) still gets a plainer card when its URL reads as words: publication name and a title rebuilt from the last path segment, no image or description
- **Thinking archive views** — [`/thinking/`](https://rommy.blog/thinking/) offers List, Grid and Map views (icon buttons under the heading; choice remembered in `localStorage`). Grid groups notes by month with one square thumbnail per post — photos via edge-resized 512px thumbs, native video via stored JPEG posters, YouTube via preview images, Spotify via album art, or a text-preview card. Every tile carries a small corner badge for its kind, photo tiles included. Six type-filter buttons (photo, video, audio, YouTube, Spotify, text) solo-select one kind at a time; all posts show until a filter is chosen; filters apply to all three views. Links to the archive always land on `/thinking/` unfiltered; choosing a filter updates the URL to a shareable path (`/thinking/images/`, `/thinking/videos/`, `/thinking/audio/`, `/thinking/youtube/`, `/thinking/music/`, `/thinking/text/`). Grid images load lazily when grid view is active. Switching between List and Grid animates on a spring: each note on screen travels between its list position and its grid tile, and the other tiles spring in one by one Past the first screen of scrolling, a **Back to top** button with an up arrow floats in the bottom-right corner
- **Thinking map view** — the third view pins every located note on a MapLibre map (same OpenFreeMap basemaps and theme toggle as `/now/` and the admin Location tab). A note stores a neighborhood *label*, never a coordinate — the GPS log behind those labels stays private — so the build forward-geocodes the distinct labels through Nominatim and pins at the neighborhood centre. That means posts sharing a neighborhood share an exact point, which is why there is no clustering library: one marker per neighborhood, showing the post's type icon when it is alone and a count when it is not. Clicking a marker opens an overlay with each post's text and a permalink; clicking the map closes it, as does clicking the same marker again. The type filters apply here too. The OpenStreetMap attribution is folded to its `(i)` button on load — `compact: true` only makes the control collapsible, MapLibre still renders it open on a wide canvas and re-expands it on `load`, so it is collapsed explicitly (the same fix `/now/` uses); it still expands on click, which the OSM licence requires
- **Reading archive views** — [`/reading/latest/`](https://rommy.blog/reading/latest/) and [`/reading/must-reads/`](https://rommy.blog/reading/must-reads/) are path-based tabs (URL updates on switch). Sorted by read month (`ym`), not date added. List/grid toggle (remembered in `localStorage`); grid is a storefront-style cover catalog grouped by month (3 columns desktop, 2 mobile). Each tab opens with a taste summary redrafted by Claude Fable when books change. Optional author field and multi-source cover picker (Open Library, Apple Books, Google Books) in admin; custom covers can live in R2 under `reading/covers/`
- **Section tooltips** — Homepage section headings have hover/focus blurbs stored in D1, rendered beside the heading (linked with `aria-describedby`) rather than inside it, so the heading — and every section labelled by it — is just its one-word name; Claude Fable regenerates them after content changes (`refresh-section-hints` admin action or `npm run refresh-section-hints`)
- **Reading tab intros** — Latest and Must Reads tabs have visitor-facing taste summaries stored in D1; Claude Fable redrafts them when books are added or removed (`refresh-reading-tab-intros` or `npm run refresh-reading-tab-intros` from repo root or `worker/`)
- **Must Reads genre tags** — Each curated favorite gets 1–3 AI-assigned genre tags (primary required) stored in D1; a genre dropdown on `/reading/must-reads/` filters the list, with shareable paths like `/reading/must-reads/literary-realism/`. Tags are assigned automatically when books are added and pruned when unused after removal (`backfill-reading-genres` or `npm run backfill-reading-genres` for existing titles)
- **Link card style** — Thinking and Sharing-archive cards share the `.linklog-card` styles: a raised surface one shade off the page (`--surface`, lighter in dark mode and darker in light, brightening on hover), rounded corners and no border, the preview image as a full-height panel flush with the left edge (centre-cropped, so it fills its side however long the title runs; phones leave it out and show the words alone), and the source in small spaced capitals above the title
- **Sharing archive** — [`/sharing/`](https://rommy.blog/sharing/) unfurls every link into a preview card (image, date and source, title, description), fetched via Open Graph at build time and cached in the D1 `build_cache` table; the homepage list stays plain links. A dropdown filters by topic tag from a fixed 15-category taxonomy; new links are tagged automatically by Claude Fable right after being added, and that tag becomes `#hashtags` on the Micro.blog/Bluesky/Mastodon cross-post (`backfill-linklog-tags` or `npm run backfill-linklog-tags` for anything that predates this or failed silently)
- **Security headers** — a `_headers` file at the repo root sets Content-Security-Policy, X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS site-wide via Cloudflare Pages
- **Thinking footers** — Date and neighborhood label on the homepage, archive, and permalinks; neighborhood links to Google Maps when GPS data is available
- **View counts** — every Thinking and Writing permalink shows its views (`1,234 views`): after the neighborhood on a note, after the read time on a post — and the `/thinking/` archive shows each note's count in the same place in its footer. A view is a page load of the permalink itself (opening the archive counts nothing), counted by the Worker in D1 `page_views` and written into the page as it is served; history before that was seeded once from Google Analytics. See Live publishing → View counts
- **Dark basemap contrast** — every map on the site (`/now/`, the Thinking map view, and both admin Location maps) repaints OpenFreeMap's `dark` style on load, because as shipped it is close to unreadable: land `rgb(12,12,12)` against water `rgb(27,27,29)` is a WCAG contrast ratio of **1.14**, so the coastline is invisible, with place labels at 3.36. A CSS `filter` cannot fix the part that matters — `brightness()` multiplies, so it cannot open a gap that is not there (1.14 → 1.32 at 1.6×), and adding `contrast()` makes it *worse* (1.17) by pushing two near-blacks together; OpenFreeMap's `fiord` reaches only 1.25 and turns the map slate blue. So the loaded style's paint properties are patched directly (`scripts/lib/map-dark.mjs`), which is the only way to move land and water independently: **land/water 1.14 → 1.71, label/land 3.36 → 11.03, road/land 1.30 → 2.46**. Land stays within 1.07 of the page background so the map reads as part of the page. Area fills are repainted too — the style paints buildings at `rgb(10,10,10)` and airports at `#000`, which hid against the old land but would punch black holes through the lifted one at city zoom. The patch is scoped to layers from the basemap's own `openmaptiles` source (plus the sourceless `background`); without that guard the `/now/` neighborhood outline, the admin track line and the heatmap dots are all line/fill layers that would be repainted as roads. It re-applies on every `styledata`, since a theme swap replaces the whole style. `admin/index.html` is static and copied verbatim, so it carries a hand-inlined copy of the helper; `map-dark.test.mjs` fails if the two palettes drift apart
- **Location tracking** — Private GPS ingest from [Overland](https://github.com/aaronpk/Overland-iOS) iOS; nearest fix within ±15 minutes at publish time → neighborhood label in D1 (NYC coords use Planning Labs GeoSearch). Admin **Location** tab shows two MapLibre maps (OpenFreeMap basemaps): the latest 1000 points as a path with start/end markers, and below it an all-time heatmap. Raw coordinates are not listed anywhere in the UI
- **All-time location heatmap** — one dot per grid cell, refreshed live on every visit so it fills in as Overland keeps reporting. Clicking a dot names it: a popup shows the cell's neighborhood and borough plus its point count, resolved on demand by the `location-place` action (D1-cached in `geocode_cache`, so a cell costs one reverse-geocode ever) rather than labelling all ~550 cells up front. The log is far too big to ship to the browser (~1,550 points/day, unbounded), so `location-heatmap` collapses it into a lat/lon grid in SQL — rounding to 3 decimals (~110 m) turns 49k points into ~550 cells and a 23 KB payload, and the cell count grows far slower than the point count. Counts are heavily skewed (home holds ~58% of all points and is 24× the next busiest cell), so the colour ramp is logarithmic and normalized against the 95th percentile rather than the maximum — a linear ramp puts 548 of 549 cells in the faintest 5% and paints nothing but home. The ramp is per-theme, not one ramp drawn on both basemaps: on Liberty it runs saturated mid-blue → near-black (a pale low end disappeared into the light basemap), on Dark Matter it inverts to dim blue → near-white (a near-black busiest cell would have been the invisible one)
- **Now page** — [`/now/`](https://rommy.blog/now/) follows [nownownow](https://nownownow.com/about): latest Thinking, current Reading, Working, **Walking** (latest daily step count from Oura Ring, synced to D1, with the distance it works out to in miles and km), and **Current Location** (MapLibre neighborhood map — label + bounding box only, linked to OpenStreetMap; no exact GPS on the public site)
- **Elsewhere → Feeds** — Collapsible row on the homepage with links to Bluesky, Mastodon, and micro.blog
- **Live publishing** — a new, edited, or deleted Thinking note, Writing post, book, Must Read, or Sharing link shows on the site within seconds instead of after the Pages rebuild — see [Live publishing](#live-publishing)
- **Changelog** — Generated from Git history at build time
- **Colophon** — [`/colophon/`](https://rommy.blog/colophon/) describes how the site is built, with an optional toggle to read it in the style of Walt Whitman
- **Site search** — [`/search/`](https://rommy.blog/search/) covers Writing, Thinking, Reading, Must Reads, and Sharing. The build emits one JSON index (~75 KB raw, ~25 KB gzipped) fetched only on `/search/`; matching runs in the browser from `scripts/lib/search.mjs`, shipped verbatim as `search-core.js`. No search service, no runtime dependency (see [Search](#search) below)
- **Footer** — Two lines that never wrap. The first has the copyright with a key icon linking to `/admin/`, the theme toggle centred, and a magnifying glass linking to `/search/` at the right; the second has "Subscribe via" and an atom icon linking to the Atom feed, with Changelog // Colophon at the right. Each icon is drawn as inline SVG in the text color and named by its `aria-label` and tooltip
- **Theme** — Light/dark toggle centred in the footer — an icon, not a word: a sun in dark mode (click for light), a moon in light mode (click for dark), drawn as inline SVG in the text color and named by its `aria-label`/tooltip ("Switch to light mode"). An SVG rather than ☀/☾ characters because ABC Areal has no such glyphs, and a fallback font would draw them differently on every device (iOS as a color emoji). The choice is remembered in `localStorage`; visitors with no stored preference get dark. One typeface site-wide: ABC Areal by [Dinamo](https://abcdinamo.com), self-hosted under a web license for rommy.blog. Dinamo's terms forbid putting the font files in a public repository, so the WOFF2 files are **not in this repo** — they live in R2 under `fonts/abc-areal/v1/` and are served same-origin at `/media/fonts/…` by the media Worker; `styles.css` holds only the `@font-face` rules that point there. Upright text uses the variable cut (weight 400–700); italics use the static Regular, Medium and Bold Italic cuts. A local `npm run preview` has no `/media/` route, so it falls back to the system font unless you copy the files into `dist/media/fonts/abc-areal/v1/` yourself (`dist/` is gitignored)
- **Tests** — `npm test` runs `node --test` over `scripts/lib/*.test.mjs` (no framework, no config): search scoring, job status, build cache, and the render helpers that run over every page (linkify, thinking HTML, media URLs, YouTube/Spotify embeds)

## Architecture

```text
Admin (Pages) → Worker API → D1 (write + content_changes) + R2 (photos)
                    ↓
            Pages deploy hook
                    ↓
Pages build → D1 HTTP API (read) → scripts/build.mjs → dist/ → Pages
                                                                 ↓
                         reader → Worker live overlay (HTML routes) → rommy.blog
```

### Live publishing

The site is still a static build, and a rebuild still takes a minute or two. What a reader sees in the meantime comes from a **live overlay**: the Worker sits in front of the HTML pages that list or are content (`rommy.blog/`, `/thinking*`, `/posts/*`, `/writing*`, `/reading*`, `/sharing*` — see `worker/wrangler.toml`) and serves each from Pages with anything published since its build applied. Modelled on shout.nyc, which renders every page on request; here only the gap between a write and its rebuild is filled.

- **Change log.** Every content write also records `(kind, key, op)` in the D1 `content_changes` table via `recordContentChange()` (`worker/content-changes.mjs`) — `kind` is `thinking`, `post`, `reading`, `favorite` or `linklog`, `op` is `upsert` or `delete`. **A new write site must call it too**; one that doesn't is only slow, not broken: its change waits for the rebuild. Rows older than 7 days are pruned by the cron.
- **Watermark.** The build reads `MAX(content_changes.id)` *before* loading any content and stamps it on every generated page as `<meta name="live-watermark">` and as an `X-Live-Watermark` header (added inside the existing `/*` block of `dist/_headers` — a second `/*` block replaces the first rather than merging with it, and stripped every page of its CSP and other security headers for a few minutes). Reading it first means a change landing mid-build is either in the page or above the watermark, never neither.
- **Fast path.** For each page view the Worker compares the page's watermark with the newest change id, which it holds in the edge cache for 10 s (purged where a write happens). Nothing newer — almost always — and the page streams through untouched, `X-Live-Overlay: none`.
- **Overlay.** Otherwise the Worker collapses the newer changes to the last op per item, loads the rows, renders them with the **build's own renderers** (`scripts/lib/render/`), and rewrites the page with `HTMLRewriter` (`worker/live-overlay.mjs`): a deleted item is removed, an edited one replaced, a new one inserted where the build would put it — every list item carries `data-live-key` and `data-live-sort`, every list `data-live-list` (plus `data-live-order` for the alphabetical Must Reads), and a grid month that doesn't exist yet is created. The homepage's short lists are re-rendered whole. `X-Live-Overlay: applied`.
- **Permalinks.** The build writes `/_live/thinking/` and `/_live/post/`: the two permalink pages with a `__LIVE_…__` marker in each slot that varies. A note or post published or edited since the build is served by filling that template (`scripts/lib/render/pages.mjs`); one deleted since is a 404. Filling the templates reproduces all 308 existing permalinks byte for byte.
- **Finished, not plain.** Right after a Thinking note or Sharing link is written, `worker/live-warm.mjs` fetches what the build would — link cards, Spotify art, a single photo's shape (read from R2), a video's poster and its full-frame still's shape — into the same `build_cache` rows, so the live copy is the finished one and the rebuild finds the work done.
- **Fail-safe.** Any error serves the static page as it is (`X-Live-Overlay: error`). A browser revalidating with `If-None-Match` is refetched in full when there is news, so a `304` can't pin it to the stale page.
- **View counts.** On a permalink, the overlay's last step (`worker/page-views.mjs`, after the edge cache so a cached copy never freezes the number) adds one to the page's row in D1 `page_views` — `INSERT … ON CONFLICT DO UPDATE … RETURNING views`, one round trip — and `HTMLRewriter` appends the total after the neighborhood (`p.post-meta`) or the read time (`.reading-time`). The key is the canonical path (`/thinking/<slug>/`, `/posts/<slug>/`, from `permalinkViewPath` in `scripts/lib/page-views.mjs`). Crawlers, unfurlers, scripted clients and `Sec-Purpose: prefetch`/`prerender` loads read the count without adding to it (`isCountableView`); a page nobody has viewed shows nothing rather than "0 views". Conditional headers are dropped and the response goes out with no `ETag` or `Last-Modified` and `Cache-Control: no-cache`, so a browser never gets a `304` showing an old count. Only the path and the number are stored. A D1 error serves the page without a count. The `/thinking/` archive shows the same counts in each note's footer, but not by rewriting: it is the largest page on the site, already 6–42 ms CPU to rewrite, so instead an inline script (`thinkingArchiveViewsScript` in `build.mjs`) makes one request to the public, read-only `GET /api/views` (its own route in `worker/wrangler.toml`; `handleThinkingViews`), which answers `{ "<slug>": views }` for every note from a single D1 read, `Cache-Control: public, max-age=30`, and inserts each count after the neighborhood or, failing that, the date — before any admin `delete` link. Loading the archive adds nothing to any count. A note with no views shows none; a failed request leaves the footers as they were. History came from a one-off GA4 import: export Reports → Engagement → Pages and screens as CSV, then `npm run seed-page-views -- <file.csv>` (dry run) and `--apply`. The import *adds* to existing rows, so the export's range must end where the Worker's counting began; it leaves a `build_cache` marker (`page-views`/`ga-seed`) and refuses a second `--apply` without `--force`.
- **Still waits for the rebuild:** `feed.xml`, `sitemap.xml`, the search index, `/now/`, Thinking map pins, `/changelog/`, the Sharing tag-filter counts, and the newer/older links on a new post's *neighbours*.
- **Cost (Workers Free plan: 10 ms CPU per request, 100k requests/day).** Every page view on those routes is a Worker request. Nothing pending is the common case and costs a cache lookup. Rewriting a page is the expensive part — measured at 6–42 ms CPU in production, `/thinking/` being the largest page — so it is kept rare: a page is only rewritten when a change of a kind it lists is pending (`kindsForPath`; a permalink only for its own item), and each rewritten page is held in the edge cache keyed by page, build and newest change id, so only the first view per data centre after a change pays (`X-Live-Cache: MISS`, then `HIT`). A request over the CPU limit fails with Cloudflare error 1102 instead of falling back, and once the daily request quota is spent the routes fail closed unless the zone's Workers Routes are set to **fail open**, in which case Pages serves the static pages without the overlay.

The Thinking **archive** and permalink pages are built from the `thinking_posts` table in D1 at deploy time (same source as the homepage blurb). Slugs use US Eastern time. External links in Thinking are rendered as inline `<a>` tags — the visible label drops the scheme and, longer than `URL_DISPLAY_MAX` (40) characters, ends in an ellipsis, while `href` stays the full address and a `title` shows it on hover; Micro.blog, Bluesky, and Mastodon already shorten URLs in their own clients, so the cross-post text is not clipped — and, beneath the note, as unfurl cards — up to three per note, in order of appearance, the same `linklog-card` markup the Sharing archive uses. Previews are fetched via Open Graph (`og:title`, falling back to `twitter:title` and then `<title>`) at build time and cached by URL in the `thinking-unfurls` namespace of the D1 `build_cache` table; since every note is re-rendered from its text on each build, notes posted before the cards existed got them on the first build, and a new note's links are fetched by the Worker right after posting (`worker/live-warm.mjs`), so the card is there in the live copy before the rebuild — which then finds it cached. The fetch identifies as `fingergunsbot` plus `Twitterbot/1.0` (`LINK_UNFURL_USER_AGENT` in `scripts/lib/link-unfurl.mjs`): a self-identified crawler alone is 403'd by DataDome on news sites (NYTimes among them), which is why a note's NYTimes URL used to stay a bare link, and the same UA is used for the Bluesky link card fetched at post time. A page that still blocks the preview fetch or offers nothing to show is cached as a miss with its reason — `{ "miss": "http-403", "at": … }`, or `not-html`, `too-large`, `timeout`, `network`, `no-preview` (from `fetchLinkUnfurlResult`; misses from before reasons were kept are a bare `false`, and `isUnfurlMiss`/`unfurlHit` treat both alike) — so a missing card can be diagnosed by reading its `build_cache` row rather than by fetching the page again. A miss is not retried, so it never costs a timeout on later builds. It still renders a **fallback card** when the URL says what it is (`fallbackUnfurlFromUrl` in `scripts/lib/link-unfurl.mjs`): the publication (a short `SITE_NAMES` table, else the domain) over a title rebuilt from the last path segment — trailing date, id or extension stripped, at least three words and most of them alphabetic, sentence case with a small acronym list (`DOJ`, `FBI`, `NYC`…) — and no image or description; a slug that is an id or hash leaves the link bare. The Sharing archive needs no such fallback, since each link carries its own title, but on a miss it now names the publication from the same table. To retry a miss, delete its `build_cache` row, or bump `UNFURL_FETCHER_ID` to retry every cached miss once after a fetcher-identity change. The cards are kept out of the note's `content_html` deliberately, because the grid tile, search index, `og:image` and `og:description` all read that string, and a linked page's picture or blurb must not become the note's own. Two kinds of link get a player instead of a card: YouTube links (`youtube.com/watch`, `/shorts/`, `/live/`, `youtu.be`) get a responsive `youtube-nocookie.com` iframe embed appended after the note text (see `scripts/lib/youtube.mjs`), and Spotify links (`open.spotify.com/track|album|playlist|episode|show|artist/...`) get a compact `open.spotify.com/embed` iframe the same way (see `scripts/lib/spotify.mjs`) — so both play natively on rommy.blog without leaving the page. A `t=`/`start=` timestamp on a YouTube URL is carried into the embed's start time.

The archive at `/thinking/` renders a List view (chronological feed), a Grid view (posts grouped by month, one square thumbnail each) and a Map view in the same page load; icon buttons swap `data-view` on a wrapper via CSS, and the choice persists in `localStorage`. Type filters (photo, video, audio, YouTube, Spotify, text) show all posts by default; clicking one solo-selects that kind (click again to clear). Filters apply to all three views — the map watches the filter buttons' `aria-pressed` rather than keeping a second copy of that state. Links to the archive from elsewhere always open `/thinking/` unfiltered; choosing a filter updates the URL to a shareable path (`/thinking/images/`, `/thinking/videos/`, `/thinking/audio/`, `/thinking/youtube/`, `/thinking/music/`, `/thinking/text/`). Static pages are generated at each filter path at build time. Grid thumbnails use the post's first photo (Worker-resized via `/media/thumb/512/...`), a stored JPEG poster for native video, YouTube's `hqdefault` preview image, Spotify album art at 640×640 when available, or a text-preview card. `hqdefault` (480×360) is the largest rendition YouTube generates for *every* video; `sddefault` and `maxresdefault` exist only when the source was that big, so requesting them 404s on Shorts and low-resolution uploads. Nothing verifies these URLs at build time, so a 404 is a permanently blank tile — the grid asks for the size that is always there. Every tile — photo and video tiles included, not only the text cards — gets a small badge in its bottom-right corner naming the kind: camera, video camera, microphone, the YouTube and Spotify marks, or `Tt` for plain text. Grid images defer loading until grid view is active and the tile is near the viewport. Switching between List and Grid is a View Transition (`switchView` in `thinkingViewToggleScript`): the first note on screen and up to seven after it (in page order, which both views share) get a `view-transition-name` — their media, or text body, in the list; their tile in the grid — the same notes take those names after the switch, so the browser moves and reshapes each from one place to the other, and the page scrolls so the first stays where it was on screen. Going to the grid, up to 20 other on-screen tiles nearest that note are named too, so they scale in from 92%, staggered outward through a constructed stylesheet; everything else cross-fades with the page. Both counts are capped because every named element is its own snapshot layer: naming every tile on screen (sixty-odd) made the return to the list choppy on phones. While the switch runs, `.is-switching` sets the grid's month sections to `content-visibility: visible`: they are normally `auto`, and Safari decides whether they are on screen a frame after they appear, which is after the transition captures the new view, so tiles it still counted as skipped could not be animated and the switch to the grid came out instant. Names come off when the transition finishes. Movement follows a spring (response 0.5s, damping 0.8, a 1.5% overshoot) rendered as a CSS `linear()` easing by `springEasing` in `scripts/lib/spring.mjs`; the curve is pasted into `styles.css` as `--thinking-spring`, and `spring.test.mjs` fails if it drifts from the module. Map, `prefers-reduced-motion`, and browsers without `document.startViewTransition` switch instantly, and browsers without `linear()` fall back to a cubic-bezier. Map view loads MapLibre's script *and* stylesheet on first open rather than in the page head, so a visitor who never opens it pays nothing; the stylesheet is not optional, because without it `.maplibregl-marker` never gets `position: absolute` and every pin stacks in normal flow below the map. Markers are added as soon as the `Map` exists rather than on its `load` event — they are DOM elements the map merely positions, and `load` (style parsed plus first frame) can be arbitrarily late, or never arrive at all in a throttled background tab. Markers are added quietest-first so the busiest neighborhood stacks on top instead of being buried under a single-post pin sharing its block. The map reads the filter buttons' `aria-pressed` back off the DOM rather than keeping its own copy of the filter state, and redraws on an `aria-pressed` MutationObserver. Post text is embedded into that inline `<script>` through `jsonForScript` (`scripts/lib/script-json.mjs`), never bare `JSON.stringify` — JSON escaping leaves `</script>` intact, and the HTML parser would end the script element there and treat the rest of the note as markup. The search index needs no such care because it is written to `search-index.json` and fetched, so no HTML parser ever sees it. Every note ships in the first page load — there is no batched paging on this archive — so a long scroll gets a floating **Back to top** link (`archiveBackToTopHtml`/`archiveBackToTopScript` in `build.mjs`, shared with the Writing, Reading and Sharing archives): hidden until `scrollY` passes one viewport height, pinned bottom-right inside the safe-area insets, smooth-scrolling unless `prefers-reduced-motion` is set, and handing focus back to the page heading. It hides with `visibility`, not only opacity, so it is out of the tab order while unseen.

Reading at `/reading/latest/` and `/reading/must-reads/` uses path-based tabs (URL updates on switch) and the same list/grid pattern (view choice in `localStorage`). Each tab has visitor-facing intro copy stored in D1, redrafted by Claude Fable when books are added or removed. Entries sort by `ym` descending. Grid covers come from D1 (`cover_url`), with build-time Open Library fallback for entries still missing art; Must Reads titles can use custom cover art in R2.

Sharing renders its `linklog` entries two ways from one dataset: the homepage list is plain date + title (`renderLinklogItem`), while the archive at `/sharing/` unfurls each into a card — image, description, and source — via `renderLinklogArchiveItem`, sourced from the `linklog-unfurls` namespace of the D1 `build_cache` table (see `scripts/lib/link-unfurl.mjs` and `scripts/lib/build-cache.mjs`). The archive's tag-filter dropdown is built from each link's stored `tags`, drawn from the fixed taxonomy in `scripts/lib/linklog-tags.mjs`. New links are tagged by Claude Fable synchronously, right after the D1 insert and before cross-posting (`worker/linklog-tags.mjs`), so the tag can be folded into the Micro.blog/Bluesky/Mastodon post as `#hashtags` — unlike Must Reads genres (`worker/reading-genres.mjs`), which assign in the background since nothing downstream needs them immediately.

Cross-posting is unchanged by the on-site cards: Micro.blog and Mastodon unfurl a note's links in their own clients, and the Bluesky cross-post carries its own link card.

## Repository layout

| Path | Purpose |
|------|---------|
| `admin/` | Admin UI (static HTML + JS) |
| `scripts/build.mjs` | Regenerates site into `dist/` |
| `scripts/lib/` | Shared HTML, slug, thinking, linkify, media-URL/thumb helpers, section hints, reading-tab intros, YouTube/Spotify-embed helpers, Open Graph link-unfurl fetching, the linklog tag taxonomy/prompts, the D1 build-cache and job-run helpers, the site-search index/scoring (`search.mjs`) and its browser entry point (`search-page.mjs`), and a small concurrency helper for build-time network lookups (build + Worker) |
| `scripts/lib/*.test.mjs` | Unit tests, run by `npm test` (`node --test`; no framework, no config) |
| `scripts/d1-client.mjs` | D1 queries for local/Pages builds |
| `build-pages.mjs` | Cloudflare Pages entrypoint (git unshallow + build) |
| `worker/` | Cloudflare Worker (`update-thinking.js`) — admin API |
| `remark42/` | Legacy Remark42 server config, theme CSS, Docker / Fly deploy — unused now that Writing comments run on Webmentions, kept for reference |
| `data/posts.json` | Legacy fallback if D1 env vars are not set |
| `data/reading-covers.json` | Not committed (gitignored). Legacy on-disk cover-URL cache keyed by Bookshop URL — seeds and falls back for the `reading-covers` build-cache namespace in D1 |
| `data/reading-favorites.json` | Must Reads seed data and custom `cover_url` values for build |
| `data/*.json` build caches | Gitignored. Build caches live in the D1 `build_cache` table (`scripts/lib/build-cache.mjs`); any leftover files on disk are only a local fallback |
| `styles.css` | Site styles (light/dark) |
| `about/`, `admin/`, `colophon/`, `contact/` | Hand-authored static pages (copied into `dist/` at build). `/now/` is generated from D1 in `scripts/build.mjs` |
| `_headers` | Cloudflare Pages response headers (CSP and other hardening), copied into `dist/` at build like the static pages above |
| `_redirects` | Cloudflare Pages rewrites, copied into `dist/` the same way — the per-tab admin URLs (`/admin/thinking` and the rest) rewritten to `/admin/` with a 200 |
| `CLAUDE.md` | Architecture notes for Claude Code / AI agents working in this repo |
| `.markdownlint-cli2.jsonc` | Markdown lint config (`npm run lint:md`) |

## Requirements

- [Node.js](https://nodejs.org/) 20.6+ (build scripts only) — `npm run build` and every `backfill-*` / `refresh-*` script run `node --env-file=.env`, and `--env-file` landed in Node 20.6
- [gitleaks](https://github.com/gitleaks/gitleaks) for the secret-scanning pre-commit hook (`brew install gitleaks`)
- Cloudflare account with **D1**, **R2**, **Workers**, and **Pages**
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) for the Worker

## Secret scanning

`.githooks/pre-commit` runs `gitleaks git --staged` and blocks any commit that stages a secret. `core.hooksPath` is local config and does not survive a clone, so **enable it once per checkout**:

```bash
git config core.hooksPath .githooks
```

Without `gitleaks` installed the hook warns and lets the commit through rather than bricking a fresh clone — so install it. To scan the whole history (do this before publishing any new mirror of the repo):

```bash
gitleaks git --log-opts="--all" --redact .
```

`git commit --no-verify` bypasses the hook for a false positive. A secret that has already been pushed must be **revoked**, not merely deleted — removing it from `HEAD` leaves it readable in history, and this repo is public.

## Local build

```bash
npm run build
npm run preview   # serves dist/ at http://localhost:3000
npm run backfill-video-posters   # capture missing JPEG stills (grid poster, full frame) for existing Thinking videos (R2)
npm run refresh-section-hints    # regenerate homepage section tooltips via Claude Fable
npm run refresh-reading-tab-intros   # regenerate Reading tab intro copy via Claude Fable
npm run anthropic-usage              # Anthropic token usage summary (last 30 days)
npm run backfill-thinking-locations  # backfill neighborhood labels on Thinking posts from GPS log
npm run backfill-oura                # sync Oura step history into D1 (~2 years on first run)
npm run backfill-linklog-tags        # assign topic tags to Sharing links missing them via Claude Fable
npm run lint:md                      # lint all Markdown docs (markdownlint-cli2)
npm test                             # node --test over scripts/lib/*.test.mjs
```

Output goes to **`dist/`** (gitignored). Generated HTML is not committed; CI/Pages builds from source + D1.

Reads from D1 when these env vars are set:

| Variable | Description |
|----------|-------------|
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `CF_API_TOKEN` | API token with D1 read access |
| `CF_D1_DATABASE_ID` | D1 database ID |

Without them, the build falls back to `data/posts.json`.

**Comments** on Writing posts use [Webmentions](https://webmention.io) — no server or env vars required. Each post page emits a `<link rel="webmention">` tag and fetches `https://webmention.io/api/mentions.jf2` client-side to render likes/reposts as avatars and replies as comments. [Bridgy](https://brid.gy) forwards Mastodon replies and boosts into webmention.io so they show up too.

To preview the admin UI locally against the Worker:

```bash
cd worker && wrangler dev
# serve admin/ separately, e.g. npx serve . -p 8799
```

Point `admin/index.html`’s `API_URL` at your dev Worker URL if needed.

## Cloudflare Pages

**Hosting:** [rommy.blog](https://rommy.blog) is served by **Cloudflare Pages** only — not GitHub Pages. Custom domain and DNS live in Cloudflare; there is no root `CNAME` file in this repo (that file was a GitHub Pages leftover). If the repo still has `rommy.blog` under GitHub → **Settings** → **Pages**, remove it there to stop domain-verification emails from GitHub.

**Build command:** `node build-pages.mjs`  
**Output directory:** `dist`

Set the same `CF_*` variables in the Pages project (Production environment).

The build expands shallow Git clones when possible so the changelog has enough history.

Deploys run on push to `main`. The Worker triggers a Pages rebuild via deploy hook after each content change. You can also run the **Manual rebuild** GitHub Action (`workflow_dispatch`) if needed.

Response headers (CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) come from the `_headers` file at the repo root, copied into `dist/` at build time. It's one combined policy for the whole site rather than split by path — Cloudflare Pages combines same-named headers from every matching `_headers` rule instead of letting a more specific path win, so a stricter public-page policy and a looser admin-page policy would produce a broken, comma-joined header. If you add a new third-party script/style/embed anywhere on the site (including `/admin/`), it needs allowlisting here or it'll be silently blocked — this bit the Now-page map (MapLibre needs both `worker-src blob:` and its CDN host in `connect-src`, not just `script-src`).

The risk runs the other way too: the policy has to keep naming every origin the *existing* code already talks to, and the admin is the easiest half to forget because nothing on the public site exercises it. Two directives exist only for the admin's Thinking uploads. `connect-src` lists `https://*.r2.cloudflarestorage.com` because a video is `PUT` from the browser straight to a presigned R2 URL — that's an `XMLHttpRequest`, so `connect-src` governs it, not `media-src`. `media-src` lists `blob:` because the chosen file is previewed from an object URL, and the 512×512 grid poster is captured off that preview element; blocking it costs the poster as well as the preview, and `blob:` has to be named by scheme since browsers don't accept it under `'self'`. Both were dropped when the policy was first added and video upload stayed broken until it was noticed by hand.

`scripts/lib/csp.test.mjs` parses the real `_headers` and asserts each of these origins is still permitted, so `npm test` fails on a gap instead of production doing it silently. Add a case there whenever a feature starts talking to a new origin.

The `_redirects` file beside it is copied the same way, and holds the admin's per-tab URLs. Each rule is a 200 rewrite to `/admin/` rather than a redirect, so the URL you asked for is the one that stays in the address bar. Both slash forms of every path are listed because only an exact match is rewritten, and the target is `/admin/` rather than `/admin/index.html` — Pages strips `/index` from a target and then sees the rule as a loop, and silently drops it.

## Cloudflare Worker

See [`worker/README.md`](worker/README.md) for D1 schema, secrets, and deploy steps.

**Admin security:** [`worker/SECURITY.md`](worker/SECURITY.md) — Cloudflare Access on `/admin/`, API rate limiting, optional 30-day remember-me on this device.

**Secrets** (via `wrangler secret put`):

| Secret | Required | Purpose |
|--------|----------|---------|
| `ADMIN_PASSWORD` | Yes | Admin login |
| `PAGES_DEPLOY_HOOK` | Yes | Trigger Pages rebuild after writes |
| `ANTHROPIC_API_KEY` | No | Reading tab intro copy (Claude Fable) |
| `MICROBLOG_TOKEN` | No | Micropub for Thinking |
| `BLUESKY_HANDLE` | No | Bluesky cross-post |
| `BLUESKY_APP_PASSWORD` | No | Bluesky cross-post |
| `MASTODON_ACCESS_TOKEN` | No | Mastodon cross-post |
| `MASTODON_INSTANCE` | No | Mastodon instance URL (default `https://mas.to`) |
| `LOCATION_API_TOKEN` | No | Overland GPS ingest (`POST /api/locations`) |
| `OURA_ACCESS_TOKEN` | No | Oura Ring Personal Access Token (daily step sync) |
| `GITHUB_TOKEN` | No | Fallback rebuild trigger |

**Bindings** (in `worker/wrangler.toml`): D1 `rommy-blog-db`, R2 `rommy-blog-media`, plus `MEDIA_PUBLIC_URL` for public image URLs.

```bash
cd worker
wrangler d1 execute rommy-blog-db --file=schema.sql --remote   # first-time schema
wrangler deploy
```

### Worker actions

| Action | Description |
|--------|-------------|
| `thinking` | Update Thinking text/photo/audio/video in D1; optional Micro.blog + Bluesky + Mastodon |
| `thinking-video-upload-url` | Presigned PUT URL for direct video upload to R2 |
| `list-thinking` | List Thinking archive from D1 (admin) |
| `delete-thinking` | Delete Thinking post from archive (Micro.blog + Bluesky + Mastodon when saved) |
| `upload-media` | Upload image to R2 (`thinking/` or `writing/`) |
| `post` | Publish Writing post |
| `edit-post` | Edit post (version history) |
| `delete-post` | Delete published post |
| `fetch-post` | Load post for editing |
| `list-posts` | List published posts from D1 (admin **Published** sub-tab) |
| `unpublish-post` | Take a post off the site and return it to Drafts (keeps version history) |
| `list-drafts` / `save-draft` / `load-draft` / `delete-draft` | Writing drafts |
| `reading` | Add Reading entry (optional author + cover) |
| `list-reading` | List Reading entries from D1 (admin) |
| `reading-cover-candidates` | Search Open Library, Apple Books, Google Books for cover art |
| `update-reading-cover` | Save chosen cover URL and author on a Reading entry |
| `delete-reading` | Delete Reading entry |
| `reading-favorite` / `list-reading-favorites` / `delete-reading-favorite` / `update-reading-favorite-cover` | Must Reads entries and their cover art |
| `sharing` | Add Sharing (linklog) entry |
| `fetch-title` | Fetch page title for Sharing |
| `refresh-section-hints` | Regenerate homepage section tooltips with Claude Fable |
| `refresh-reading-tab-intros` | Regenerate Reading Latest / Must Reads tab intro copy with Claude Fable |
| `backfill-reading-genres` | Assign genre tags to Must Reads books missing a primary genre (Claude Fable) |
| `backfill-linklog-tags` | Assign topic tags to Sharing links missing them (Claude Fable) |
| `anthropic-usage-summary` | Token usage totals from logged Anthropic API calls |
| `job-status` | Per-job last run, failure counts, and the recent-run log behind the admin Health tab (`job_runs`) |
| `sync-oura` | Sync Oura daily steps into D1 (optional `backfill: true` for ~2 years) |
| `oura-steps-summary` | Latest Oura steps and total days stored |
| `list-locations` | Latest GPS points for admin Location tab (max 1000) |
| `location-heatmap` | All-time GPS points aggregated into a lat/lon grid with a count per cell |
| `location-place` | Reverse-geocoded neighborhood label for one lat/lon (heatmap dot popup; cached in `geocode_cache`) |
| `backfill-thinking-locations` | Backfill `location_label` on Thinking posts from stored GPS |
| `generate-reading-tag-clouds` | Dev helper: thematic tag clouds for Latest and Must Reads (stdout only) |
| `verify` | Check admin password |

## Photos

- Up to **4 photos** per Thinking post (mutually exclusive with audio/video); each is compressed independently
- Up to **5 MB** per photo on rommy.blog and Micro.blog (JPEG, PNG, WebP, GIF)
- Bluesky gets a compressed JPEG per photo when the original is over **2 MB**
- **Thinking gallery:** 1 landscape photo renders at the full content width in its own aspect ratio, uncropped; 1 portrait or square photo renders as a square crop, two-thirds of the content width. Orientation is decided at build time: D1 stores no dimensions, so the build reads each single photo's size from its header (a ranged GET of the first 64 KB, EXIF rotation applied — `scripts/lib/image-size.mjs`) and caches it in the `thinking-photo-sizes` build-cache namespace; the `<img>` carries `width`/`height` so nothing shifts on load, and a photo that can't be measured stays square; 2–4 photos render as an equal-size, cropped 2×2 grid at the blog's content width (no letterboxing). Clicking any photo opens a same-page lightbox — full-viewport width, prev/next buttons, `←`/`→`/`Esc`, and swipe-to-navigate on mobile, wrapping at both ends — used identically on the homepage, `/thinking/` archive, and permalinks. Opening and closing are a shared-element swoop (Web Animations API, in `thinkingLightboxScript`): the photo scales from the tile it was tapped in to its full size, covering the tile and clipping away the rest with an `inset()` clip-path that eases open as it grows — the tile is a centre-cropped rounded square and the lightbox shows the whole photo — while the backdrop and controls fade in; closing runs it in reverse into the tile of the photo now showing. The page is scroll-locked before the tile is measured (hiding the scrollbar can move it), the source tile is hidden for the length of the swoop, and the swoop is skipped — a plain open or close — when that tile is off-screen, the API is missing, or `prefers-reduced-motion` is set. Desktop click-to-zoom eases in and out with a `transform` transition, zooming out toward the point it zoomed into; panning and switching photos turn the transition off so nothing lags. There is no close button: click or tap anywhere outside the photo (or press `Esc`) to close. On phones (including landscape orientation), lightbox photos are held to 88% of the screen width and 80% of its height, with no corner rounding, so there is always backdrop to tap
- **Image references are checked at build time.** `scripts/lib/validate-images.mjs` walks the finished `dist/` and fails the build if any `<img src>` that should be a local file is missing. This exists because the Veri post shipped a broken image for months: its body carried `src="veri-ad.png"`, a bare relative filename with no file behind it, and **Cloudflare Pages answers an unknown path with its HTML fallback and a 200** — so the browser received `text/html` where it expected an image and rendered a broken one. Nothing 404s, nothing logs, nothing alerts. That silence is why this is a build failure rather than a warning. External URLs, `data:`/`blob:`, and `/media/*` are skipped — the first two cannot be checked offline and the third is served by the Worker out of R2, not from `dist/`. A relative `src` is resolved against the *page*, not the site root, which is what made `veri-ad.png` point inside `/posts/for-the-film-buffs-out-there-veri/`
- **Thinking map pins:** The `neighborhood-places` build-cache namespace maps a neighborhood label to a `{lat, lon}` from Nominatim (`scripts/lib/geocode-neighborhood.mjs`). A bare label like `Harris Township` names no state, and Nominatim's first hit for it is in Michigan while the note was written in Pennsylvania — so the build asks for 5 candidates and picks the one nearest a reference point, read out of the Worker's `geocode_cache` backwards (`scripts/lib/label-references.mjs`): that table keys a `"lat,lon"` fix to the label it reverse-geocoded to, which is exactly *which* Harris Township this is. The reference only chooses between candidates and is never published; the pinned coordinate is still Nominatim's neighborhood centre, and no coordinate is sent to Nominatim. A nearest candidate further than `MAX_REFERENCE_DRIFT_KM` (75 km) is rejected rather than pinned, and a *cached* point that far from its reference is discarded and re-resolved, so a bad row heals itself on the next build instead of needing manual deletion. Unlike every other build-time lookup these are issued **in series with a ~1.1s pause**, not through `mapWithConcurrency` — Nominatim's usage policy is one request per second and asks for a real User-Agent. There are only ~23 distinct labels and the results are cached in D1, so a warm build issues none. A label that fails to resolve caches `false` but is retried on the next build (`retryEmpty`), since a failure is usually the service being down rather than a place that will never exist
- **Thinking grid thumbs:** Photo tiles request square JPEGs from `/media/thumb/512/{key}` (Worker-resized, edge-cached). Native video tiles use a paired `-poster.jpg` in R2 (512×512 on upload or via `npm run backfill-video-posters`); a video with no poster yet falls back to a grey placeholder tile with a play triangle. The build's `video-posters` cache is one of two build caches that recheck their misses (the other is `neighborhood-places`, which additionally re-checks its *hits* against a reference point), so a poster added after the fact reaches the grid on the next build (see below). Images in grid view load lazily with a small concurrency cap
- On Writing posts, portrait-oriented photos default to half width; click to expand/collapse

## Reading

- Path-based tabs at `/reading/latest/` and `/reading/must-reads/` (URL updates on switch)
- Sorted by read month (`ym` DESC), not date added
- Each tab opens with intro copy stored in D1; Claude Fable redrafts it when books are added or removed
- List view: month + title linking to Bookshop.org
- Grid view: cover art grouped by month (3 columns desktop, 2 mobile); list/grid choice in `localStorage`
- Admin: optional **author** field improves cover search; **Find cover art** queries Open Library, Apple Books, and Google Books; covers can be changed later from the archive list
- `cover_url` in D1 wins over build-time Open Library lookup; custom covers can be uploaded to R2 under `reading/covers/` (referenced from the `reading-covers` build-cache namespace in D1 and from `data/reading-favorites.json` for build)
- **Must Reads genres:** Each favorite gets 1–3 ranked genre tags in D1 (`reading_genres`, `reading_favorite_genres`), assigned by Claude Fable on add. A genre dropdown on `/reading/must-reads/` filters the list client-side; tags are not shown under individual titles. Run migration + backfill once (see `worker/README.md`)

## Sharing

- Homepage shows the 5 most recent links as plain date + title; the full archive at [`/sharing/`](https://rommy.blog/sharing/) unfurls each into a preview card (image, description, source)
- Previews are fetched via Open Graph at build time and cached in D1 (`build_cache`, namespace `linklog-unfurls`), keyed by URL, so only new links get fetched on later builds; a hotlinked image that fails to load hides itself instead of showing a broken-image icon
- A tag-filter dropdown on the archive lists each topic with its count, sorted descending — tags come from a fixed 15-category taxonomy in `scripts/lib/linklog-tags.mjs`, not an open-ended set
- New links are tagged by Claude Fable synchronously, right after being added and before cross-posting; `backfill-linklog-tags` (or `npm run backfill-linklog-tags`) catches anything that predates this feature or failed silently (e.g. no `ANTHROPIC_API_KEY`)
- That tag becomes `#hashtags` on the Micro.blog, Bluesky, and Mastodon cross-post — each category's label is split on `&`/`,` into one hashtag per term, so `food` (label "Food & Recipes") posts as `#food #recipes`, and `film` ("Film, TV & Comedy") as `#film #tv #comedy` (`hashtagWordsForTags` in `scripts/lib/linklog-tags.mjs`). Bluesky auto-facets `#word` patterns in any post text, Micro.blog and Mastodon hashtag-link plain text natively, so no extra formatting is needed

## Search

- [`/search/`](https://rommy.blog/search/) searches the whole site — Writing, Thinking, Reading, Must Reads, and Sharing — from the footer of every public page. `/admin/` is deliberately excluded from both the index and the link
- The corpus is a few hundred short items (~50 KB of text), so there is no search service: the build writes `dist/search-index.json` (one entry per item — kind, title, body truncated to 600 chars, URL, date) and matching runs in the browser. The index is fetched only on `/search/`; items with neither title nor body text (a bare photo note, say) are skipped
- Matching lives in `scripts/lib/search.mjs`, copied into `dist/` as `search-core.js` and imported by `dist/search.js` (built from `scripts/lib/search-page.mjs`), so what `npm test` covers is what actually runs in the browser
- Scoring: every term must match somewhere, so adding a word narrows rather than widens; title outranks body, word-boundary outranks mid-word, and the whole phrase outranks scattered terms. Ties break toward the more recent item so a growing archive doesn't bury new writing. Queries fold accents ("cortazar" finds "Cortázar"). Results cap at 50
- `?q=` is kept in the URL so a search can be linked or reloaded, `/` focuses the box, and each result carries a highlighted excerpt centred on the first match. Known cosmetic limit: matching folds accents but `<mark>` highlighting does not, so an accented occurrence is found and shown without being highlighted
- Results use their own `.search-results` class rather than `.post-list` — that class carries both a narrow grid column and the batch-reveal script bound in `archiveFoot`, either of which would break the results list

## Audio & Video Syndication

When a Thinking post includes audio or video, each platform receives it as a native, playable attachment rather than a plain link, and the Thinking permalink is appended to the syndicated text alongside it:

| Platform | Audio | Video |
|----------|-------|-------|
| **micro.blog** | `audio[]` Micropub property → native player in feed and podcast RSS | `video[]` Micropub property → native player, unless the file is over **100 MB** — then a permalink only, so Micro.blog does not fetch the whole clip |
| **Mastodon** | Uploaded as a media attachment (≤ 40 MB) → renders a player in timelines and third-party apps. Async video/audio transcodes are polled via `GET /api/v1/media/:id` until ready before the status posts | Same |
| **Bluesky** | No native audio support; falls back to a link card pointing to the post | Native for both **MP4** and iPhone **MOV** (≤ 100 MB) — uploaded to Bluesky's dedicated video-processing service (`video.bsky.app`), which transcodes server-side and is polled for a completed blob (~25s budget). Falls back to a link card if the file is over 100 MB, processing times out or fails, or `createRecord` rejects the embed, so the post still goes out |

Writing, Reading, and Sharing cross-posts to Bluesky always include a link card (title, description, thumbnail). A text-only Thinking note with a URL in it gets that URL's card: Bluesky builds cards only in its own composer, so a post made through the API shows none unless one is attached. A page with no title, description, or image gets no card; a note over 300 characters with no usable link still gets a card pointing at its Thinking permalink. Thumbnails larger than 1 MB are resized/re-encoded before upload; if the embed still fails, the post retries without a thumbnail.

For files that exceed the per-platform size limit, or when bytes are unavailable (presigned video uploads over the threshold), syndication falls back to a permalink with an "Audio: " or "Video: " prefix. Video fallbacks are a **link card whose thumbnail is the captured still**, not a photo attachment with a play icon — tapping an image on Bluesky or Mastodon opens the JPEG, not rommy.blog. The same still is the Thinking permalink's `og:image`, so Mastodon and Micro.blog unfurl it. Multiple photos syndicate to all three platforms (Micro.blog via repeated `photo[]` parts, Mastodon and Bluesky via multiple media attachments/images, up to 4).

rommy.blog itself hosts native video up to **1 GB** in R2, uploaded from the browser via a presigned PUT (the URL lasts an hour). The Worker FormData fallback stays at 100 MB, which is Cloudflare's incoming-request ceiling on Free/Pro and the isolate's memory limit. Permalink pages preload `metadata` only, so opening a 1 GB clip's page does not start downloading the file. Native video uploads capture a JPEG grid poster at save time (`thinking/.../uuid-poster.jpg`): the admin draws a frame off the preview `<video>` onto a canvas and `PUT`s it to its own presigned URL. The capture starts when the file is chosen and the save **awaits** it, because it is slower than it looks — the browser has to decode a frame first, and posting immediately after choosing a file used to beat it and silently upload no poster at all. Starting it on selection rather than from a `loadeddata` listener also matters: iOS Safari will not pull media data for a video nobody has played, so that event can never fire, which is why the misses skewed towards posting from a phone. The same capture also saves the frame uncropped, at the video's own shape (longest side up to 1280px), as `uuid-frame.jpg`, `PUT` to a third presigned URL. That still is the `<video poster>` in the feed, on the homepage and on the permalink: the build reads its width and height from the JPEG header into the `video-frames` cache (rechecking misses, like `video-posters`) and renders `poster`, `width`, `height` and `preload="none"`, with CSS `height: auto` turning the attributes into the box's aspect ratio. Without it, the thumbnail depended on the browser decoding the first frame of each `.mov` itself (`#t=0.001`, still the fallback for a video with no still), and mobile Safari often does not: it ignores `preload` in Low Power and Low Data modes and limits how many videos a page loads, and most iPhone `.mov` files keep their index at the end of the file, so a page of 26 videos left some with no frame, no size and no usable play button. Now nothing is fetched until play is pressed. `npm run backfill-video-posters` fills in either still for older videos, downloading each video at most once. The Worker also serves square grid thumbnails at `/media/thumb/{width}/{key}` for rommy.blog-hosted photos.

## Open Graph previews

`scripts/build.mjs` sets `og:title`, `og:description`, `og:image`, and `twitter:card` on Writing posts and Thinking permalink pages, so links to rommy.blog itself unfurl nicely elsewhere. Writing uses the post summary and the first `<img>` in the body; Thinking permalinks use a snippet from the note HTML and its first image, or a native video's stored still (`-poster.jpg`) when the `video-posters` cache says one exists, or the favicon if there is neither. (This is the reverse direction from the Sharing archive above, which fetches *other* sites' Open Graph data — this section is about rommy.blog's own.)

## Forking / adapting

This repo is tuned for one site (rommy.blog). To run your own copy you will need to replace:

- Domain and `site.url` in D1 / `data/posts.json`
- Cloudflare D1, R2, Worker, and Pages projects
- `worker/wrangler.toml` bindings and `MEDIA_PUBLIC_URL`
- `admin/index.html` → `API_URL` (Worker URL)
- Optional: GA id in `scripts/build.mjs` and static pages
- Micro.blog / Bluesky credentials if you use cross-posting

There is no install wizard; expect to read `worker/schema.sql` and the colophon.

## License

[MIT License](LICENSE). Prose and photos published on [rommy.blog](https://rommy.blog) are not covered by that license unless noted otherwise.
