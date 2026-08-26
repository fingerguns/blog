# Cloudflare Worker: admin API for rommy.blog

Content is stored in **Cloudflare D1**. Section hover tooltips (`section_hints`) and Reading tab intro copy (`reading_tab_intros`) are regenerated via **Claude Fable** (Anthropic API) after content changes. Both trigger a second site rebuild with the updated copy.

The static site is rebuilt via a **Pages deploy hook**.

**Security:** See [SECURITY.md](./SECURITY.md) for Cloudflare Access on `/admin/`, rate limiting, and session hardening.

## Setup

### D1 database

Already created: `rommy-blog-db` (`2cb5dcd1-ff1b-4152-b081-58f56c9e5a55`)

Apply schema (if needed):

```bash
cd worker
wrangler d1 execute rommy-blog-db --file=schema.sql --remote
```

If upgrading from an older install with `thinking` / `thinking_syndication` tables:

```bash
wrangler d1 execute rommy-blog-db --file=migrate-thinking-consolidate.sql --remote
```

Seed section hover tooltips (optional — build falls back to defaults until Worker regenerates):

```bash
wrangler d1 execute rommy-blog-db --file=migrate-section-hints.sql --remote
```

Seed Reading tab intro copy (optional — build falls back to defaults until Worker regenerates):

```bash
wrangler d1 execute rommy-blog-db --file=migrate-reading-tab-intros.sql --remote
```

Add Thinking audio posts (`media_type` column — image or audio):

```bash
wrangler d1 execute rommy-blog-db --file=migrate-thinking-audio.sql --remote
```

Add Thinking multi-photo support (`media_urls` JSON column, up to 4 photos):

```bash
wrangler d1 execute rommy-blog-db --file=migrate-thinking-photos.sql --remote
```

Location tracking (Overland ingest + Thinking post neighborhood labels):

```bash
wrangler d1 execute rommy-blog-db --file=migrate-location.sql --remote
```

