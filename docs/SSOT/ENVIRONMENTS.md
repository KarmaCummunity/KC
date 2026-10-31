# Environments

> **Canonical source for branch ↔ Supabase ↔ Cloudflare Pages ↔ env-var mapping.**
> If another doc disagrees, this one wins. Last reviewed: 2026-10-31 (CI docs drift, `INFRA-CI-5`).

## TL;DR

| Concern | `main` (KC production) | `dev` (KC integration) | `staging` (KC pre-prod) |
|---|---|---|---|
| Git branch | `main` | `dev` | `staging` |
| Supabase project | `kdqtbdbzwvlugkhonexg` | `enbqriuxvvuontiwslun` | `enbqriuxvvuontiwslun` |
| Hosting | Cloudflare Pages — `karma-community-kc.com` | Cloudflare Pages — `dev.karma-community.pages.dev` | Cloudflare Pages — `staging.karma-community.pages.dev` |
| **Live product URL** | `https://karma-community-kc.com/` | `https://dev.karma-community.pages.dev/` | `https://staging.karma-community.pages.dev/` |
| GitHub Actions env | `cloudflare-prod` | `cloudflare-dev` | `cloudflare-dev` |
| `EXPO_PUBLIC_ENVIRONMENT` | `production` | `development` | `development` |
| In-app dev banner | hidden | visible | visible |

> **GloWe sunset (2026-10-16, D-190):** The GloWe static frontend and `glowe_*` schema were removed. All branches deploy the KC web export at the site root. Legacy `/glowe/*` URLs redirect to `/` via `web-postbuild.mjs`.

## Branching rules

1. **`staging` is optional pre-integration.** Feature PRs may target `staging` first, then `staging` → `dev`. It has no automatic deploy since `INFRA-CI-3` (only `dev` and `main` deploy); `staging.karma-community.pages.dev` keeps its last build.
2. **`dev` is the integration branch.** After a merge passes CI, **Deploy** ships it to kc-dev and `https://dev.karma-community.pages.dev/`.
3. **`dev` must contain `main`'s history.** Every push to `main` triggers `.github/workflows/sync-main-to-dev.yml`, which opens a zero-diff PR into `dev` (an `-s ours` merge of `main`) so the next release PR does not conflict. That PR must land as a **merge commit**, which the squash-only `dev` merge queue cannot do, so the owner merges it with the admin bypass (`TD-182`).
4. **`main` is fast-forward only from `dev`.** KC production releases happen by opening a PR from `dev` → `main` and squash-merging.
5. **Direct pushes to `main` are reserved for trivial doc/CI hotfixes** (see `CLAUDE.md` §6 "Change classes"). The sync PR records them in `dev`'s history, but its `-s ours` merge keeps `dev`'s tree, so the change itself must also reach `dev` by its own PR.
6. **Never force-push to `main`, `dev`, or `staging`.** Never delete any of them. Branch-protection rules in GitHub enforce all three.

## Required environment variables

All variables prefixed `EXPO_PUBLIC_*` are exposed to the client bundle by Expo's bundler. Variables without that prefix are server-only.

| Variable | `main` value | `dev` value | Where it's read |
|---|---|---|---|
| `EXPO_PUBLIC_ENVIRONMENT` | `production` | `development` | `apps/mobile/src/config/environment.ts` — drives the in-app dev banner |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://kdqtbdbzwvlugkhonexg.supabase.co` | `https://enbqriuxvvuontiwslun.supabase.co` | `packages/infrastructure-supabase/src/client.ts` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | (publishable key for prod project) | (publishable key for dev project) | `packages/infrastructure-supabase/src/client.ts` |

**Edge Function secret (Survey B CORS, not in the client bundle):** set `PUBLIC_RESEARCH_ALLOWED_ORIGINS` on each Supabase project (or as a GitHub Environment **variable** on `supabase-prod` / `supabase-dev` — synced by the Edge Functions stage of **Deploy**). `supabase/functions/_shared/cors.ts` always allows the Cloudflare Pages hosts (`dev.karma-community.pages.dev`, `karma-community-kc.com`, `www.karma-community-kc.com`) and the local dev origins, so the variable is needed only for extra origins. See [`OPERATOR_RUNBOOK.md`](./OPERATOR_RUNBOOK.md) § Edge Functions.

