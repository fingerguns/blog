# rommy.blog security (step 1)

## 1. Cloudflare Access on `/admin/` (dashboard — do this first)

This gates the admin UI before anyone sees the password form. The Worker API still requires the admin password and rate limiting (below).

The admin page also bounces a signed-out visitor from a working tab's URL to the public site, but that is a courtesy in the browser, not a boundary: the page itself is the same file at every `/admin/*` URL, and what actually protects the content is Access here plus the password the Worker demands on every API call.

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Access** → **Applications** → **Add an application**.
2. Type: **Self-hosted**.
3. **Application domain**
   - Subdomain: leave blank or `www` as needed
   - Domain: `rommy.blog`
   - Path: `/admin` (a prefix — covers `/admin/`, `/admin/index.html`, and the per-tab URLs `/admin/thinking`, `/admin/writing`, `/admin/reading`, `/admin/sharing`, `/admin/location`, `/admin/health`, `/admin/login`)
4. **Identity providers**: e.g. **One-time PIN** to your email, or **GitHub** (restrict to your account).
5. **Policy**: Allow only your identity (e.g. `Emails` → `rommy@gha.ly`, or GitHub username).
6. Save. Test in a private window: `https://rommy.blog/admin/` should show Cloudflare login before the blog password.

**Preview hostname:** Repeat for `rommy-blog.pages.dev` with path `/admin` if you use the Pages preview URL.

**Optional (stronger):** Add a second Access application or WAF rule limiting `rommy-blog-admin.*.workers.dev` — the Worker URL is still public for API calls; password + rate limits protect it.

## 2. Worker rate limiting (code — deploy required)

Failed password attempts are tracked per IP in D1 (`auth_rate_limit`):

- **5** failures within **15 minutes** → **429** for **15 minutes**
- Successful login clears the counter for that IP
- Password comparison is constant-time

**Deploy Worker:**

```bash
cd worker
wrangler d1 execute rommy-blog-db --file=migrate-auth-rate-limit.sql --remote
wrangler deploy
```

New databases get the table from `schema.sql` automatically.

## 3. Admin session (code — deploy Pages)

- After Cloudflare Access, the blog password can be **remembered on this device** for 30 days (`localStorage`, optional checkbox on sign-in). Otherwise it stays in memory for the open tab only.
- Sign out clears remembered sessions on that device.
- Public post pages **no longer** inject Edit/Delete controls that read a stored password.
- Edit/delete from **`/admin/`** only (after Access + sign-in).

Rebuild and deploy Pages after pulling these changes.

## Checklist

- [ ] Cloudflare Access on `rommy.blog/admin`
- [ ] `wrangler d1 execute … migrate-auth-rate-limit.sql --remote`
- [ ] `wrangler deploy`
- [ ] Pages deploy (push to `main` or deploy hook)
- [ ] Sign out of admin on all devices; clear site data once if you used “remember me” before
