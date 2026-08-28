# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Personal blog (rommy.blog) built as a static site generated at deploy time from content stored in Cloudflare D1. There is no client framework and no npm runtime dependency on Pages — `scripts/build.mjs` is a single Node script that reads content and writes plain HTML to `dist/`. Content is authored through a password-protected admin UI (`admin/`) backed by a single Cloudflare Worker (`worker/update-thinking.js`) that writes to D1 and R2, then triggers a Pages rebuild.

Full feature list and Worker action reference: `README.md`. D1 schema, migrations, and secrets: `worker/README.md`. Admin auth model: `worker/SECURITY.md`.

## Documentation is part of the change, not a follow-up

**Every commit that changes what the site or the admin does also updates the docs that describe it, in the same commit.** Three places, and they drift independently:

- `README.md` — the feature list and the architecture notes.
- `colophon/index.html`, **plain prose** — what a reader is told the site does.
- `colophon/index.html`, **Whitman version** — the same facts retold in voice, in the numbered sections. Both versions live in one file, so a diff that touches the file proves nothing; check that you edited both.

Read the existing text for what the change makes *wrong*, not only for something to add — a renamed tab, a changed default, a number that moved. Past drift has all been of that kind: the colophon said Inter for four days after the font became Hanken Grotesk, and quoted a thumbnail size that had doubled.

`.claude/hooks/docs-guard.sh` (wired up in `.claude/settings.json`) refuses a `git commit` that stages `scripts/`, `worker/`, `admin/`, `styles.css`, `_headers`, `build-pages.mjs`, `about/`, or `contact/` without both `README.md` and `colophon/index.html`. It is a backstop for forgetting, not the trigger — write the docs as part of the work. For a change that genuinely needs none (a refactor, a chore, a fix with no visible effect), put `skip-docs` in the commit command; tests-only and docs-only commits pass without it.

## Secrets

`.githooks/pre-commit` (enabled with `git config core.hooksPath .githooks`) runs `gitleaks git --staged` and blocks a commit that stages a secret. It exists because a live Giphy API key reached this repo in July 2026 and sat in public history for five weeks — found only by scanning before adding a second public mirror.

**The repo is public.** Anything committed is exposed the moment it is pushed, with no window to catch it. If a secret does get through, deleting it from `HEAD` is not a fix: revoke it at the provider, then verify the old value is dead before assuming the incident is closed.

## Skills to reach for in this repo

These aren't project-configured (Claude Code has no per-project skill enablement — they're globally available); load them proactively when the work matches:

- `wrangler` — before any `wrangler` command (D1, deploy, secrets, R2 CORS).
- `cloudflare` — anything touching `worker/wrangler.toml` bindings, the root `_headers`/`_redirects`, or D1/R2 config.
- `workers-best-practices` — adding to or reviewing `worker/update-thinking.js` (floating promises, global state, secret handling, bindings).
- `security-review` — after any change to `worker/update-thinking.js`, `_headers`, or anything that fetches/renders external input (webmentions, Sharing unfurls, `fetch-title`).
- `claude-in-chrome` — verify anything that renders client-side (the `/now/` and admin Location maps, Thinking lightbox, Sharing cards) instead of assuming from source — the CSP/MapLibre outage was only diagnosable this way.
- `code-review` — after multi-file feature work, before calling it done.
- `fewer-permission-prompts` — occasionally, to allowlist the routine read-only `wrangler`/`git`/`curl` commands that recur every session.
- `claude-api` — when touching the Claude Fable integration (`worker/anthropic.mjs`, section hints, Reading tab intros, Must Reads genres).
- `web-perf` — for an occasional Core Web Vitals / caching audit.

## Commands

```bash
npm run build                        # scripts/build.mjs -> dist/ (reads D1 if CF_* env vars set, else data/posts.json)
npm run preview                      # serve dist/ at http://localhost:3000 (npx serve)

npm run backfill-video-posters       # capture JPEG grid posters for existing Thinking videos (writes to R2)
npm run refresh-section-hints        # regenerate homepage section tooltips via Claude Fable (Anthropic API)
npm run refresh-reading-tab-intros   # regenerate Reading tab intro copy via Claude Fable
npm run backfill-reading-genres      # assign Must Reads genre tags via Claude Fable
npm run backfill-linklog-tags        # assign Sharing (linklog) topic tags via Claude Fable
npm run backfill-thinking-locations  # backfill neighborhood labels on Thinking posts from GPS log
npm run backfill-oura                # sync Oura step history into D1
npm run anthropic-usage              # Anthropic token usage summary (last 30 days)
npm run migrate-build-cache          # seed D1 build_cache from the legacy data/*.json files (one-off)

npm test                             # node --test over scripts/lib/*.test.mjs
npm run lint:md                      # markdownlint-cli2
```