**Edge Function error reporting (G41, `D-202`):** set the GitHub Environment secret `EDGE_SENTRY_DSN` on `supabase-prod` / `supabase-dev`; the Edge Functions stage of **Deploy** (`deploy-functions.yml`) syncs it to the Supabase secrets `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (`prod` / `dev`) and `SENTRY_RELEASE`. Until then every Edge Function logs errors only. Setup and verification: [`OPERATOR_RUNBOOK.md`](./OPERATOR_RUNBOOK.md) § Edge Function error reporting.

> **Pitfall:** Expo only exposes vars that start with `EXPO_PUBLIC_`. A var named `PUBLIC_ENVIRONMENT` (no `EXPO_` prefix) is invisible to the client bundle.
>
> **Cloudflare Pages web build:** `deploy-web.yml` builds the export on the runner with the `EXPO_PUBLIC_*` values of the `cloudflare-dev` / `cloudflare-prod` environment; nothing is configured in the Cloudflare dashboard. A value missing there is missing from the bundle.
>
> **Local Metro:** `pnpm ios` / `expo start` runs a `__DEV__` bundle, which shows the dev strip even without `EXPO_PUBLIC_ENVIRONMENT`. That variable is still required for **non-`__DEV__`** builds (e.g. `expo export` on CI) so testers see the strip without a debug client.

## Runbook: `dev` branch was deleted

If `git ls-remote --heads origin | grep dev` returns nothing (e.g. an agent accidentally deleted it), restore it from `main`:

```bash
git fetch origin main
git push origin refs/remotes/origin/main:refs/heads/dev
```

Then verify the `dev protection (merge queue)` ruleset still targets `dev` (Settings → Rules → Rulesets) and dispatch **Deploy** on `dev` to redeploy kc-dev.

## Runbook: dev banner not showing on the dev deployment

Checklist in order:

0. If you are on **local Metro** (`expo start`) and still see no strip, you are likely running a **release** build (`__DEV__` off). Use a debug build or set `EXPO_PUBLIC_ENVIRONMENT=development` and rebuild.
1. **GitHub environment:** confirm `cloudflare-dev` has `EXPO_PUBLIC_ENVIRONMENT=development` (exact name); `deploy-web.yml` passes it to `expo export`.
2. Redeploy — dispatch **Deploy** on `dev`; a variable change needs a new build.
3. Open the dev URL in an incognito window (cached service worker can serve stale bundles).
4. In DevTools console: `process.env` is not present at runtime in Expo; instead inspect the bundle by searching for `'development'` in the JS bundle source, OR temporarily add `console.log('env', getAppEnvironment())` to verify the value reached the client.

## Sync workflow internals

`.github/workflows/sync-main-to-dev.yml`:

- Triggers: every push to `main`, plus manual `workflow_dispatch`.
- Concurrency: `sync-main-to-dev` group with `cancel-in-progress: false` — back-to-back pushes queue rather than skip.
- Strategy: exits when `dev` already contains `main`; otherwise pushes branch `sync/main-into-dev-<sha>` holding an `-s ours` merge of `main` into `dev` (it fails if that merge changes any file) and opens a PR into `dev`.
- The PR must be merged as a **merge commit** (a squash drops the ancestry). The `dev` merge queue squashes, so the owner merges it with the admin bypass (`TD-182`).

## Deploy pipeline (`D-195`, `INFRA-CI-3`)

Nothing deploys on push. `.github/workflows/deploy.yml` (**Deploy**) is the only workflow that deploys, and it deploys one exact commit:

- **Trigger:** `workflow_run` of **CI** — a successful **push** run on `dev` or `main` deploys that run's `head_sha` — plus `workflow_dispatch` from `dev` or `main` (re-deploy the tip; the run itself checks via the GitHub API that a push-event CI run gave that SHA a green `CI gate`). A commit that is no longer the branch tip is skipped (its successor deploys after its own CI run), so a slow CI run can never roll an environment back. A prod commit must also be the merge commit of a merged `dev` → `main` PR of this repository, with `app/VERSION` above the latest `v*` tag. The resolver (`scripts/deploy-target.mjs`) runs from the workflow's own commit, never from the commit it judges. `workflow_run` executes `deploy.yml` as it is on `main`; changes to the pipeline take effect after a release.
- **Targets:** `dev` → environments `supabase-dev` + `cloudflare-dev` (kc-dev `enbqriuxvvuontiwslun`, Pages branch `dev`), automatic. `main` → **`production`** (approval only) then `supabase-prod` + `cloudflare-prod` (`kdqtbdbzwvlugkhonexg`, Pages production branch `main`).
- **Order:** resolve → preflight (`scripts/deploy-preflight.mjs`: secrets present, project refs pinned per target, project `ACTIVE_HEALTHY`; on prod also the backup key and the Pages production branch) → **approve** (prod) → database (`deploy-db.yml`: prod backup, dry-run, apply) → Edge Functions (`deploy-functions.yml`) → web baseline (prod) → web (`deploy-web.yml`) → smoke (`deploy-smoke.yml`) → tag (prod, `deploy-tag.yml`). On prod a failed functions/web/smoke stage runs `deploy-rollback.yml`.
- **Concurrency:** one deploy per environment (`deploy-dev`, `deploy-main`); a running deploy is never cancelled.
- **Environment layout:** `production` carries only the owner as required reviewer and no secrets; exactly one job (`approve release`) uses it, so a release is one click, and that job fails if the run has no recorded approval (reviewer missing). The secret-holding environments have **no** reviewers. Restrict `production`, `supabase-prod` and `cloudflare-prod` to the `main` branch; `supabase-dev` / `cloudflare-dev` to `dev` and `main` (`workflow_run` jobs run on `main`).
- **Runtime guard:** every stage job that changes an environment (backup, migrations, functions, web, tag, web rollback) starts by checking out `github.workflow_sha` (the running `deploy.yml`'s own commit) and running `scripts/deploy-guard.mjs` from it via `.github/actions/deploy-guard`. It fails unless `github.workflow_ref` is this repository's `deploy.yml` (inside a called workflow the `github` context is the caller's), and for prod unless that is `deploy.yml@refs/heads/main`, the run has an approval for `production` recorded **in this run attempt**, and the release is still the `main` tip with no newer `v*` tag. A **Re-run failed jobs** attempt therefore fails on prod; use **Re-run all jobs** (fresh approval).
- **Static guard:** `scripts/check-deploy-isolation.mjs` (static lane of CI, real YAML parser) fails if any other workflow calls a `deploy*` workflow, names a prod environment, uses a templated environment, or runs `supabase db push` / `migration up` / `functions deploy` / `secrets set` or a Pages deploy (also in composite actions); if a stage gains its own trigger; or if a guarded stage job does not start with the deploy guard.

| Stage | Workflow | Detail |
| --- | --- | --- |
| Preflight | `deploy-preflight.yml` | Read-only, one job per environment: `scripts/deploy-preflight.mjs`, plus the Pages production branch on prod. |
| Database | `deploy-db.yml` (**DB deploy**) | Prod: encrypted `supabase db dump` (roles, schema, data — no Storage objects; `age` to `BACKUP_AGE_RECIPIENT`, 14-day artifact) when `supabase/migrations` changed since the last `v*` tag; then counts pending migrations (output `applied_migrations`), `db push --dry-run` and `db push` **without** `--include-all`, so a remote-ahead ledger or an out-of-order migration fails. Dev keeps `--include-all`. No manual trigger: dispatch **Deploy** on `dev`. |
| Edge Functions | `deploy-functions.yml` | Syncs `PUBLIC_RESEARCH_ALLOWED_ORIGINS` (through `env:`), deploys every function `scripts/edge-functions.mjs` lists — all of `supabase/functions` except `_shared` and local-only `mock-login` — on both dev and prod, then requires each to be `ACTIVE`. |
| Web | `deploy-web.yml` | Builds the export with `EXPO_PUBLIC_GIT_COMMIT_SHA` = the deployed SHA (stamped into `/version.json`) and uploads it with `wrangler pages deploy --branch=<dev|main> --commit-hash=<sha>`. |
| Smoke | `deploy-smoke.yml` | `scripts/smoke-deploy.mjs` (15 s timeout per request): `/version.json` serves the SHA (backoff up to 10 min), `/` + every referenced JS bundle return 200, `/auth/v1/health` with the anon key, and every function with a probe in `SMOKE_PROBES` answers one `OPTIONS` (anon key + web origin) with exactly its documented status — the gateway passes `OPTIONS` to the handler unverified, and each probe hits a check that runs before any work. A function without a probe (`null`) is covered by the `ACTIVE` check only. Manual dispatch (read-only) against dev or prod from `dev`/`main`. |
| Tag | `deploy-tag.yml` | Annotated `v<app/VERSION>` on the deployed commit + GitHub Release (generated notes). The same version on another commit fails (checked again up front in **resolve**). |
| Rollback | `deploy-rollback.yml` | Only when the release applied **no** migrations: Cloudflare Pages production → the deployment recorded by **web baseline** in the same attempt; Edge Functions → previous release tag; smoke re-run; report. Otherwise the report demands a forward-fix. DB is forward-fix only. |

The Supabase CLI version is pinned once, in `.github/actions/setup-supabase-cli`.

**Migration safety guards:**

- **Every PR and push:** the static lane of **CI** runs `scripts/check-migration-safety.mjs` over all migrations (blocks `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, unqualified `DELETE FROM` unless the line carries `migration-safety: allow`).
- **Release into `main`:** the release lane runs it with `--release` over the migrations the release adds or changes: a marked destructive line, or any `RENAME` / `ALTER COLUMN … TYPE` / `SET NOT NULL` / `DROP FUNCTION` / `DROP POLICY` / `ALTER POLICY` / `DISABLE ROW LEVEL SECURITY`, also needs `Migration safety: <file>.sql — <reason>` in the PR body (expand/contract — `RELEASE_CHECKLIST.md`).

