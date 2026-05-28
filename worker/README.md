# Thinking admin (Cloudflare Worker)

This worker lets you update `thinking.text` in `data/posts.json` from [rommy.blog/admin/](../admin/) without using Cursor.

## One-time setup

### 1. GitHub token

Create a [fine-grained personal access token](https://github.com/settings/tokens?type=beta):

- Repository access: **Only** `fingerguns/blog`
- Permissions: **Contents** → Read and write

Save the token somewhere safe.

### 2. Cloudflare account

Install Wrangler if needed:

```bash
npm install -g wrangler
wrangler login
```

### 3. Deploy the worker

From this directory:

```bash
cd worker
wrangler secret put ADMIN_PASSWORD   # pick a strong password
wrangler secret put GITHUB_TOKEN     # paste the PAT from step 1
wrangler deploy
```

Note the URL Wrangler prints, e.g. `https://rommy-blog-admin.yourname.workers.dev`.

### 4. Point the admin page at the worker

Edit [admin/index.html](../admin/index.html) and set `API_URL` to your worker URL:

```javascript
const API_URL = "https://rommy-blog-admin.yourname.workers.dev";
```

Commit and push that change.

### 5. GitHub Action

The workflow in `.github/workflows/build.yml` rebuilds the site whenever `data/posts.json` changes. After you save from `/admin/`, the live site updates in about a minute.

## Usage

1. Open **https://rommy.blog/admin/**
2. Enter your admin password and new thought
3. Click **Save**
4. Wait ~60 seconds for GitHub Actions to rebuild and deploy

## Local preview

Add your worker URL to `ALLOWED_ORIGINS` in `wrangler.toml` if you use a different localhost port, then redeploy.

## Security

- Never put `GITHUB_TOKEN` or `ADMIN_PASSWORD` in the admin page or this repo.
- `/admin/` is unlisted (not linked from the site) and uses `noindex`.
- Rotate the password and token if either is exposed.
