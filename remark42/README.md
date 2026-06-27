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

## Auth

Defaults in `docker-compose.yml`:

- **Anonymous** and **email** sign-in enabled
- Optional **GitHub** OAuth — set `AUTH_GITHUB_CID` and `AUTH_GITHUB_CSEC` in `.env`

Admin moderation uses `ADMIN_SHARED_ID` / `ADMIN_SHARED_SECRET` from `.env`.

## Theme

`remark.css` matches rommy.blog (Inter, warm off-white / near-black, subtle link underlines). It is mounted into the container at `/var/www/remark42/web/remark.css`. The site footer theme toggle syncs via `window.REMARK42.changeTheme()`.

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
