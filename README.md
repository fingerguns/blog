# rommy.blog

Personal blog at [rommy.blog](https://rommy.blog). Plain static HTML at deploy time; content and media are managed through a small admin UI backed by Cloudflare.

Built with [Cursor](https://cursor.com). See the [colophon](https://rommy.blog/colophon/) for the full story of how the site works.

## What you get

- **Static site** — HTML, CSS, Atom feed, sitemap; no runtime npm dependencies on Pages
- **Content in D1** — Writing posts, drafts, Reading, Sharing, and the homepage Thinking blurb
- **Media in R2** — Photos for Thinking and Writing (public bucket)
- **Admin** — Password-protected UI at `/admin/` (Thinking, Writing, Reading, Sharing, Login)
- **Cross-posting** — Thinking can publish to [Micro.blog](https://micro.blog) (Micropub) and [Bluesky](https://bsky.app) when configured
- **Writing editor** — [Quill](https://quilljs.com/) with image upload, text wrap (left / right / center / full), drafts, and post version history
- **Changelog** — Generated from Git history at build time

## Architecture

```
Admin (Pages) → Worker API → D1 (write) + R2 (photos)
                    ↓
            Pages deploy hook
                    ↓
Pages build → D1 HTTP API (read) → scripts/build.mjs → dist/ → rommy.blog
```

The Thinking **archive** is built from Micro.blog’s JSON feed at deploy time so older notes stay in sync with your timeline there. The homepage Thinking section comes from D1 (including R2 images).

## Repository layout

| Path | Purpose |
|------|---------|
| `admin/` | Admin UI (static HTML + JS) |
| `scripts/build.mjs` | Regenerates homepage, feed, posts, thinking pages, changelog |
| `scripts/d1-client.mjs` | D1 queries for local/Pages builds |
| `build-pages.mjs` | Cloudflare Pages entrypoint (build + copy to `dist/`) |
| `worker/` | Cloudflare Worker (`update-thinking.js`) — admin API |
| `data/posts.json` | Legacy fallback if D1 env vars are not set |
| `styles.css` | Site styles (light/dark) |
| `posts/`, `thinking/` | Generated HTML (committed so the repo is browsable without D1) |

## Requirements

- [Node.js](https://nodejs.org/) 18+ (build scripts only)
- Cloudflare account with **D1**, **R2**, **Workers**, and **Pages**
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) for the Worker

## Local build

```bash
npm run build
```

Reads from D1 when these env vars are set:

| Variable | Description |
|----------|-------------|
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `CF_API_TOKEN` | API token with D1 read access |
| `CF_D1_DATABASE_ID` | D1 database ID |

Without them, the build falls back to `data/posts.json`.

To preview the admin UI locally against the Worker:

```bash
cd worker && wrangler dev
# serve admin/ separately, e.g. npx serve . -p 8799
```

Point `admin/index.html`’s `API_URL` at your dev Worker URL if needed.

## Cloudflare Pages

**Build command:** `node build-pages.mjs`  
**Output directory:** `dist`

Set the same `CF_*` variables in the Pages project (Production environment).

The build expands shallow Git clones when possible so the changelog has enough history.

Deploys run on push to `main`. A scheduled GitHub Action (`.github/workflows/build.yml`) can also POST a **Pages deploy hook** once per hour as a backup.

## Cloudflare Worker

See [`worker/README.md`](worker/README.md) for D1 schema, secrets, and deploy steps.

**Secrets** (via `wrangler secret put`):

| Secret | Required | Purpose |
|--------|----------|---------|
| `ADMIN_PASSWORD` | Yes | Admin login |
| `PAGES_DEPLOY_HOOK` | Yes | Trigger Pages rebuild after writes |
| `MICROBLOG_TOKEN` | No | Micropub for Thinking |
| `BLUESKY_HANDLE` | No | Bluesky cross-post |
| `BLUESKY_APP_PASSWORD` | No | Bluesky cross-post |
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
| `thinking` | Update Thinking text/photo in D1; optional Micro.blog + Bluesky |
| `upload-media` | Upload image to R2 (`thinking/` or `writing/`) |
| `post` | Publish Writing post |
| `edit-post` | Edit post (version history) |
| `delete-post` | Delete published post |
| `fetch-post` | Load post for editing |
| `list-drafts` / `save-draft` / `load-draft` / `delete-draft` | Writing drafts |
| `reading` | Add Reading entry |
| `sharing` | Add Sharing (linklog) entry |
| `fetch-title` | Fetch page title for Sharing |
| `verify` | Check admin password |

## Photos

- Up to **5 MB** on rommy.blog and Micro.blog (JPEG, PNG, WebP, GIF)
- Bluesky gets a compressed JPEG when the original is over **2 MB**
- Portrait images on the site default to half width; click to expand/collapse

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

No license file is included. The code is public on GitHub for transparency; ask before reusing substantial portions elsewhere.
