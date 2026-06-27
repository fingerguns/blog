# Remark42 for rommy.blog

Self-hosted [Remark42](https://remark42.com) comments on **Writing posts only**. The build embeds the widget when `REMARK42_HOST` is set (defaults to `https://comments.rommy.blog`).

## Quick start (Docker)

```bash
cd remark42
cp .env.example .env
# Edit .env — set REMARK42_SECRET and ADMIN_SHARED_SECRET
docker compose up -d
```

Open `http://localhost:8080/web/` to confirm the server is up. Comments appear on Writing permalinks after DNS points `comments.rommy.blog` at this host.

## Fly.io

```bash
cd remark42
fly launch --no-deploy
fly secrets set SECRET=... ADMIN_SHARED_SECRET=...
fly volumes create remark42_data --region ewr
fly deploy
fly certs add comments.rommy.blog
```

Add a CNAME: `comments.rommy.blog` → `rommy-remark42.fly.dev` (or use `fly certs add` and follow Fly’s DNS instructions).

Remark42 expects **`REMARK_URL`**, **`SECRET`**, and **`SITE`** — not `REMARK42_*`. These are set in `fly.toml` and Fly secrets.

## DNS (Cloudflare)

| Record | Target |
|--------|--------|
| `comments` CNAME | Fly app hostname or your server |

Enable **Proxied** (orange cloud) if you want Cloudflare TLS in front of Fly.

### Cloudflare caching (important)

When `comments.rommy.blog` is **proxied**, Cloudflare caches Remark42 static assets (including `/web/remark.css`) for up to **4 hours** (`cache-control: max-age=14400`). A hard refresh on rommy.blog does **not** bust that cache — the comment iframe loads CSS from `comments.rommy.blog`, not from the blog. Browsers also cache the iframe stylesheet independently of the blog page.

The Docker build patches `iframe.html` to load `remark.css?v=<hash>` so CSS updates take effect without waiting on cache TTL.

After deploying CSS changes:

1. **Purge now:** Cloudflare dashboard → your zone → **Caching** → **Purge Cache** → **Custom Purge** → URL: `https://comments.rommy.blog/web/remark.css`
2. **Avoid repeat:** **Caching** → **Cache Rules** → create a rule for `comments.rommy.blog/web/*` with **Bypass cache**.

Or set the `comments` CNAME to **DNS only** (grey cloud) — Fly’s certificate covers HTTPS and Cloudflare will not cache origin responses.

Verify the live file includes the overrides header:

```bash
curl -sL https://comments.rommy.blog/web/remark.css | head -2
# Expected after deploy + purge:
# @import url("remark-base.css");
# /* rommy.blog — Remark42 theme overrides ...
```

## Auth

Defaults in `docker-compose.yml`:

- **Anonymous** and **email** sign-in enabled
- Optional **GitHub** OAuth — set `AUTH_GITHUB_CID` and `AUTH_GITHUB_CSEC` in `.env`

Admin moderation uses `ADMIN_SHARED_ID` / `ADMIN_SHARED_SECRET` from `.env`.

## Theme

`remark.css` matches rommy.blog (Inter, warm off-white / near-black, subtle link underlines). Built as `remark-overrides.css` layered on Remark42’s default stylesheet. The site footer theme toggle keeps the comment iframe in sync with light/dark mode.

## Build / Pages env

| Variable | Default | Purpose |
|----------|---------|---------|
| `REMARK42_HOST` | `https://comments.rommy.blog` | Remark42 server URL |
| `REMARK42_SITE_ID` | `rommy.blog` | Must match `REMARK42_SITE` on the server |
| `REMARK42_DISABLED` | — | Set to `1` to omit the embed from builds |

Set these in the Cloudflare Pages project if you use a different host or site id.

## Verify

1. Deploy Remark42 and DNS.
2. Push to `main` (or run `npm run build` locally with D1 env vars).
3. Open a Writing post at `https://rommy.blog/posts/.../` — Comments section at the bottom.
4. Toggle light/dark in the footer; the comment widget should follow.
