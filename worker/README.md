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

Migrate existing content from `data/posts.json`:

```bash
node scripts/migrate-to-d1.mjs
```

### Worker secrets

```bash
cd worker
wrangler secret put ADMIN_PASSWORD
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
| `anthropic-usage-summary` | Token usage totals from D1 (`anthropic_usage` table) |

## Architecture

```
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