Add Sharing (linklog) topic tags (`tags` column, backing the archive's tag-filter dropdown):

```bash
wrangler d1 execute rommy-blog-db --file=migrate-linklog-tags.sql --remote
```

Migrate existing content from `data/posts.json`:

```bash
node scripts/migrate-to-d1.mjs
```

### Worker secrets

```bash
cd worker
wrangler secret put ADMIN_PASSWORD
wrangler secret put LOCATION_API_TOKEN   # Overland iOS — Bearer token for POST /api/locations
wrangler secret put ANTHROPIC_API_KEY   # Reading tab intro copy (Claude Fable)
wrangler secret put PAGES_DEPLOY_HOOK   # Cloudflare Pages → Settings → Deploy hooks
wrangler secret put MICROBLOG_TOKEN     # optional
wrangler secret put BLUESKY_HANDLE        # optional
wrangler secret put BLUESKY_APP_PASSWORD  # optional
wrangler secret put MASTODON_ACCESS_TOKEN # optional
wrangler secret put MASTODON_INSTANCE     # optional, defaults to https://mas.to
wrangler secret put GITHUB_TOKEN          # optional fallback for rebuild trigger
```

Direct video upload (faster — browser PUTs to R2, optional; multipart fallback if unset):

```bash
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID      # R2 → Manage R2 API tokens → Object Read & Write
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler r2 bucket cors set rommy-blog-media --file=r2-cors.json
```

Deploy:

```bash
wrangler deploy
```

Media at `/media/*` is edge-cached via Workers Cache (`[cache] enabled` in `wrangler.toml`). Responses use long-lived `Cache-Control` headers; admin API responses use `no-store` so they are never cached.

### Cloudflare Pages build env

In Pages project settings → Environment variables, add:

| Variable | Value |
|---|---|
| `CF_ACCOUNT_ID` | Your Cloudflare account ID |
| `CF_API_TOKEN` | API token with D1 read permission |
| `CF_D1_DATABASE_ID` | `2cb5dcd1-ff1b-4152-b081-58f56c9e5a55` |

Build command: `node build-pages.mjs`  
Output directory: `dist`

## Admin actions

| Action | Description |
|---|---|
| `thinking` | Update thinking text in D1 |
| `thinking-video-upload-url` | Presigned PUT URL for direct video upload to R2 |
| `list-thinking` | List Thinking archive from D1 |
| `job-status` | Background job health for the /admin/ status strip |
| `post` | Publish new writing post |
| `edit-post` | Edit post (saves version history) |
| `delete-post` | Delete a published writing post |
| `delete-thinking` | Delete a Thinking post (Micro.blog, Bluesky if saved, rebuild) |
| `fetch-post` | Load post for editing |
| `reading` | Add reading entry (optional author + cover) |
| `reading-cover-candidates` | Search Open Library, Apple Books, Google Books for cover art |
| `update-reading-cover` | Save chosen cover URL and author |
| `delete-reading` | Delete reading entry |
| `reading-favorite` | Add book to Books Everyone Should Read |
| `list-reading-favorites` | List curated reading favorites |
| `update-reading-favorite-cover` | Save cover URL and author on a favorite |
| `delete-reading-favorite` | Delete a curated favorite |
| `sharing` | Add linklog entry |
| `list-drafts` | List all writing drafts |
| `save-draft` | Create/update draft |
| `load-draft` | Load draft by id |
| `delete-draft` | Delete draft |
| `refresh-section-hints` | Regenerate homepage section tooltips (Claude Fable) |
| `refresh-reading-tab-intros` | Regenerate Reading Latest / Must Reads tab intro copy (Claude Fable) |
| `backfill-reading-genres` | Assign genre tags to Must Reads favorites missing a primary genre (Claude Fable) |
| `backfill-linklog-tags` | Assign topic tags to Sharing links missing them (Claude Fable) |
| `anthropic-usage-summary` | Token usage totals from D1 (`anthropic_usage` table) |

## Architecture

```text
Admin → Worker → D1 (write)
              ↓
         Pages deploy hook
              ↓
Pages build → D1 HTTP API (read) → build.mjs → dist/ → rommy.blog
```

`data/posts.json` is kept as a legacy fallback for local builds without D1 credentials.
`data/reading-favorites.json` seeds the curated list for local builds; in production it lives in D1 (`reading_favorites`).

### Reading favorites migration

Run from the **repo root** (`fingerguns-blog/`). Requires `scripts/seed-reading-favorites.mjs` and `worker/migrate-reading-favorites.sql` (added in the reading-favorites admin PR — `git pull origin main` first).

```bash
# 1. Create the reading_favorites table (must run inside worker/ — paths are relative to that folder)
cd worker
wrangler d1 execute rommy-blog-db --file=migrate-reading-favorites.sql --remote

# 2. Load the 36 books from data/reading-favorites.json into D1
cd ..
node scripts/seed-reading-favorites.mjs --remote
```

If step 1 fails with “Unable to read SQL text file”, you're not in `worker/` or the migration file isn't in your checkout yet.

### Must Reads genre tags

After deploying the Worker with genre support:

```bash
# 1. Create reading_genres + reading_favorite_genres tables
cd worker
wrangler d1 execute rommy-blog-db --file=migrate-reading-genres.sql --remote

# 2. Tag existing favorites (requires ANTHROPIC_API_KEY in Worker secrets)
cd ..
npm run backfill-reading-genres
```

New favorites get genre tags automatically on add (async, via Claude Fable). Removing a favorite prunes any genre no longer used by another book.

### Anthropic usage logging

After deploying the Worker with usage logging:

```bash
cd worker
wrangler d1 execute rommy-blog-db --file=migrate-anthropic-usage.sql --remote
```

Each Claude Fable call (genre tags, Reading tab intros, tag clouds) logs input/output tokens to D1 and the Worker console. View totals:

```bash
npm run anthropic-usage        # last 30 days
npm run anthropic-usage -- 7   # last 7 days
```

Estimates use approximate Fable list rates; check [Anthropic Console → Cost](https://platform.claude.com/cost) for billed amounts.

### Build caches

Book covers, Spotify art, video-poster checks, and Sharing link unfurls are looked up once and cached, so the build only fetches what is new. These used to live in committed `data/*.json` files, which did not work: Pages builds in an ephemeral checkout, so every cache write was discarded and only a local build followed by a commit ever warmed anything.

They now live in the D1 `build_cache` table, one namespace per cache. To migrate:

```bash
cd worker
wrangler d1 execute rommy-blog-db --remote --file=migrate-build-cache.sql
cd ..
npm run migrate-build-cache
```

Then confirm a build reads from D1 (no `build cache: seeded …` lines in the output) and retire the legacy files:

```bash
git rm --cached data/reading-covers.json data/spotify-thumbnails.json data/video-posters.json data/linklog-unfurls.json
```

Keep them on disk until that build passes — `loadBuildCache` falls back to them when a namespace is empty or D1 is unreachable, which is what makes the migration safe. They are gitignored, so they stay local and stop showing up as working-tree churn.

The build's `CF_API_TOKEN` needs **`Account / D1 / Edit`**, not just Read. With a read-only token the cache still serves reads but silently cannot persist anything newly fetched, so every build refetches it.

**Not to be confused with Cloudflare's own "Build cache" setting** (Pages → Settings → Build), which caches `node_modules` and build artifacts between CI runs. That feature is deliberately left **disabled**: `scripts/build.mjs` imports only Node builtins and local `./lib/*` modules, so the build does not need `node_modules` at all, and a full CI run already completes in about 20 seconds. It is also still in beta, and stale-dependency bugs are exactly the kind of silent failure this project has been removing. The name collision is the only reason it is worth mentioning.

Two D1 constraints shaped the implementation, both worth knowing before writing similar code: the REST `/query` endpoint takes a single statement object rather than an array (so `d1Batch` in `scripts/d1-client.mjs` does not work as written), and at most 100 bound parameters are allowed per query, so multi-row writes are chunked. Covered by `npm test`.

### Background job status

Cron syncs, site rebuilds, and syndication attempts each append a row to `job_runs`, so a failure survives the response that reported it. Before deploying the Worker:

```bash
cd worker
wrangler d1 execute rommy-blog-db --file=migrate-job-runs.sql --remote
```

The `/admin/` header shows a one-line summary — green when everything is healthy, red with the failing job names when it is not — and expands to a per-job list with the last run time and error text.

Jobs on a schedule (`oura-sync`, `rebuild`) carry a staleness threshold, so one that stops firing is reported as stale rather than staying quietly green. Jobs that fire on publish (`syndicate:*`) have no threshold — for those, "never run" means you have not posted since deploying, not a fault.

Rows older than 30 days are pruned by the scheduled handler. Read-side logic is covered by `npm test`.

### Location tracking (Overland)

Private GPS ingest from the [Overland](https://github.com/aaronpk/Overland-iOS) iOS app. Points land in D1; when you publish a Thinking post, the Worker looks up the nearest point (±15 minutes, or ±6 hours if none in that window) and reverse-geocodes a neighborhood label (e.g. `Prospect Heights, Brooklyn`) into `thinking_posts.location_label`. The static build renders it in the post footer.

1. Apply migration (above) and set `LOCATION_API_TOKEN`:

   ```bash
   cd worker
   wrangler secret put LOCATION_API_TOKEN
   wrangler deploy
   ```

2. In Overland → Settings:
   - **Server URL:** `https://rommy.blog/api/locations`
   - **Access Token:** same value as `LOCATION_API_TOKEN`
   - Request **Always** location permission; turn tracking on

3. Publish a Thinking post while Overland has a recent fix — the footer should show neighborhood + city after the next deploy.

**Admin → Location tab:** `/admin/` → **Location** — load the latest thousand GPS points on a MapLibre map (OpenFreeMap Liberty / Dark Matter basemaps, theme-aware), with path history, start/end markers, and a clickable point-by-point timeline (ET). Raw coordinates never appear on the public site.

Admin API: `action: "list-locations"` with optional `from`, `to`, `limit` (max 1000, default 1000; password auth) returns the most recent points, newest first.

Public API: `GET /api/locations/now` (no auth) returns the current neighborhood label, bounding box, and OpenStreetMap search URL — no exact coordinates.

### Oura Ring (daily steps)

Sync daily step counts from the [Oura API v2](https://cloud.ouraring.com/docs/) into D1. The static `/now/` page shows the latest count in a **Walking** section; full history stays in D1.

1. Create a Personal Access Token at [cloud.ouraring.com/personal-access-tokens](https://cloud.ouraring.com/personal-access-tokens).

2. Apply migration and set the token:

   ```bash
   cd worker
   wrangler d1 execute rommy-blog-db --remote --file=migrate-oura.sql
   wrangler secret put OURA_ACCESS_TOKEN
   wrangler deploy
   ```

3. Backfill historical data (~2 years) and trigger a rebuild:

   ```bash
   npm run backfill-oura
   ```

4. A cron job runs every 4 hours to sync the last 14 days and rebuild when new data arrives.

Admin API: `action: "sync-oura"` with optional `backfill: true` (password auth). `action: "oura-steps-summary"` returns latest steps and total days stored.