`npm test` runs `node --test` over `scripts/lib/*.test.mjs` (no test framework, no config). Markdown is linted by `npm run lint:md` (`markdownlint-cli2`); there is no JS linter.

`.env` at repo root holds `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_D1_DATABASE_ID` (D1 read access for the build) and `ADMIN_PASSWORD`. Build scripts are invoked as `node --env-file=.env scripts/build.mjs`.

### Worker (admin API)

```bash
cd worker
wrangler dev                          # local Worker dev server
wrangler deploy                       # deploy the Worker
wrangler d1 execute rommy-blog-db --file=schema.sql --remote   # first-time schema; migrate-*.sql files are one-off, already-applied migrations
wrangler secret put ADMIN_PASSWORD    # etc. — see worker/README.md for the full secret list
```

To run the admin UI locally against a dev Worker: `wrangler dev` in `worker/`, serve `admin/` separately (`npx serve . -p 8799`), and point `admin/index.html`'s `API_URL` at the dev Worker URL.

### Deploy

Cloudflare Pages only (not GitHub Pages — there's no root `CNAME`). Build command `node build-pages.mjs`, output `dist`. Deploys run on push to `main`; the Worker also triggers a Pages rebuild via deploy hook after every content write, so admin edits go live without a git push.

## Architecture

```text
Admin UI (Pages, static) → Worker API (worker/update-thinking.js) → D1 (write) + R2 (photos/audio/video)
                                          ↓
                                  Pages deploy hook
                                          ↓
Pages build (build-pages.mjs) → D1 HTTP API (read, scripts/d1-client.mjs) → scripts/build.mjs → dist/ → rommy.blog
```

**Everything writes through one Worker file.** `worker/update-thinking.js` (~3000 lines) is a single-endpoint action dispatcher: every mutating request is `POST` with `{password, action, ...}` in the body, checked against `verifyAdminPassword` + a D1-backed rate limiter (`auth_rate_limit` table, 5 failures/15min) before dispatching on `action` to a `handle*` function. Two routes bypass this and use their own auth instead: `POST /api/locations` (Overland GPS ingest, Bearer token in `LOCATION_API_TOKEN`) and `GET /api/now-location` (public, no auth — powers the public `/now/` map). `worker/*.mjs` files hold split-out concerns (`location.mjs`, `media.mjs`, `image-thumb.mjs`, `r2-presign.mjs`, `oura.mjs`, `reading-genres.mjs`, etc.) imported by the main file.

**The build has two data sources.** `scripts/build.mjs` calls `loadBlogDataFromD1()` when `CF_ACCOUNT_ID`/`CF_API_TOKEN`/`CF_D1_DATABASE_ID` are set, otherwise falls back to `data/posts.json` + `data/reading-favorites.json`. Hand-authored static pages (`about/`, `admin/`, `colophon/`, `contact/`, plus `styles.css`, `favicon.png`, `_headers`) are listed in `STATIC_ENTRIES` in `build.mjs` and copied into `dist/` verbatim — add new hand-authored top-level pages there. Everything else in `dist/` is templated by `build.mjs`. `dist/` is gitignored; nothing generated is committed.

**Build-time external-data caching is a repeated pattern, not a one-off.** Several build steps look up data from external services once and cache the result keyed by URL/id, so subsequent builds only fetch what's new: Spotify thumbnails, video-poster existence checks, Reading cover art, and Sharing-link Open Graph unfurls. These live in the D1 `build_cache` table, one namespace per cache, accessed through `loadBuildCache`/`saveBuildCache` in `scripts/lib/build-cache.mjs` — **not** in committed `data/*.json` files. They used to be, and it did not work: Pages builds in an ephemeral checkout, so every cache write was discarded and only a local build followed by a commit ever warmed anything. `saveBuildCache` diffs against what was loaded and writes only changes, so it is safe to call unconditionally. Values are JSON-encoded because `false` is a meaningful cached result ("checked, nothing there") and the build relies on `key in cache` to avoid retrying known-empty lookups. Note D1 allows only 100 bound parameters per query — multi-row writes must be chunked (see `ROWS_PER_STATEMENT`). All of these lookups run through `scripts/lib/concurrency.mjs`'s `mapWithConcurrency` (concurrency cap of 6) rather than fetching sequentially — follow both patterns for any new build-time external lookup.

**Content model in D1:** Writing (`posts` + `post_versions` + `drafts`), Reading (`reading`, `reading_favorites`/"Must Reads", `reading_genres`), Sharing (`linklog`, a tagged linklog — see below), Thinking (`thinking_posts`, the microblog — photos/audio/video/text, syndicated to Micro.blog/Bluesky/Mastodon), plus `location_points` (private GPS) and `oura_daily_activity`. Reading and Sharing archives use path-based tabs/filters where the URL updates on switch (`/reading/latest/` vs `/reading/must-reads/`, `/thinking/images/` etc.) with static pages generated per filter path at build time — see `sortDesc`/`toETDate`/the various `render*Item` functions in `build.mjs` for the pattern before adding a new filtered archive.

**AI tagging happens at write time in the Worker, not at build time.** Must Reads genres and Sharing topic tags both call `evaluateAndAssign*` (`worker/reading-genres.mjs` / `worker/linklog-tags.mjs`) right after the D1 insert, but on different schedules: Reading genres run in the background (`scheduleReadingGenreAssignment` → `ctx.waitUntil()`, triggers a second Pages rebuild once saved, doesn't block the admin's request) since nothing downstream needs the genre immediately. Sharing tags run **synchronously, before syndication** (`refreshLinklogTags(env, db, linklogId, null)`, awaited directly in `handleSharing`) because the assigned tag becomes `#hashtags` in the Micro.blog/Bluesky/Mastodon post text — a background assignment would finish after the posts already went out. The stored tag *slug* (e.g. `food`) is one category, but the hashtags are one per term in that category's *label* — `hashtagWordsForTags` in `scripts/lib/linklog-tags.mjs` splits each assigned slug's label on `&`/`,`, so `food` ("Food & Recipes") yields `#food #recipes` and `film` ("Film, TV & Comedy") yields `#film #tv #comedy`. Bluesky auto-facets `#word` patterns in any text passed to `postToBluesky` (`addHashtagFacets`); Micro.blog and Mastodon hashtag-link plain text natively, so no per-platform formatting is needed beyond building that string. Each tagging feature has a matching `backfill-*` Worker action (and `npm run backfill-*` wrapper) for entries that predate it or whose tagging failed silently (no `ANTHROPIC_API_KEY`, a bad model response, etc.) — those are retried by rerunning the backfill, not automatically. If you add a new AI-tagged field, decide which timing it needs before copying either pattern.

**Sharing (linklog) has two renderings from one dataset.** The homepage section (`renderLinklogItem`) is always plain date+link. The `/sharing/` archive (`renderLinklogArchiveItem`) renders unfurl cards (image/description/source) sourced from the `linklog-unfurls` build cache, with a tag-filter dropdown built from `linklog.tags`. Don't conflate the two renderers when touching either.

**CSP (`_headers`) is one policy for the whole site, not split by path.** Cloudflare Pages *combines* same-named headers from every matching `_headers` path rule instead of letting the more specific one win — a separate stricter policy for public pages and a looser one for `/admin/*` would produce a broken, comma-joined `Content-Security-Policy` header. The single policy in `_headers` has to cover both the public site's needs and the admin UI's (Quill from `cdn.quilljs.com`, MapLibre GL from `cdn.jsdelivr.net`). MapLibre in particular needs `worker-src blob:` (it builds its tile-processing worker from a blob URL) *and* the CDN host in `connect-src` (it `fetch()`s its own bundle as text before blob-wrapping it — that fetch is governed by `connect-src`, not `script-src`) — both are easy to miss and will silently blank the map on `/now/` and the admin Location tab if dropped.

**Media is served through the Worker, not R2 directly**, at `rommy.blog/media/*` (`worker/media.mjs`) — same-origin so iOS Safari gets byte-range audio/video streaming. `worker/image-thumb.mjs` generates and caches resized square JPEGs on demand at `/media/thumb/{width}/{key}` for R2-native photos under `thinking/` or `reading/` (width restricted to `{64,128,252,512}`). Third-party thumbnails (Spotify, YouTube, Sharing-archive unfurls) are hotlinked directly to their source CDN, not proxied through this pipeline — that's a deliberate scope boundary, not an oversight.
