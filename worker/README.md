# Cloudflare Worker: admin API for rommy.blog

Content is stored in **Cloudflare D1**. The static site is rebuilt via a **Pages deploy hook**.

**Security:** See [SECURITY.md](./SECURITY.md) for Cloudflare Access on `/admin/`, rate limiting, and session hardening.

## Setup

### D1 database

Already created: `rommy-blog-db` (`2cb5dcd1-ff1b-4152-b081-58f56c9e5a55`)

Apply schema (if needed):

```bash
cd worker
wrangler d1 execute rommy-blog-db --file=schema.sql --remote
```

Migrate existing content from `data/posts.json`:

```bash
node scripts/migrate-to-d1.mjs
```

### Worker secrets

```bash
cd worker
wrangler secret put ADMIN_PASSWORD
wrangler secret put PAGES_DEPLOY_HOOK   # Cloudflare Pages → Settings → Deploy hooks
wrangler secret put MICROBLOG_TOKEN     # optional
wrangler secret put BLUESKY_HANDLE        # optional
wrangler secret put BLUESKY_APP_PASSWORD  # optional
wrangler secret put GITHUB_TOKEN          # optional fallback for rebuild trigger
```

Deploy:

```bash
wrangler deploy
```

### Cloudflare Pages build env

In Pages project settings → Environment variables, add:

| Variable | Value |
|---|---|
| `CF_ACCOUNT_ID` | Your Cloudflare account ID |
| `CF_API_TOKEN` | API token with D1 read permission |
| `CF_D1_DATABASE_ID` | `2cb5dcd1-ff1b-4152-b081-58f56c9e5a55` |

Build command: `node build-pages.mjs`  
Output directory: `dist`

### GitHub secret (hourly rebuild)

Add `PAGES_DEPLOY_HOOK` to GitHub repo secrets (same URL as worker secret).

## Admin actions

| Action | Description |
|---|---|
| `thinking` | Update thinking text in D1 |
| `post` | Publish new writing post |
| `edit-post` | Edit post (saves version history) |
| `delete-post` | Delete a published writing post |
| `delete-thinking` | Delete a Thinking post (Micro.blog, Bluesky if saved, rebuild) |
| `fetch-post` | Load post for editing |
| `reading` | Add reading entry |
| `sharing` | Add linklog entry |
| `list-drafts` | List all writing drafts |
| `save-draft` | Create/update draft |
| `load-draft` | Load draft by id |
| `delete-draft` | Delete draft |

## Architecture

```
Admin → Worker → D1 (write)
              ↓
         Pages deploy hook
              ↓
Pages build → D1 HTTP API (read) → build.mjs → dist/ → rommy.blog
```

`data/posts.json` is kept as a legacy fallback for local builds without D1 credentials.
