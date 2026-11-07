# GitHub vs Cursor Origin vs Codeberg vs Entire — decision matrix

A scored comparison of the four forge options for rommy.blog, with **GitHub as the baseline** because that is how the site operates today. The purpose is not to argue for a move. It is to make the move *decidable*: each vector carries a tripwire, and when enough tripwires fire the switch is worth reconsidering.

Migration mechanics live in [`FORGEJO-MIGRATION.md`](FORGEJO-MIGRATION.md) and [`ORIGIN-MIGRATION.md`](ORIGIN-MIGRATION.md). Entire has no migration plan yet; it is mirrored, not migrated (see [Where a challenger already wins](#where-a-challenger-already-wins)). This document is only the comparison.

**Last scored: 2026-08-28; Entire added 2026-11-07.** Kept current by the weekly docs drift sweep.

---

## 1. What is actually being compared

A correction worth making before any table: **GitHub, Origin, Codeberg, and Entire are forges. None of them provides a database, object storage, or serverless compute.** Cloudflare does, and Cloudflare stays put under all four options. (Entire sells agent runs, which is compute, but not compute this site could run on.) D1, R2, Workers, and Pages are not in play in this decision.

They are scored below anyway — you asked for those vectors, and their being *constant* is the single most important fact in this whole comparison. It is why changing forge is a low-risk change: your writing, your media, and your API never move. Rows marked **constant** score identically by construction and are excluded from the totals.

So the decision lives in three places only:

1. **Where CI runs**, since Cloudflare Pages will not build from Forgejo, Origin, or Entire.
2. **What reaches the repo** — agents, `gh`, review tooling.
3. **Who you are trusting** with the only offsite copy of your history.

### Scoring rubric

Scores are **0–10 against this stack's needs**, not general product quality. A solo, public, MIT-licensed static blog with three npm dependencies and one author has different needs than a company. GitHub is the baseline but is *not* automatically 10 — it scores 3 on independence, and 7 on secret scanning for reasons documented below.

Weights reflect what would actually hurt if it broke:

- **×3 critical** — publishing from the phone stops working.
- **×2 important** — real degradation, workable.
- **×1 minor** — noticeable, not painful.
- **×0 constant** — same under all four; shown for completeness.

**How Entire is scored.** Entire runs in two modes. As a **mirror** — what this repo has today — GitHub stays the source of truth, pushes through Entire are forwarded to GitHub, and every GitHub capability keeps working, so the mirror scores the same as GitHub by construction and tells you nothing. The column below scores the mode a cutover would actually mean: a **native repo on Entire with no GitHub upstream**.

---

## 2. The matrix

| Vector | Weight | **GitHub** (baseline) | **Origin** | **Codeberg** | **Entire** (native) |
|---|---|---|---|---|---|
| **Deploy pipeline** | | | | | |
| CI/CD availability | ×3 | **10** — Actions free and unlimited on standard runners for public repos, hosted, mature | **2** — no CI of its own; needs the container builder, or Cursor Automations | **5** — Woodpecker is form-gated and volunteer-reviewed; Forgejo Actions is limited open alpha; a self-hosted runner is yours to operate | **4** — CI Integrations (Depot, Buildkite, Dagger, RWX) are public preview; nothing hosted by Entire, no GitHub Actions runners; Depot accepts Actions-syntax YAML on its own compute; CI pricing undocumented |
| Deploy path to Cloudflare Pages | ×3 | **10** — native git integration, zero config | **5** — Pages cannot build from it; `wrangler pages deploy` works from any runner you supply | **5** — identical constraint and identical workaround | **5** — Pages cannot build from it; `wrangler pages deploy` from whichever CI provider you pick |
| Publish-triggered rebuild (admin → live) | ×3 | **9** — deploy hook today, `workflow_dispatch` as fallback | **3** — needs container builder plus a service binding; webhooks need an Origin App | **7** — Forgejo's workflow-dispatch API is a near drop-in for the existing fallback, but needs a runner online | **3** — no documented dispatch path the Worker could call; webhooks are experimental and exposed only to plugin developers |
| **Agents, review, and tooling** | | | | | |
| Agent & tooling integration | ×3 | **10** — Claude Code cloud routines, `gh`, `/code-review ultra`; the weekly drift sweep runs against it | **3** — Cursor-native automations; Claude Code cloud routine support still untested | **2** — cloud routines **cannot** clone it, confirmed by test (see T2), so the weekly sweep could not follow a migration; no `gh`; `tea` exists but nothing here speaks it | **3** — Claude Code is Entire's default agent integration for session capture, but that is Entire watching Claude, not Claude reaching Entire: cloud routines resolve sources as GitHub `owner/repo` (T2), so a native repo would very likely fail the same way; no `gh` |
| Code review / PRs | ×1 | **9** — mature, plus a bot ecosystem | **5** — Cursor-centric | **7** — Forgejo PRs are solid; no bot ecosystem | **6** — Trails replace PRs, with agent review on every push and human approval gates; agent reviews are billed per token |
| Issues & tracking | ×1 | **8** — more than a solo blog needs | **3** — no real tracker | **8** — Forgejo issues, equally sufficient | **2** — no standalone tracker; a trail can open from a bug report |
| **Repo, security, maintenance** | | | | | |
| Git hosting & durability | ×2 | **9** — vast scale, high reliability, single vendor | **6** — young product, Internal/Private only, unproven durability | **8** — non-profit on own hardware in Berlin, with Hetzner/netcup backups; smaller resources | **6** — writes replicated across availability zones, optional multi-region; no SLA, Entire-native branches not backed up, young product |
| Secret scanning & push protection | ×2 | **7** — free for public repos, partner validation, generic and AI patterns — **but it did not catch the live Giphy key that sat in this public repo for five weeks** | **2** — nothing documented | **3** — Forgejo has no built-in scanning | **2** — none for source code; redaction covers only Entire's own session data. Worse for a public repo: checkpoints are pushed by default, so session transcripts would be public |
| Dependency updates | ×1 | **9** — Dependabot, free | **1** — none | **3** — Renovate self-hosts, forge-agnostic | **1** — none |
| Backup & offsite redundancy | ×2 | **7** — a full copy outside Cloudflare, but Microsoft-owned and single | **5** — one more proprietary vendor holding the only copy | **8** — independent organisation, own hardware plus offsite backups | **5** — one VC-backed vendor holding the only copy, multi-region if you opt in |
| **Economics and control** | | | | | |
| Cost at this scale | ×2 | **10** — $0, unlimited Actions for a public repo | **8** — bundled with a Cursor subscription | **9** — free, donation-supported; donating is the honest price | **8** — hosting is free; agent runs bill per token and can start on every push, so the default is not $0 |
| Independence & governance | ×2 | **3** — Microsoft, proprietary, your code is training-adjacent | **4** — VC-backed startup, proprietary, young | **10** — non-profit e.V., member-governed budget, AGPL software, exit is `git clone` | **4** — $60M seed (Felicis), founded by GitHub's former CEO; proprietary backend; open source and self-hosting promised with no date |
| Operational burden | ×2 | **10** — zero | **6** — a container builder to maintain | **7** — low as a pure host; lower if you run a runner | **6** — nothing to run as a host, but CI moves to a third-party account |
| **Data plane — constant, not in play** | | | | | |
| Database (Cloudflare D1) | ×0 | **10** | **10** | **10** | **10** |
| Object storage (Cloudflare R2) | ×0 | **10** | **10** | **10** | **10** |
| Serverless compute (Workers) | ×0 | **10** | **10** | **10** | **10** |

### Totals

| | Weighted | Of 270 | Unweighted mean |
|---|---|---|---|
| **GitHub** | **235** | **87.0%** | 8.5 |
| **Codeberg** | **165** | **61.1%** | 6.3 |
| **Entire** (native) | **116** | **43.0%** | 4.2 |
| **Origin** | **110** | **40.7%** | 4.1 |

Recomputed 2026-09-07 from the matrix above; no score or weight changed. The
thirteen scored weights sum to 27, so the maximum is 270, not 290. Entire's
row was scored 2026-11-07 against the same weights.

Codeberg is the credible challenger and is not close yet. Origin is not competitive for this stack and the gap is structural, not a matter of maturity: no CI and no public visibility are product decisions, not missing features.

Entire lands just above Origin, but for the opposite reason: its gaps are about **maturity**, not structure. CI is in public preview, public native repos are on the roadmap, and so are the open-source backend and self-hosting. Most of its low scores are dated promises rather than refusals, which makes it the column most likely to move. It also shares Origin's agent-first stance — Trails instead of PRs, agent review on every push — and that pays off least for a single human author.

The single largest barrier is **agent tooling**, and as of 2026-08-28 it is measured rather than assumed — see [T2](#3-tripwires). Cloud routines resolve a source URL as a GitHub `owner/repo` no matter which host is given, so migrating the repo would take the weekly drift sweep with it. The documents that keep this decision current depend on the forge the decision is about.

### Where a challenger already wins

Three rows today, and the pattern in them is the whole argument (Entire wins none of them; its best rows are Code review at 6 and Cost at 8):

- **Independence & governance** — Codeberg 10 vs GitHub 3. The largest single gap in the matrix, in either direction.
- **Backup & offsite redundancy** — Codeberg 8 vs GitHub 7.
- **Issues & tracking** — tied at 8.

Every one of those is a *values* or *durability* win. GitHub's wins are all *capability* wins. That is the real shape of this decision, and no amount of scoring resolves it for you: the question is whether independence is worth more than the tooling you would give up.

**The push mirror already banked both of Codeberg's wins.** Since 2026-08-28 every `git push` reaches both hosts, so the redundancy and the independent copy exist *now*, without migrating. That is why the totals above do not create urgency — the cheapest 80% of the benefit is already collected.

**Entire is already mirrored too.** `entire.com/gh/fingerguns/blog` follows GitHub through the Entire GitHub App, and on 2026-11-07 it showed the same `main` head as GitHub within minutes of the push. That gives a third copy of the history, in a region you choose, at no cost, and it is the right way to evaluate Entire: as a mirror it changes nothing, and the tripwires below say when it is worth more than that. The mirror does not cover Entire-native branches (`entire/unmirrored/…`), which stay off GitHub and are not backed up. Checkpoint capture (`entire enable`) is **not** turned on in this repo, and in a public repo it should stay off unless you want session transcripts published alongside the commits.

---

## 3. Tripwires

The condition under which each row's verdict changes. The weekly sweep checks these; anything that fires is worth a look.

| # | Vector | Tripwire — the switch becomes worth reconsidering when… |
|---|---|---|
| T1 | CI/CD | Codeberg's hosted Forgejo Actions leaves limited alpha and offers general availability without a form-gated review, **or** you are already running a always-on server for something else, making a self-hosted runner free at the margin |
| T2 | Agent & tooling | Claude Code cloud routines accept a non-GitHub git URL. **Tested 2026-08-28: they do not.** A one-shot routine pointed at `https://codeberg.org/fingerguns/blog` was *accepted at creation* — the API raised no objection to the host — but the runner then logged `Cloning repository fingerguns/blog`, having discarded the host entirely, and failed with `Check that your GitHub token or credentials have read access`. The repo is public on Codeberg and needs no credentials to clone, so this is not an auth problem: the source URL is resolved as a GitHub `owner/repo` regardless of what host you give it. Fires only when Anthropic ships non-GitHub source support |
| T3 | Agent & tooling | `/code-review` and the `gh`-based flow gain a Forgejo path, or you stop relying on them |
| T4 | Publish-triggered rebuild | The Forgejo workflow-dispatch swap is proven end to end on a scratch repo — it is ~10 lines and currently untested |
| T5 | Secret scanning | A second GitHub-caught-nothing incident, or Forgejo ships native scanning. Note the local `gitleaks` hook already levels this row — it is forge-independent |
| T6 | Deploy path | Cloudflare Pages adds a third git provider, or Workers Builds does. Unlikely; would collapse rows 2 and 3 at once |
| T7 | Independence | A GitHub policy change you object to — training data, licensing terms, account requirements |
| T8 | Durability | Codeberg's storage soft caps (750 MiB git, 1.5 GiB LFS/packages) come within reach. Repo is **~2 MB** (2026-11: GitHub reports about 2.2 MB) — decades away at the current rate. Fires when GitHub's reported size passes **100 MB**; there is no need to re-measure it until then |
| T9 | Cost | GitHub bills for anything this repo uses, or the Cursor subscription lapses (Origin only) |
| T10 | Licensing | Repo content stops being MIT-compatible. Codeberg requires free/open licensing and does not sell exceptions — the source qualifies, though note the README already reserves prose and photos from the MIT grant |

| T11 | Native hosting (Entire) | Entire documents **public** native repositories as generally available. Today the docs describe native repos, but the only example shown is private, and the launch post still lists public native hosting as future work. Until this fires, Entire cannot be a cutover target for a public blog at all |
| T12 | CI/CD (Entire) | Entire CI Integrations leave public preview with published pricing, **and** there is a documented way for the Worker to trigger a build (a repo-owner webhook or dispatch API) — the equivalent of T4 |
| T13 | Independence (Entire) | The open-source Git backend and self-hosted nodes ship. That would move Independence from 4 to about 8 and Backup from 5 to about 8, the two rows where Codeberg currently wins on values |

**Switch threshold.** Reconsider seriously when **T2 fires together with either T1 or T4** — that is the combination where Codeberg's weighted total crosses roughly 75% and the remaining gap is tooling you have already replaced. Any single tripwire on its own is interesting, not decisive. **For Entire**, the threshold is **T11 and T12 together with T2**: without T11 it is not an option, without T12 it cannot publish from the phone, and without T2 it loses the weekly sweep just as Codeberg would.

---

## 4. Honest weaknesses of this document

- **Origin's scores are the least reliable.** They derive from research done for `ORIGIN-MIGRATION.md` rather than from operating it. Anything Cursor has shipped since is unreflected.
- **T2 is resolved, and it resolved against the challengers.** Codeberg's 2 is now measured rather than assumed. **Origin's 3 is still an assumption** — the same probe has not been run against an `origin.cursor.com` URL, and given the Codeberg result the likeliest outcome is that it fails identically. Worth one more fifteen-minute test if Origin ever becomes a live option.
- **T2 is now the binding constraint on the whole decision.** The switch threshold requires T2 plus T1 or T4; T2 cannot fire through any effort of yours, only through a change on Anthropic's side. Until then the honest position is that a migration costs the weekly drift sweep — the thing keeping these documents true — and no amount of movement in Codeberg's other rows changes that.
- **The weights are judgement, not measurement.** They encode "publishing from my phone must keep working" as the dominant constraint. If that stopped being true — if you were happy deploying by hand — CI drops from ×3 to ×1 and Codeberg closes most of the gap immediately.
- **Entire's scores are research, not operation.** They come from docs.entire.com and entire.com as read on 2026-11-07, while the product was still labelled preview with early-access pricing. The docs contradict each other in places (native hosting described as current in the docs but as future work in the launch post; free trial credit both offered and paused), and the GitHub → mirror sync interval is not documented anywhere. Treat this column as the least stable in the matrix and re-score it after any Entire launch post.
- **Scores are a snapshot.** Codeberg's CI position in particular is moving, and it is the row most likely to be stale first.

---

## Sources

- [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) — free and unlimited on standard runners for public repositories
- [GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning) — free for public repos; partner, generic, and AI-detected patterns
- [Codeberg FAQ](https://docs.codeberg.org/getting-started/faq/) — non-profit e.V., donation funded, 750 MiB git / 1.5 GiB LFS soft caps, free-licensing requirement
- [Codeberg CI](https://docs.codeberg.org/ci/) and [Forgejo Actions on Codeberg](https://docs.codeberg.org/ci/actions/) — Woodpecker is form-gated; Actions runners are bring-your-own
- [Codeberg-hosted Actions status](https://codeberg.org/Codeberg/Community/issues/1702) — limited open alpha
- [Cloudflare Pages git integration](https://developers.cloudflare.com/pages/configuration/git-integration/) — GitHub and GitLab only, no self-hosted instances
- [Entire: distributed Git hosting launch post](https://entire.com/blog/an-entirely-new-git-hosting-network) — mirrors, regions, multi-AZ replication; native public hosting, open-source backend and self-hosting listed as future work
- [Entire mirrors](https://docs.entire.com/guides/repositories/mirrors.md) and [mirrors in the CLI](https://docs.entire.com/guides/repositories/mirrors-in-cli.md) — pushes forwarded to GitHub, `entire/unmirrored/` branches, no LFS, hourly access-list sync
- [Entire CI overview](https://docs.entire.com/guides/ci/overview.md) — CI Integrations in public preview with Depot, Buildkite, Dagger, RWX
- [Entire security](https://docs.entire.com/security.md) — no source-code scanning; checkpoints pushed by default and public in a public repo
- [Entire pricing](https://entire.com/pricing) — free hosting; agent runs billed per token
- [Hello, Entire World](https://entire.com/blog/hello-entire-world.md) — $60M seed led by Felicis
- [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) — git-integrated projects can still deploy via Wrangler
