# rommy.blog

Personal blog at [rommy.blog](https://rommy.blog). Plain static HTML at deploy time; content and media are managed through a small admin UI backed by Cloudflare.

Built with [Cursor](https://cursor.com). See the [colophon](https://rommy.blog/colophon/) for the full story of how the site works.

## What you get

- **Static site** — HTML, CSS, Atom feed, sitemap; no runtime npm dependencies on Pages
- **Content in D1** — Writing posts, drafts, Reading, Sharing, and the homepage Thinking blurb
- **Media in R2** — Photos (up to 4 per Thinking post), audio, and video for Thinking; photos for Writing (public bucket)
- **Photo gallery** — 2–4 Thinking photos render as a cropped, equal-size 2×2 grid; click opens a full-viewport lightbox with prev/next, keyboard arrows, and infinite swipe on mobile
- **Admin** — Password-protected UI at `/admin/` (Thinking, Writing, Reading, Sharing, Login)
- **Cross-posting** — Thinking can publish to [Micro.blog](https://micro.blog) (Micropub), [Bluesky](https://bsky.app), and [Mastodon](https://joinmastodon.org) when configured; photos, audio, and video render as native attachments/players in each feed (see [Audio & Video Syndication](#audio--video-syndication) below), with the Thinking permalink included in the syndicated text alongside native media
- **Comments** — [Webmentions](https://webmention.io) on Writing posts: incoming likes, reposts, and replies are received by webmention.io and rendered client-side; [Bridgy](https://brid.gy) bridges Mastodon replies/boosts back in
- **Writing editor** — [Quill](https://quilljs.com/) with image upload, text wrap (left / right / center / full), drafts, and post version history
- **Social previews** — Open Graph / Twitter meta on Writing and Thinking permalinks (first in-post image when available)
- **Plain links in Thinking** — URLs in notes are normal hyperlinks on the site (no on-site unfurl cards)
- **Changelog** — Generated from Git history at build time
- **Colophon** — [`/colophon/`](https://rommy.blog/colophon/) describes how the site is built, with an optional toggle to read it in the style of Walt Whitman

## Architecture

```
Admin (Pages) → Worker API → D1 (write) + R2 (photos)
                    ↓
            Pages deploy hook
                    ↓
Pages build → D1 HTTP API (read) → scripts/build.mjs → dist/ → rommy.blog
```

The Thinking **archive** and permalink pages are built from the `thinking_posts` table in D1 at deploy time (same source as the homepage blurb). Slugs use US Eastern time. External links in Thinking are not unfurled at build time — only basic `<a>` tags in the HTML.

Cross-posting still lets Bluesky and Micro.blog unfurl URLs in your notes on their own platforms when you include links there.

## Repository layout

| Path | Purpose |
|------|---------|
| `admin/` | Admin UI (static HTML + JS) |
| `scripts/build.mjs` | Regenerates site into `dist/` |
| `scripts/lib/` | Shared HTML, slug, thinking, linkify, and media-URL helpers (build + Worker) |
| `scripts/d1-client.mjs` | D1 queries for local/Pages builds |
| `build-pages.mjs` | Cloudflare Pages entrypoint (git unshallow + build) |
| `worker/` | Cloudflare Worker (`update-thinking.js`) — admin API |
| `remark42/` | Legacy Remark42 server config, theme CSS, Docker / Fly deploy — unused now that Writing comments run on Webmentions, kept for reference |
| `data/posts.json` | Legacy fallback if D1 env vars are not set |
| `styles.css` | Site styles (light/dark) |
| `about/`, `admin/`, `colophon/`, `contact/` | Hand-authored static pages (copied into `dist/` at build) |

## Requirements

- [Node.js](https://nodejs.org/) 18+ (build scripts only)
- Cloudflare account with **D1**, **R2**, **Workers**, and **Pages**
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) for the Worker

## Local build

```bash
npm run build
npm run preview   # serves dist/ at http://localhost:3000
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

## Cloudflare Worker

See [`worker/README.md`](worker/README.md) for D1 schema, secrets, and deploy steps.

**Admin security:** [`worker/SECURITY.md`](worker/SECURITY.md) — Cloudflare Access on `/admin/`, API rate limiting, optional 30-day remember-me on this device.

**Secrets** (via `wrangler secret put`):

| Secret | Required | Purpose |
|--------|----------|---------|
| `ADMIN_PASSWORD` | Yes | Admin login |
| `PAGES_DEPLOY_HOOK` | Yes | Trigger Pages rebuild after writes |
| `MICROBLOG_TOKEN` | No | Micropub for Thinking |
| `BLUESKY_HANDLE` | No | Bluesky cross-post |
| `BLUESKY_APP_PASSWORD` | No | Bluesky cross-post |
| `MASTODON_ACCESS_TOKEN` | No | Mastodon cross-post |
| `MASTODON_INSTANCE` | No | Mastodon instance URL (default `https://mas.to`) |
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
| `list-thinking` | List Thinking archive from D1 (admin) |
| `upload-media` | Upload image to R2 (`thinking/` or `writing/`) |
| `post` | Publish Writing post |
| `edit-post` | Edit post (version history) |
| `delete-post` | Delete published post |
| `delete-thinking` | Delete Thinking post from archive (Micro.blog + Bluesky when saved) |
| `fetch-post` | Load post for editing |
| `list-drafts` / `save-draft` / `load-draft` / `delete-draft` | Writing drafts |
| `reading` | Add Reading entry |
| `sharing` | Add Sharing (linklog) entry |
| `fetch-title` | Fetch page title for Sharing |
| `verify` | Check admin password |

## Photos

- Up to **4 photos** per Thinking post (mutually exclusive with audio/video); each is compressed independently
- Up to **5 MB** per photo on rommy.blog and Micro.blog (JPEG, PNG, WebP, GIF)
- Bluesky gets a compressed JPEG per photo when the original is over **2 MB**
- **Thinking gallery:** 1 photo renders full width; 2–4 photos render as an equal-size, cropped 2×2 grid at the blog's content width (no letterboxing). Clicking any photo opens a same-page lightbox — full-viewport width, prev/next buttons, `←`/`→`/`Esc`, and swipe-to-navigate on mobile, wrapping at both ends — used identically on the homepage, `/thinking/` archive, and permalinks. On phones (including landscape orientation), lightbox photos render edge-to-edge with no corner rounding
- On Writing posts, portrait-oriented photos default to half width; click to expand/collapse

## Audio & Video Syndication

When a Thinking post includes audio or video, each platform receives it as a native, playable attachment rather than a plain link, and the Thinking permalink is appended to the syndicated text alongside it:

| Platform | Audio | Video |
|----------|-------|-------|
| **micro.blog** | `audio[]` Micropub property → native player in feed and podcast RSS | `video[]` Micropub property → native player |
| **Mastodon** | Uploaded as a media attachment (≤ 40 MB) → renders a player in timelines and third-party apps. Async video/audio transcodes are polled via `GET /api/v1/media/:id` until ready before the status posts | Same |
| **Bluesky** | No native audio support; falls back to a link card pointing to the post | Native only for **MP4** (≤ 50 MB) via `app.bsky.embed.video`; iPhone **MOV** always falls back to a link card, since Bluesky's video embed only accepts MP4. If `createRecord` rejects an uploaded video blob, syndication retries with a link card so the post still goes out |

For files that exceed the per-platform size limit, or when bytes are unavailable (presigned video uploads over the threshold), syndication falls back to the previous behaviour: a plain-text post with a permalink and an "Audio: " or "Video: " prefix. Multiple photos syndicate to all three platforms (Micro.blog via repeated `photo[]` parts, Mastodon and Bluesky via multiple media attachments/images, up to 4).

On mobile, Thinking video posters render a first frame instead of a blank box by appending `#t=0.001` to the video `src`.

## Sharing rommy.blog links

`scripts/build.mjs` sets `og:title`, `og:description`, `og:image`, and `twitter:card` on Writing posts and Thinking permalink pages. Writing uses the post summary and the first `<img>` in the body; Thinking permalinks use a snippet from the note HTML and its first image, or the favicon if there is none.

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