## Dev merge gates (branch protection)

All feature PRs target `dev`. **Live today:** `dev` has the ruleset `dev protection (merge queue)` (next section) and `main` still has classic branch protection with eight legacy required checks; both move to the committed ruleset in `INFRA-CI-OWNER`. **Target:** `dev` and `main` are protected by one repository ruleset, committed as [`.github/rulesets/dev-main.json`](../../.github/rulesets/dev-main.json) (import steps: [`OPERATOR_RUNBOOK.md` § Owner setup for D-195 CI/CD](./OPERATOR_RUNBOOK.md#owner-setup-ci)):

- Require a pull request before merging, **0 approvals**, **require review from Code Owners**, dismiss stale approvals on push, require approval of the most recent push. [`.github/CODEOWNERS`](../../.github/CODEOWNERS) owns only the gate-critical paths (`.github/**`, CI / guard / deploy scripts, coverage / lint / TypeScript / Turbo configs, process rules, `supabase/config.toml`, `eas.json`), so only a PR touching one of them waits for the owner; app code, migrations and new tests merge on a green gate alone (`INFRA-CI-2`).
- Block force-push and branch deletion; **no bypass actors** (admins included).
- Require status checks: `CI gate` (`D-195`, source GitHub Actions, `integration_id` 15368) **and `CI verdict`** (source: the dedicated CI-verdict GitHub App). Pinning `CI gate` to GitHub Actions only stops commit statuses posted with a token; it does **not** stop impersonation, because a check run attaches to a commit and any workflow on any branch is also "GitHub Actions" — e.g. a PR from the same commit into an unprotected branch whose own `ci.yml` has a `CI gate` job that exits 0. `CI verdict` closes that: `.github/workflows/ci-verdict.yml` runs from the default branch (`main`) on `workflow_run` of **CI**, re-verifies the finished run (`scripts/ci-verdict.mjs` + `scripts/ci-run-binding.mjs`: the file is `.github/workflows/ci.yml` of this repository; a PR or review run must record only this repository's workflows at one `refs/pull/N/merge` commit; PR #N must target `dev`/`main` and have the run's head branch and head SHA; no PR from that branch with that SHA, open or closed, may target any other base (a remote-form call to another PR's merge ref is recorded like a local one, so the references alone prove nothing); the merge's second parent is the head SHA and its first parent is already in the base branch tip, resolved through the branches API, with no gate file changed since; the run is the newest PR-event CI run for that SHA, so an older run or a re-run of one never overrides a newer red one; all its jobs come from one attempt — a "Re-run failed jobs" attempt is never certified, use "Re-run all jobs"; merge groups only on `dev`/`main` queues; exactly one `CI gate` job, successful) and posts `CI verdict` on the head SHA. The verdict is per commit SHA like every check; push and dispatch runs get none (deploy.yml checks its push runs itself), so a `dev` push run, which has no release lane, never certifies the head of a `dev` → `main` release PR — that head is the `dev` tip, no PR into `dev` can carry it (it would have no commits), and the release lane of its own run requires head `dev`. A tag ruleset ([`.github/rulesets/tags-no-branch-names.json`](../../.github/rulesets/tags-no-branch-names.json)) forbids tags named `dev` or `main`, so no ref can pose as those branches with an App token whose credentials live in the `ci-verdict` environment (deployment branch: `main` only). Any mismatch, failure, cancellation or API error posts a red verdict. Do not require the lane jobs: they skip on unrelated PRs, and an extra required context only adds a way to hang "Expected".

**Owner overrides inside `CI gate`.** Two judges fail the gate on a change that could weaken it, unless an owner listed in the base commit's `.github/owners.json` approved the PR's current head SHA (and is not its author): the **test-integrity guard** (`scripts/check-test-integrity.mjs`, static lane — deleted, renamed or moved tests; skip / focus / todo / conditional markers, aliases and options, `@ts-nocheck` or a bare `return` in tests; a no-tests switch; a lower coverage threshold; a higher or dropped `--max-warnings`; net-removed assertions, comments stripped) and the **ci.yml comparison** in the gate (`scripts/ci-workflow-diff.mjs` — any job or header change against the base `ci.yml`, `TD-203`). Both run from the base commit's `scripts/` only — never the PR's copy; a base without a judge fails. Merge groups cannot carry an override. PR and review runs into any base other than `dev`/`main` fail. Submitting or dismissing a review re-runs **CI** (`pull_request_review`, its own per-PR concurrency group, so it never replaces a pending `pull_request` run; a newer review cancels the one in flight): that run executes only `detect changes`, `static` and the gate, and takes every other lane's result from the PR's latest `pull_request` run for the same head SHA — after waiting up to 12 minutes for it to finish — only if that run is bound to the same PR and base like the verdict does; otherwise the gate fails closed.

> The table below is machine-validated: `scripts/check-required-checks-drift.mjs` (static-guards lane of **CI**) fails CI if any row references a workflow/job name that no longer exists, if the `CI gate` row is missing, or if a job in `ci.yml` is not in the gate's `needs:`. If you rename the gate, update this table **and** the GitHub branch-protection required-checks list in the same change.

| Check | Workflow | Job |
| --- | --- | --- |
| Single PR gate | CI | `CI gate` |

**Required checks, live state (read back 2026-10-31):** `dev` requires only `CI gate` (ruleset, done). `main` still uses classic branch protection with eight legacy contexts that no workflow reports any more — `typecheck · test · lint`, `Hebrew source scan (no inline UI copy)`, `web export (production bundle)`, `migration chain lint`, `apply migrations · rls · types · sql probes`, `rpc · table contract`, `PR hygiene`, `SonarCloud quality gate` — plus "require branches to be up to date". **Owner action:** replace them with the single check `CI gate` (source: GitHub Actions) before the next release; until then a `dev` → `main` PR waits on contexts that never report (`INFRA-CI-OWNER`). Add `CI verdict` once it is enabled.

`main` requires the same single check: the release lane runs inside `CI gate` for PRs into `main` (see [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md#merge-gates-automated--must-be-green)). Never require deploy jobs on a PR rule; they run after the merge. A `dev` → `main` release PR that carries changes to code-owned paths also needs the owner's code-owner approval.

### Merge queue (enabled on `dev`)

`dev` is protected by the ruleset `dev protection (merge queue)` (not classic branch protection, which cannot host a queue). It requires a PR, the single check `CI gate`, and the merge queue (squash, all-green grouping, up to 5 entries built and merged together). "Require branches to be up to date" is **off**: `ci.yml` runs on `merge_group`, so the queue tests each PR on top of the ones ahead of it. Repository admins can bypass the ruleset (this keeps `bump-version-on-merge.yml` able to push the version bump). Owner overrides inside `CI gate` (approval on the head SHA) do not apply to merge-group runs. The stricter `.github/rulesets/dev-main.json` (code-owner review, `CI verdict`, no bypass) is still to be merged into this live ruleset by the owner (`INFRA-CI-OWNER`).

Why: without a queue every merge made all other PRs "behind", and re-merging `dev` into each restarted and cancelled their CI. `gh pr merge --auto` adds the PR to the queue by itself.

## Agent identity (`INFRA-CI-6`)

Agents must not act as the owner. Two identities replace the owner's personal account (setup: [`OPERATOR_RUNBOOK.md` § Owner setup for D-195 CI/CD](./OPERATOR_RUNBOOK.md#owner-setup-ci)):

| Identity | Used for | Permissions |
| --- | --- | --- |
| **Agent GitHub App** (secrets `AGENT_APP_ID`, `AGENT_APP_PRIVATE_KEY` in environment `agent-merge`, deployment branch `main` only) | `auto-merge-agent-ready.yml` (every non-draft PR into `dev`; a `pull_request_target` workflow, so GitHub runs its `main` copy with `GITHUB_REF` = `main` and checks the environment policy against `main`, `{{TD:pull-request-target-main-only}}`) mints a short-lived installation token (`actions/create-github-app-token`, scoped to this repository, contents + pull requests write) to arm squash auto-merge (the PR then enters the merge queue), so the merge push to `dev` triggers **CI** → **Deploy** and `close-issues-on-dev-merge` (`TD-197`). | App: Contents R/W, Pull requests R/W, Actions R, Checks R, Metadata R. **No** Administration, no Workflows. Installed on this repository only. |
| **CI-verdict GitHub App** (secrets `CI_VERDICT_APP_ID`, `CI_VERDICT_APP_PRIVATE_KEY` in environment `ci-verdict`, deployment branch `main` only) | `ci-verdict.yml` posts the required `CI verdict` check. A separate App, so the ruleset can require checks from it alone. | App: Checks R/W, Actions R, Contents R, Pull requests R, Metadata R. Installed on this repository only. |
| **Agent machine user** (dedicated GitHub account) | Claude Code / agent sessions: branches, commits, pushes, PRs. | Repository role **Write**, never Admin, so it cannot change rulesets or bypass them, and the owner can approve its PRs (an author cannot approve their own PR). |

`AGENT_MERGE_TOKEN` (fine-grained PAT of the machine user, contents + pull requests write on this repository, also in `agent-merge`) remains a fallback when the App is not configured. The workflow never falls back to `GITHUB_TOKEN`: its pushes start no workflows, so they fail with an explicit error instead. Secrets kept at repository level are readable by any workflow an agent pushes on any branch (`TD-223`); keep sensitive ones in branch-restricted environments.

## Production release

Operator checklist: [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md).

**CI layout (unified gate, 2026-10-30 — `D-195`):** one workflow, `.github/workflows/ci.yml` (**CI**), runs on every PR into `dev`/`main` (`opened`, `synchronize`, `reopened`, `ready_for_review`, `edited`), on submitted or dismissed PR reviews (static lane + gate only, see "Owner overrides"), on merge-queue groups, on pushes to `dev`/`main` and on manual dispatch. Its `detect changes` job runs `scripts/ci-changes.mjs`, which maps a PR's diff to lanes (conservatively: `.github/**` and `.nvmrc` turn on every lane, and a path no lane claims that is not docs-only turns on every lane). Merge-queue groups, pushes to `dev`/`main` and manual dispatches run every lane, so nothing lands on `dev` without the full gate and a green push run certifies the whole tree at that SHA — a docs-only push after a red or never-run push cannot come out green (`D-195` addendum "PR = fast feedback, merge queue = full gate"). A PR into `dev` also plans the heavy `bundles` lane (web export + budget + smoke, iOS + Android bundles) as not needed, leaving it to the merge queue; the gate accepts that only on PRs into `dev`. Until `ci.yml` wires a `bundles` job, the planner leaves the lane out and those builds still run inside `frontend`. The lanes are reusable workflows; the `CI gate` job needs all of them, and `CI verdict` (posted by `ci-verdict.yml` after each run) certifies it. PR runs use `concurrency` with `cancel-in-progress`; `dev`/`main` pushes keep every run. Shared setup: `.github/actions/setup-pnpm-turbo` (pnpm store cache + local Turbo cache under `app/.turbo`).

| Lane (job in `ci.yml`) | Workflow file | Runs when | What it checks |
| --- | --- | --- | --- |
| `hygiene` | `ci-pr.yml` | every PR | Conventional Commits title + `Mapped to spec` line in the body |
| `static` | `ci-static-guards.yml` | every non-draft change, and review events | test integrity (base-commit copy, owner override); actionlint + shellcheck, all `scripts/*.test.mjs` + `app/scripts/*.test.mjs`, architecture, SSOT links, Hebrew scan, RPC contract, web manifest, expo-router fallbacks, migration chain, migration destructive-op scan, FlatList / SQL `OFFSET` guards, required-check docs + gate wiring, deploy isolation |
| `release` | `ci-release.yml` | every PR / merge group into `main` | head is this repository's `dev`; strict migration scan (`--release`); `app/VERSION` above the latest `v*` tag; P0 Playwright on `DEV_WEB_URL` once its `/version.json` serves the PR head SHA |
| `frontend` | `ci-frontend.yml` (+ `ci-sonar.yml`) | `app/**`, `scripts/**`, `Dockerfile`, Sonar config, CI plumbing | typecheck, unit tests with coverage, ESLint (`--max-warnings` ratchet), dependency audit; production web export + bundle budget + headless smoke; iOS + Android Metro/Hermes bundles; SonarCloud quality gate on the same coverage |
| `backend` | `ci-backend.yml` | `supabase/**` except functions, `infrastructure-supabase`, workspace manifests, `scripts/**`, CI plumbing | fresh local stack, all `supabase/tests/*.sql`, `database.types.ts` drift, sqlProbes |
| `edge` | `ci-edge-functions.yml` | `supabase/**`, CI plumbing | `deno check`, `deno lint`, every `*.test.ts` under `supabase/functions` |

The gate fails closed: every lane must be explicitly planned as needed or not needed, and a needed lane must succeed. A draft PR fails `CI gate` on purpose (nothing ran); `ready_for_review` re-runs the whole workflow. A manual dispatch only produces a passing gate on `dev` or `main`. On PRs, `scripts/ci-changes.mjs`, `scripts/ci-gate.mjs` (with every module it imports) and `scripts/check-test-integrity.mjs` run from the base branch's copy, so a PR cannot weaken its own judge; a PR that edits `ci.yml` itself needs an owner approval (see "Owner overrides" above). A docs-only PR runs only `hygiene` + `static` (about a minute); a full-stack PR is bounded by the slowest lane (web export + smoke or the DB stack; expected 6–8 minutes).

**Store pipelines (nightly, `D-195` tier 2):** `.github/workflows/mobile-nightly.yml` (**Mobile nightly**, 23:43 UTC + manual dispatch on `dev` with a `force` input) ships the newest `dev` commit whose `CI` push run succeeded — that exact SHA, never the tip — to TestFlight (`testflight-ios.yml`) and Play internal (`play-internal.yml`). Flow: `resolve` (`scripts/mobile-nightly-resolve.mjs`; fails when none of the last 30 `dev` commits is green; builds nothing when the commit already carries a `mobile/v*` tag) → `e2e` (P0 journeys of `e2e-nightly-dev.yml` against the dev deployment) → `ios` ∥ `android` → `record` (tags the commit `mobile/v<VERSION>-ios<buildNumber>-android<versionCode>`, with retries). The schedule runs main's copy of the file, so it starts after the next release. Both store workflows keep `workflow_dispatch`, accepted only on `dev` and only for a commit with a green `CI` push run. Preflights fail closed: a missing secret fails the job with the list of names. App Store review and Play promotion beyond `internal` stay manual. Tooling: eas-cli `24.12.1` in all three mobile workflows (`EAS_CLI_VERSION`), Node from `.nvmrc`. Marketing version = `app/VERSION` (via `app.config.ts`); iOS `buildNumber` / Android `versionCode` = EAS remote `autoIncrement`.

**Mobile store backend: kc-dev.** Tester builds (TestFlight, Play internal) use the dev project `enbqriuxvvuontiwslun` (owner decision, `D-195`). They build with the eas.json `nightly` profile — store distribution, OTA channel `preview`, EAS environment `preview`, `EXPO_PUBLIC_ENVIRONMENT=development` (dev banner on), same bundle id `org.karmacommunity.app`. `scripts/mobile-store-config.mjs pin` writes the kc-dev URL and the key below into that profile's `env` on the runner and refuses a commit whose green run is on `main` (prod store builds are not wired yet); `scripts/mobile-store-config.mjs verify` then checks the built JS bundle (from the IPA / AAB) and blocks the store upload unless it contains the kc-dev URL and no prod ref.

| GitHub (`mobile-store` environment, deployment branches `dev` + `main`) | Name | Value |
| --- | --- | --- |
| Secret | `MOBILE_SUPABASE_ANON_KEY` | kc-dev publishable (anon) key; a key of another project or a service-role key fails the job |

| EAS environment `preview` (used by the `nightly` profile) | Needs |
| --- | --- |
| Sentry / FCM | `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_URL`, `SENTRY_AUTH_TOKEN` (optional) and the `GOOGLE_SERVICES_JSON` file variable — Android cloud builds take these only from EAS |
| Supabase | Either no `EXPO_PUBLIC_SUPABASE_*`, or the kc-dev values; a prod value can reach the cloud build and is then caught by `verify` |

Store credentials stay repository-level for now (`TD-227`): secrets `EXPO_TOKEN`, `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, `ASC_API_KEY_P8`, `KC_IOS_TEAM_ID`, `KC_IOS_DIST_P12_B64`, `KC_IOS_DIST_P12_PASSWORD`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`; variables `KC_ASC_APP_ID`, `KC_EAS_PROJECT_ID`, `KC_IOS_DIST_CERT_ID`. The preview workflow (`kc-mobile-eas-preview.yml`, manual) builds on EAS cloud and takes its config from the eas.json `preview` profile + EAS `preview` environment.

Tooling pins: Node version comes from the repo-root `.nvmrc` (all `setup-node` steps use `node-version-file`); pnpm version comes from the `packageManager` field in `app/package.json` (all `pnpm/action-setup` steps use `package_json_file`). Bump either in one place only. **One deliberate exception:** the `ci-backend.yml` db-validate job pins Node 22 — `@supabase/realtime-js` needs the native WebSocket global (Node ≥ 22) for the sqlProbes integration tests; do not align it back to `.nvmrc`.

Branch protection on `dev` uses the table above; `main` release PRs use [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md#merge-gates-automated--must-be-green).

**CI gates on `main` PRs:** the same `CI gate`, plus the `release` lane it plans for every PR into `main`.

**Post-deploy smoke:** the smoke stage of **Deploy** (see "Deploy pipeline" above) checks the environment it just deployed.

| GitHub | Name | Value / purpose |
| --- | --- | --- |
| Variable | `KC_PROD_URL` | KC live root — `https://karma-community-kc.com` (prod preflight, smoke, `production` environment URL) |
| Variable | `DEV_WEB_URL` | `https://dev.karma-community.pages.dev` (dev preflight + smoke, release-lane E2E) |
| Variable (`supabase-prod`) | `BACKUP_AGE_RECIPIENT` | `age1…` public key the pre-migration prod backup is encrypted to; the owner keeps the private key offline |

The legacy `PROD_WEB_URL` alias is no longer read; delete it.

**Manual follow-up:** Remove obsolete repo variables `GLOWE_PROD_URL`, `GLOWE_STAGING_URL`, and `GLOWE_SEED_PASSWORD` from GitHub Actions if still present.

## E2E automation (Web, `D-55`)

Playwright P0 journeys run against the live dev deployment before every `dev` → `main` release PR. Policy: [`TESTING.md`](./TESTING.md).

| GitHub | Name | Value / purpose |
| --- | --- | --- |
| Variable | `DEV_WEB_URL` | `https://dev.karma-community.pages.dev` |

The suites sign in as the public kc-dev seed users and read the publishable anon key from the deployed bundle ([`tests/e2e/README.md`](../../tests/e2e/README.md)), so no workflow reads an E2E secret. The legacy secrets `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` and `E2E_SUPABASE_ANON_KEY_DEV` are unused by CI; they remain only for the manual `scripts/ensure-e2e-user.mjs` preflight.

Release gate: the `dev E2E on the release head` job of the release lane (`.github/workflows/ci-release.yml`, inside `CI gate`) — it first waits until `DEV_WEB_URL/version.json` reports the release PR's head SHA, so E2E never runs against an older dev build. The full suite also runs nightly (`.github/workflows/e2e-nightly-dev.yml`).

Local run (after deploy on dev):

```bash
cd tests/e2e && npm ci && npm run install:browsers && npm test   # DEV_WEB_URL defaults to the dev site
```
