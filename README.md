# rommy.blog

Personal blog at [rommy.blog](https://rommy.blog). Plain static HTML at deploy time; content and media are managed through a small admin UI backed by Cloudflare.

Built with [Cursor](https://cursor.com). See the [colophon](https://rommy.blog/colophon/) for the full story of how the site works.

## What you get

- **Static site** — HTML, CSS, Atom feed, sitemap; no runtime npm dependencies on Pages
- **Content in D1** — Writing posts, drafts, Reading, Sharing, and the homepage Thinking blurb
- **Media in R2** — Photos (up to 4 per Thinking post), audio, and video for Thinking; photos for Writing (public bucket)
- **Photo gallery** — 2–4 Thinking photos render as a cropped, equal-size 2×2 grid; click opens a full-viewport lightbox with prev/next, keyboard arrows, and infinite swipe on mobile
- **Admin** — Password-protected UI at `/admin/` (Thinking, Writing, Reading, Sharing, Location, Health, Login)
- **Health tab** — Cron syncs, rebuilds, and syndication attempts record their outcome to D1 (`job_runs`); the **Health** tab in `/admin/` lists every job's last run plus a recent-run log, and its tab dot is green when all jobs are healthy and red when one has failed or a scheduled one has gone stale — visible from whichever tab you're on, so a silent background failure stops being silent
- **Cross-posting** — Thinking can publish to [Micro.blog](https://micro.blog) (Micropub), [Bluesky](https://bsky.app), and [Mastodon](https://joinmastodon.org) when configured; photos, audio, and video render as native attachments/players in each feed (see [Audio & Video Syndication](#audio--video-syndication) below), with the Thinking permalink included in the syndicated text alongside native media. Writing, Reading, and Sharing cross-posts to Bluesky include link cards; large og:image thumbnails are compressed to ≤ 1 MB before upload
- **Comments** — [Webmentions](https://webmention.io) on Writing posts: incoming likes, reposts, and replies are received by webmention.io and rendered client-side; [Bridgy](https://brid.gy) bridges Mastodon replies/boosts back in
- **Writing editor** — [Quill](https://quilljs.com/) with image upload, text wrap (left / right / center / full), drafts, and post version history
- **Managing published posts** — the Writing tab's **Published** sub-tab lists every published post (newest first) with a link to the live page plus Edit, Unpublish, and Delete. Post pages carry matching `edit`, `unpublish`, and `delete` links beside the reading time, injected client-side only when a signed-in admin session is present in that browser. Edit lands on `/admin/?post=<slug>`; Unpublish and Delete open the post at `?unpublish` / `?delete` and confirm on the page rather than in a pop-up (the same flow the Thinking archive uses, so it works on a phone)
  - **Unpublish** takes the post off the site and writes its text back to Drafts, *keeping* `post_versions` — republishing derives the same slug from the same title, so the history continues. Republishing does send a fresh cross-post
  - **Delete** drops the post *and* its version history
  - Neither retracts cross-posts already sent to Micro.blog, Bluesky, or Mastodon — Writing posts don't store their syndication URLs. The Worker still checks the password on `fetch-post` / `edit-post` / `unpublish-post` / `delete-post`
- **Social previews** — Open Graph / Twitter meta on Writing and Thinking permalinks (first in-post image when available)
- **Plain links in Thinking** — URLs in notes are normal hyperlinks on the site (no on-site unfurl cards), except YouTube links (native video embed) and Spotify links (native track/album/playlist/episode/show/artist embed), which render below the note
- **Thinking archive views** — [`/thinking/`](https://rommy.blog/thinking/) offers List and Grid views (icon buttons under the heading; choice remembered in `localStorage`). Grid groups notes by month with one square thumbnail per post — photos via edge-resized 512px thumbs, native video via stored JPEG posters, YouTube via preview images, Spotify via album art, or a text-preview card. Every tile carries a small corner badge for its kind, photo tiles included. Six type-filter buttons (photo, video, audio, YouTube, Spotify, text) solo-select one kind at a time; all posts show until a filter is chosen; filters apply to list and grid. Links to the archive always land on `/thinking/` unfiltered; choosing a filter updates the URL to a shareable path (`/thinking/images/`, `/thinking/videos/`, `/thinking/audio/`, `/thinking/youtube/`, `/thinking/music/`, `/thinking/text/`). Grid images load lazily when grid view is active
- **Reading archive views** — [`/reading/latest/`](https://rommy.blog/reading/latest/) and [`/reading/must-reads/`](https://rommy.blog/reading/must-reads/) are path-based tabs (URL updates on switch). Sorted by read month (`ym`), not date added. List/grid toggle (remembered in `localStorage`); grid is a storefront-style cover catalog grouped by month (3 columns desktop, 2 mobile). Each tab opens with a taste summary redrafted by Claude Fable when books change. Optional author field and multi-source cover picker (Open Library, Apple Books, Google Books) in admin; custom covers can live in R2 under `reading/covers/`
- **Section tooltips** — Homepage section headings have hover blurbs stored in D1; Claude Fable regenerates them after content changes (`refresh-section-hints` admin action or `npm run refresh-section-hints`)
- **Reading tab intros** — Latest and Must Reads tabs have visitor-facing taste summaries stored in D1; Claude Fable redrafts them when books are added or removed (`refresh-reading-tab-intros` or `npm run refresh-reading-tab-intros` from repo root or `worker/`)
- **Must Reads genre tags** — Each curated favorite gets 1–3 AI-assigned genre tags (primary required) stored in D1; a genre dropdown on `/reading/must-reads/` filters the list, with shareable paths like `/reading/must-reads/literary-realism/`. Tags are assigned automatically when books are added and pruned when unused after removal (`backfill-reading-genres` or `npm run backfill-reading-genres` for existing titles)
- **Sharing archive** — [`/sharing/`](https://rommy.blog/sharing/) unfurls every link into a preview card (image, description, source), fetched via Open Graph at build time and cached in the D1 `build_cache` table; the homepage list stays plain links. A dropdown filters by topic tag from a fixed 15-category taxonomy; new links are tagged automatically by Claude Fable right after being added, and that tag becomes `#hashtags` on the Micro.blog/Bluesky/Mastodon cross-post (`backfill-linklog-tags` or `npm run backfill-linklog-tags` for anything that predates this or failed silently)
- **Security headers** — a `_headers` file at the repo root sets Content-Security-Policy, X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS site-wide via Cloudflare Pages
- **Thinking footers** — Date and neighborhood label on the homepage, archive, and permalinks; neighborhood links to Google Maps when GPS data is available
- **Location tracking** — Private GPS ingest from [Overland](https://github.com/aaronpk/Overland-iOS) iOS; nearest fix within ±15 minutes at publish time → neighborhood label in D1 (NYC coords use Planning Labs GeoSearch). Admin **Location** tab shows two MapLibre maps (OpenFreeMap basemaps): the latest 1000 points as a path with start/end markers, and below it an all-time heatmap. Raw coordinates are not listed anywhere in the UI
- **All-time location heatmap** — one dot per grid cell, darker where more points were logged, refreshed live on every visit so it fills in as Overland keeps reporting. The log is far too big to ship to the browser (~1,550 points/day, unbounded), so `location-heatmap` collapses it into a lat/lon grid in SQL — rounding to 3 decimals (~110 m) turns 49k points into ~550 cells and a 23 KB payload, and the cell count grows far slower than the point count. Counts are heavily skewed (home holds ~58% of all points and is 24× the next busiest cell), so the colour ramp is logarithmic and normalized against the 95th percentile rather than the maximum — a linear ramp puts 548 of 549 cells in the lightest 5% and paints nothing but home
- **Now page** — [`/now/`](https://rommy.blog/now/) follows [nownownow](https://nownownow.com/about): latest Thinking, current Reading, Working, **Walking** (latest daily step count from Oura Ring, synced to D1, with the distance it works out to in miles and km), and **Current Location** (MapLibre neighborhood map — label + bounding box only, linked to OpenStreetMap; no exact GPS on the public site)
- **Elsewhere → Feeds** — Collapsible row on the homepage with links to Bluesky, Mastodon, and micro.blog
- **Changelog** — Generated from Git history at build time
- **Colophon** — [`/colophon/`](https://rommy.blog/colophon/) describes how the site is built, with an optional toggle to read it in the style of Walt Whitman
- **Site search** — [`/search/`](https://rommy.blog/search/) covers Writing, Thinking, Reading, Must Reads, and Sharing. The build emits one JSON index (~75 KB raw, ~25 KB gzipped) fetched only on `/search/`; matching runs in the browser from `scripts/lib/search.mjs`, shipped verbatim as `search-core.js`. No search service, no runtime dependency (see [Search](#search) below)
- **Theme** — Light/dark toggle in the footer next to the Search link, remembered in `localStorage`; visitors with no stored preference get dark. One typeface site-wide (Hanken Grotesk, via Google Fonts)
- **Tests** — `npm test` runs `node --test` over `scripts/lib/*.test.mjs` (no framework, no config): search scoring, job status, build cache, and the render helpers that run over every page (linkify, thinking HTML, media URLs, YouTube/Spotify embeds)

## Architecture

```text
Admin (Pages) → Worker API → D1 (write) + R2 (photos)
                    ↓
            Pages deploy hook
                    ↓
Pages build → D1 HTTP API (read) → scripts/build.mjs → dist/ → rommy.blog
```

The Thinking **archive** and permalink pages are built from the `thinking_posts` table in D1 at deploy time (same source as the homepage blurb). Slugs use US Eastern time. External links in Thinking are rendered as basic `<a>` tags — no on-site unfurl cards — with two exceptions: YouTube links (`youtube.com/watch`, `/shorts/`, `/live/`, `youtu.be`) get a responsive `youtube-nocookie.com` iframe embed appended after the note text (see `scripts/lib/youtube.mjs`), and Spotify links (`open.spotify.com/track|album|playlist|episode|show|artist/...`) get a compact `open.spotify.com/embed` iframe the same way (see `scripts/lib/spotify.mjs`) — so both play natively on rommy.blog without leaving the page. A `t=`/`start=` timestamp on a YouTube URL is carried into the embed's start time.

The archive at `/thinking/` renders both a List view (chronological feed) and a Grid view (posts grouped by month, one square thumbnail each) in the same page load; icon buttons swap `data-view` on a wrapper via CSS, and the choice persists in `localStorage`. Type filters (photo, video, audio, YouTube, Spotify, text) show all posts by default; clicking one solo-selects that kind (click again to clear). Filters apply to both views. Links to the archive from elsewhere always open `/thinking/` unfiltered; choosing a filter updates the URL to a shareable path (`/thinking/images/`, `/thinking/videos/`, `/thinking/audio/`, `/thinking/youtube/`, `/thinking/music/`, `/thinking/text/`). Static pages are generated at each filter path at build time. Grid thumbnails use the post's first photo (Worker-resized via `/media/thumb/512/...`), a stored JPEG poster for native video, YouTube's `sddefault` preview image, Spotify album art at 640×640 when available, or a text-preview card. Every tile — photo and video tiles included, not only the text cards — gets a small badge in its bottom-right corner naming the kind: camera, video camera, microphone, the YouTube and Spotify marks, or `Tt` for plain text. Grid images defer loading until grid view is active and the tile is near the viewport.

Reading at `/reading/latest/` and `/reading/must-reads/` uses path-based tabs (URL updates on switch) and the same list/grid pattern (view choice in `localStorage`). Each tab has visitor-facing intro copy stored in D1, redrafted by Claude Fable when books are added or removed. Entries sort by `ym` descending. Grid covers come from D1 (`cover_url`), with build-time Open Library fallback for entries still missing art; Must Reads titles can use custom cover art in R2.

Sharing renders its `linklog` entries two ways from one dataset: the homepage list is plain date + title (`renderLinklogItem`), while the archive at `/sharing/` unfurls each into a card — image, description, and source — via `renderLinklogArchiveItem`, sourced from the `linklog-unfurls` namespace of the D1 `build_cache` table (see `scripts/lib/link-unfurl.mjs` and `scripts/lib/build-cache.mjs`). The archive's tag-filter dropdown is built from each link's stored `tags`, drawn from the fixed taxonomy in `scripts/lib/linklog-tags.mjs`. New links are tagged by Claude Fable synchronously, right after the D1 insert and before cross-posting (`worker/linklog-tags.mjs`), so the tag can be folded into the Micro.blog/Bluesky/Mastodon post as `#hashtags` — unlike Must Reads genres (`worker/reading-genres.mjs`), which assign in the background since nothing downstream needs them immediately.

Cross-posting still lets Bluesky and Micro.blog unfurl URLs in your notes on their own platforms when you include links there.

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
| `CLAUDE.md` | Architecture notes for Claude Code / AI agents working in this repo |
| `.markdownlint-cli2.jsonc` | Markdown lint config (`npm run lint:md`) |

## Requirements

- [Node.js](https://nodejs.org/) 18+ (build scripts only)
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
npm run backfill-video-posters   # capture JPEG posters for existing Thinking videos (R2)
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
| `backfill-thinking-locations` | Backfill `location_label` on Thinking posts from stored GPS |
| `generate-reading-tag-clouds` | Dev helper: thematic tag clouds for Latest and Must Reads (stdout only) |
| `verify` | Check admin password |

## Photos

- Up to **4 photos** per Thinking post (mutually exclusive with audio/video); each is compressed independently
- Up to **5 MB** per photo on rommy.blog and Micro.blog (JPEG, PNG, WebP, GIF)
- Bluesky gets a compressed JPEG per photo when the original is over **2 MB**
- **Thinking gallery:** 1 photo renders full width; 2–4 photos render as an equal-size, cropped 2×2 grid at the blog's content width (no letterboxing). Clicking any photo opens a same-page lightbox — full-viewport width, prev/next buttons, `←`/`→`/`Esc`, and swipe-to-navigate on mobile, wrapping at both ends — used identically on the homepage, `/thinking/` archive, and permalinks. On phones (including landscape orientation), lightbox photos render edge-to-edge with no corner rounding
- **Thinking grid thumbs:** Photo tiles request square JPEGs from `/media/thumb/512/{key}` (Worker-resized, edge-cached). Native video tiles use a paired `-poster.jpg` in R2 (512×512 on upload or via `npm run backfill-video-posters`). Images in grid view load lazily with a small concurrency cap
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
| **micro.blog** | `audio[]` Micropub property → native player in feed and podcast RSS | `video[]` Micropub property → native player |
| **Mastodon** | Uploaded as a media attachment (≤ 40 MB) → renders a player in timelines and third-party apps. Async video/audio transcodes are polled via `GET /api/v1/media/:id` until ready before the status posts | Same |
| **Bluesky** | No native audio support; falls back to a link card pointing to the post | Native for both **MP4** and iPhone **MOV** (≤ 100 MB) — uploaded to Bluesky's dedicated video-processing service (`video.bsky.app`), which transcodes server-side and is polled for a completed blob (~25s budget). Falls back to a link card if processing times out or fails, or if `createRecord` rejects the embed, so the post still goes out |

Writing, Reading, and Sharing cross-posts to Bluesky always include a link card (title, description, thumbnail). Thumbnails larger than 1 MB are resized/re-encoded before upload; if the embed still fails, the post retries without a thumbnail.

For files that exceed the per-platform size limit, or when bytes are unavailable (presigned video uploads over the threshold), syndication falls back to the previous behaviour: a plain-text post with a permalink and an "Audio: " or "Video: " prefix. Multiple photos syndicate to all three platforms (Micro.blog via repeated `photo[]` parts, Mastodon and Bluesky via multiple media attachments/images, up to 4).

Native video uploads capture a JPEG grid poster at save time (`thinking/.../uuid-poster.jpg`). The Worker also serves square grid thumbnails at `/media/thumb/{width}/{key}` for rommy.blog-hosted photos.

## Open Graph previews

`scripts/build.mjs` sets `og:title`, `og:description`, `og:image`, and `twitter:card` on Writing posts and Thinking permalink pages, so links to rommy.blog itself unfurl nicely elsewhere. Writing uses the post summary and the first `<img>` in the body; Thinking permalinks use a snippet from the note HTML and its first image, or the favicon if there is none. (This is the reverse direction from the Sharing archive above, which fetches *other* sites' Open Graph data — this section is about rommy.blog's own.)

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
