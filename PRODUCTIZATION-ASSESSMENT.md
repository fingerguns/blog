# Productization Assessment

*Assessed 2026-08-25. Question: how good is rommy.blog as a CMS framework, and what would it take to
turn it into something other people could use to build their own blogs with a similar look and feel?*

## Verdict

| Lens | Rating |
|------|--------|
| As a personal CMS | **8/10** |
| As a framework others build on | **3/10** |

The low second score is not a code-quality judgment. Every significant architectural decision here is
correctly optimized for exactly one user — and those are precisely the decisions productization would
have to reverse.

**What's genuinely good:** static output means fast, cheap, and still working in ten years. The
D1-as-source-of-truth + render-at-build-time split is clean. The IndieWeb citizenship (Webmentions,
Micropub, syndication) is real rather than decorative. The `anthropic_usage` table shows metering was
already on the radar.

## Structural blockers

### 1. No tenancy anywhere

`grep -riE 'site_id|user_id|tenant|account_id|owner' worker/*.sql` returns **zero hits**.
`posts.slug` is a *global* primary key.

Retrofitting means: a tenant column on all 13 tables, primary keys converted to composites, and a
`WHERE site_id = ?` added to every query inside a 3,206-line worker. Largest single item; touches
everything.

### 2. Auth is one shared password

`ADMIN_PASSWORD` as an env var, compared against a constant (`worker/update-thinking.js:226`). No
users table, no signup, no sessions, no reset flow. Not a gap to fill — a subsystem to build.

### 3. Publish triggers a full site rebuild

`scripts/build.mjs:2260` does `rmSync(outDir)`, regenerates all **272** HTML pages, then fires
`PAGES_DEPLOY_HOOK` (`worker/update-thinking.js:572`). Posting a one-line note destroys and rebuilds
the entire site.

Fine at one user. At N users: either N Cloudflare Pages projects (quota + deploy-hook management
become your problem), or a rewrite to on-demand / incremental rendering — which discards most of the
value currently sitting in `build.mjs`.

### 4. Build-time caches are files committed to the repo

`data/linklog-unfurls.json`, `data/reading-covers.json`, `data/spotify-thumbnails.json`,
`data/video-posters.json` — shared mutable state in git. Breaks immediately with two concurrent
tenants. Must move to KV or D1.

### 5. ~22 env vars, most of them personal secrets

`ADMIN_PASSWORD` `BLUESKY_APP_PASSWORD` `BLUESKY_HANDLE` `MASTODON_ACCESS_TOKEN` `MASTODON_INSTANCE`
`MICROBLOG_TOKEN` `OURA_ACCESS_TOKEN` `GITHUB_TOKEN` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY`
`PAGES_DEPLOY_HOOK` `LOCATION_API_TOKEN` `GOOGLE_BOOKS_API_KEY` `BOOKSHOP_AFFILIATE_ID` …

In a product each becomes per-tenant encrypted storage, and pasted tokens have to become OAuth for
anything you don't want to be liable for.

### Secondary

- **70% of the code is in three files** with no module seams to extract along:
  `admin/index.html` (3,785), `worker/update-thinking.js` (3,206), `scripts/build.mjs` (2,349).
  Total ~13.3k LOC + 1,853 lines of CSS.
- **The content model is hardcoded.** Thinking / Writing / Reading / Sharing / Now exist as tables and
  build steps, not user-definable content types.
- **Personal data patches are committed** — `worker/update-hopscotch-cover.sql`,
  `update-big-sur-cover.sql`, and ~a dozen siblings. Personal-site smell, not product smell.
- **Per-content-change AI calls** (Claude Fable for tags, genres, tab intros, section hints) become a
  per-tenant cost centre needing metering and caps.
- **Hardcoded personal strings across ~29 files** — mostly domain URLs and identity. Tedious, not hard.

## Three paths

| Path | Effort | Notes |
|------|--------|-------|
| **Template repo** | 1–2 weeks | Extract hardcoded strings, write setup docs. Low risk, low reward — the audience already fluent in Wrangler/D1/R2 can read the repo today. |
| **One-click self-deploy** ⭐ | 4–6 weeks | "Deploy to Cloudflare" button + wizard that provisions D1/R2, runs migrations, walks through account connections. Users own their infra and their Cloudflare bill. No tenancy, no billing, no hosting support. |
| **Multi-tenant SaaS** | 4–8 months solo | Tenancy retrofit, auth, billing, per-tenant secrets, rebuilt publish pipeline, theming, onboarding, custom domains via Cloudflare for SaaS. That's the build, not the operating. |

## Drawbacks worth sitting with

**The competitive floor is high.** [Micro.blog](https://micro.blog) is $5/month and already does hosted
IndieWeb blogging with cross-posting — a substantial fraction of what rommy.blog *is*. Bear Blog and
Mataroa own the minimal-aesthetic niche. This is a well-served market.

**Support becomes the actual job.** Custom domains, TLS, "my Bluesky cross-post failed silently." For
one user those are curiosities fixed when convenient. For paying users they're tickets.

**The deepest tension:** what makes rommy.blog good is that it is *personally* opinionated — Reading
with genre tags, Thinking with neighborhood labels from the Overland feed, a Now page wired to an Oura
ring. Generalize those into configurable content types and the result is a worse Eleventy. Keep them
and it's a CMS that only fits people whose lives are shaped like this one. That tension does not
resolve; you pick a side.

## Recommendation

**Take the self-deploy path.** It puts the look-and-feel in other people's hands, costs six weeks
instead of six months, and leaves you owning zero infrastructure for strangers. If real demand shows
up there, that's the signal for the bigger build — and by then you'll know which parts people actually
want to change first.
