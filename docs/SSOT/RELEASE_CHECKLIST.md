# Production release checklist (`dev` → `main`)

> **Scope:** KC web on Cloudflare Pages (project `karma-community`, production branch `main`, `https://karma-community-kc.com`) + Supabase prod (`kdqtbdbzwvlugkhonexg`) + Edge Functions.
> **Branch topology:** [`ENVIRONMENTS.md`](./ENVIRONMENTS.md) · **DB/Functions runbook:** [`OPERATOR_RUNBOOK.md`](./OPERATOR_RUNBOOK.md) · **Policy:** `D-195` (gated prod release).

A release is a PR from `dev` into `main`. CI judges it (`CI gate`, including the release lane); after the squash merge, `.github/workflows/deploy.yml` deploys `main` and waits for **one owner approval click** before touching production. Agents prepare the release; only the owner approves it. Under the `dev`/`main` ruleset (`.github/rulesets/dev-main.json`), a release PR that carries changes to code-owned gate files also needs the owner's code-owner review before it can merge.

---

## Before opening the release PR

- [ ] **`dev` is deployed** — the latest `dev` push passed **CI** and the **Deploy** run for that commit is green (dev web serves it at `https://dev.karma-community.pages.dev/version.json`).
- [ ] **`app/VERSION` is above the latest `v*` tag** — the release lane checks it; bump PATCH/MINOR/MAJOR on `dev` first if needed.
- [ ] **Migration review (expand/contract)** — read each new migration since the last tag. The previous release's web and Edge Functions keep running against the new schema until the deploy finishes, so every migration must be **backward compatible**: *expand* first (add tables, nullable columns, new functions/policies alongside the old), switch the code in that or a later release, and *contract* (drop, rename, retype, `SET NOT NULL`, remove a policy) only in a later release once no deployed code uses the old shape. The release lane enforces it: a destructive line needs the `migration-safety: allow` marker **and** a line `Migration safety: <file>.sql — <reason>` in the release PR body; a `RENAME`, `ALTER COLUMN … TYPE`, `SET NOT NULL`, `DROP FUNCTION`, `DROP POLICY`, `ALTER POLICY` or `DISABLE ROW LEVEL SECURITY` needs that body line too (say why the previous code still works).
- [ ] **Release PR** — **`dev` → `main`**, Conventional Commits title, body with **Mapped to spec** and migration/rollout notes.

---

## Merge gates (automated — must be green)

Required on the release PR (GitHub branch protection on `main`; the live rule still lists legacy contexts until the owner switches it, see *GitHub settings* below):

> Machine-validated by `scripts/check-required-checks-drift.mjs` (static-guards lane of **CI**): the table below must reference real workflow/job names and must include `CI gate`. Rename a job → update this table and the branch-protection list together.

| Check | Workflow | Job |
| --- | --- | --- |
| PR gate | CI | `CI gate` |

`CI gate` (`D-195`) aggregates every lane. A PR into `main` has no merge queue after it, so it runs every lane its diff needs, heavy ones included: the `bundles` lane (web export + bundle budget + smoke, iOS + Android bundles) whenever `frontend` runs, and the SonarCloud quality gate (80% coverage on new code, blocking) inside `frontend`. The release PR is where Sonar judges everything merged into `dev` since the last release (`TD-236`); fix new-code findings on a follow-up PR into `dev`. For a PR into `main` the change detector also plans the **release** lane (`.github/workflows/ci-release.yml`), whatever the diff touches, and the gate fails if it did not succeed:

| Release-lane job | Fails when |
| --- | --- |
| `release source is dev` | the head is not this repository's `dev` branch (a fork's `dev` fails; a merge group always fails: releases go through a PR) |
| `release migration scan (strict)` | a migration added or changed by the release has a destructive line without the marker, or a destructive or compatibility-breaking line (see *Migration review*) without a `Migration safety:` justification line for its file in the PR body |
| `release version bump` | `app/VERSION` on the release head is not greater than the latest `v*` tag |
| `dev E2E on the release head` | dev does not serve the release head SHA (`/version.json`) within 30 minutes, or a P0 Playwright journey fails |

---

## After the squash merge — the deploy

The `main` push runs **CI**; when it succeeds, **Deploy** (`deploy.yml`) starts for exactly that commit:

1. **resolve target** — runs from the workflow's own commit and confirms the commit is the `main` tip, that a push-event CI run of this repository gave it a green `CI gate`, that it is the merge commit of a merged `dev` → `main` PR of this repository, that `app/VERSION` is above the latest `v*` tag and that `v<app/VERSION>` does not already exist on another commit.
2. **preflight · supabase / preflight · web** — every secret present, project refs pinned (`kdqtbdbzwvlugkhonexg`), Supabase project `ACTIVE_HEALTHY`, Pages production branch is `main`, `BACKUP_AGE_RECIPIENT` set. Fails before anything changes.
3. **approve release** — the run waits on the `production` environment. **Owner: review the run summary (version, SHA) and approve.** This is the only click. The job fails if the environment let the run through without a recorded approval. Every later stage that changes prod starts with the **deploy guard**: it fails unless `deploy.yml` on `main` is the caller, the approval is from this run attempt, and the commit is still the `main` tip with no newer release tag. If a stage fails, use **Re-run all jobs** (new approval), never **Re-run failed jobs**.
4. **database** — encrypted backup of roles, schema and data (only when `supabase/migrations` changed since the last tag; Storage objects are not included) → count of pending migrations → `db push --dry-run` → `db push`. No `--include-all`: a remote that is ahead or an out-of-order migration fails here.
5. **edge functions** — CORS variable synced, every function deployed, then each one checked `ACTIVE` on the project.
6. **web baseline → web** — the Cloudflare deployment serving prod is recorded, then the new build (stamped with the SHA) is uploaded.
7. **smoke** — `/version.json` reports the SHA, page + JS bundle load, Supabase Auth health, and each function with a side-effect-free probe answers one `OPTIONS` with exactly the status its handler's first check returns (`scripts/edge-functions.mjs`).
8. **tag release** — annotated `vX.Y.Z` on the commit + a GitHub Release with generated notes.

**Sync main → dev** runs after the merge and opens a zero-diff PR into `dev`. The owner merges it as a **merge commit** with the admin bypass (the `dev` merge queue only squashes, `TD-182`); otherwise the next release PR conflicts.

### Spot-check after a green deploy (~5 min, optional)

- [ ] Prod URL loads in an incognito window, no dev banner.
- [ ] Sign-in works; one write path (edit profile or create a draft post).
- [ ] If migrations merged — exercise the feature they enable; run any SQL checks OPERATOR_RUNBOOK lists for them.

---

## Rollback

| Layer | What happens |
| --- | --- |
| **Release applied migrations** | **No automatic code rollback** — the previous web and functions may not work against the new schema. The run fails with *FORWARD-FIX REQUIRED*: fix on `dev`, bump `app/VERSION`, release again. |
| **Web (Cloudflare Pages)** | Automatic when the functions, web or smoke stage fails after approval and the release applied no migrations: production is pointed back at the deployment recorded in **web baseline** (Cloudflare Pages rollback API), then the smoke re-runs. By hand: Cloudflare dashboard → Pages → `karma-community` → Deployments → previous production deployment → *Rollback*. |
| **Edge Functions** | Automatic in the same case (no migrations applied): the previous release tag's functions are redeployed. With no earlier tag the rollback report says so and functions stay on the failed release. |
| **DB** | **Never rolled back.** Forward-fix with a new migration. The deploy run holds an encrypted `prod-db-backup-<sha>-<attempt>` artifact (roles, schema, data; no Storage objects; 14 days) for a manual restore — OPERATOR_RUNBOOK § "Restore a pre-migration backup". |
| **Git** | Do **not** force-push `main`. Forward-fix on `dev`, bump `app/VERSION`, release again. |

A failed release is never tagged, so the next release's notes and rollback target stay correct.

---

## Dev branch protection (`dev` — working branch)

Feature PRs merge into `dev` first, through the merge queue of the ruleset `dev protection (merge queue)`: PR required, force-push and deletion blocked, single required check `CI gate` (done; see [`ENVIRONMENTS.md` § Dev merge gates](./ENVIRONMENTS.md#dev-merge-gates-branch-protection)).

---

## GitHub settings (one-time, owner)

| Setting | Location | Value |
| --- | --- | --- |
| Branch protection on `main` | Settings → Branches → `main` | PR required; block force-push/deletion; required status checks: **only** `CI gate`. **Still open:** classic protection on `main` requires eight legacy contexts that no workflow reports (`typecheck · test · lint`, `Hebrew source scan (no inline UI copy)`, `web export (production bundle)`, `migration chain lint`, `apply migrations · rls · types · sql probes`, `rpc · table contract`, `PR hygiene`, `SonarCloud quality gate`); replace them with `CI gate`, or the release PR never merges |
| `production` environment | Settings → Environments → `production` | **Required reviewer: the owner.** Deployment branches: `main` only. No secrets. |
| `supabase-prod`, `cloudflare-prod` | Settings → Environments | **No** required reviewers (each would add a click). Deployment branches: `main` only. |
| `supabase-dev`, `cloudflare-dev` | Settings → Environments | No reviewers. Deployment branches: `dev` and `main` (`workflow_run` deploys run on `main`). |
| Backup key | `supabase-prod` → Variables | `BACKUP_AGE_RECIPIENT` = an `age1…` public key; the owner keeps the private key offline |
| Web URLs | Repository → Variables | `KC_PROD_URL` = `https://karma-community-kc.com`; `DEV_WEB_URL` = `https://dev.karma-community.pages.dev` |

---

## Quick reference — prod targets

| Concern | Value |
| --- | --- |
| Git branch | `main` |
| Supabase project | `kdqtbdbzwvlugkhonexg` (`supabase-prod`) |
| Web | Cloudflare Pages `karma-community`, branch `main` (`cloudflare-prod`) |
| `EXPO_PUBLIC_ENVIRONMENT` | `production` |
| Release tag | `v<app/VERSION>` on the deployed commit |

---

# Mobile app store submission (iOS App Store + Google Play)

> **Scope:** the Expo / EAS mobile app at `app/apps/mobile` (bundle id / package `org.karmacommunity.app`; marketing version from `app/VERSION` via `app.config.ts`; iOS build number / Android versionCode from EAS remote `autoIncrement`).
> This is separate from the web release flow above.
> **Internal tracks are automatic (`D-195` tier 2):** **Mobile nightly** (`.github/workflows/mobile-nightly.yml`) ships the newest green `dev` commit to TestFlight and Play internal every night, built against the kc-dev backend (eas.json `nightly` profile) — see [`ENVIRONMENTS.md`](./ENVIRONMENTS.md) § Production release. Production store builds (prod backend, App Store review, Play promotion beyond `internal`) are not automated and stay PM-gated.

## A. One-time account + project setup (needs owner credentials — cannot be automated)

1. **EAS project.** Done: `extra.eas.projectId` is committed in `app.json` (`TD-121`, closed); CI also injects it from the `KC_EAS_PROJECT_ID` variable.
2. **Apple Developer.** Membership active. In **App Store Connect**, create the app record (name `KC - קהילת קארמה`, bundle `org.karmacommunity.app`) — this yields the numeric **ASC App ID**. Ensure the App ID has the **Sign in with Apple** capability (EAS can manage this during `eas credentials` / build when signed in with your Apple account).
3. **Sign in with Apple → Supabase (required for `FR-AUTH-004`).** In Supabase Auth → Providers → Apple, add the **Services ID**, **Team ID**, **Key ID**, and the **.p8 "Sign in with Apple" key**. Without this the native Apple flow fails at the token exchange. This is the go-live dependency for the Apple SSO that ships in code; the iOS button is otherwise wired and tested.
4. **Google Play.** Play Console account active. Create the app, then a **Google Cloud service account** with Play release permission; store its JSON as the GitHub secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (CI writes it to `app/apps/mobile/google-play-service-account.json`, gitignored, the path `eas.json` references).

## B. Fill the config placeholders (after step A yields the values)

- `app/apps/mobile/eas.json` → `submit.production.ios.ascAppId` stays a placeholder (public repo); `testflight-ios.yml` injects the real id from the `KC_ASC_APP_ID` variable on the runner.
- `app/apps/mobile/public/.well-known/apple-app-site-association`: replace `REPLACE_WITH_APPLE_TEAM_ID`.
- `app/apps/mobile/public/.well-known/assetlinks.json`: replace `REPLACE_WITH_ANDROID_RELEASE_SHA256` with the release signing cert SHA-256 (from `eas credentials` after the first Android build). Closes `TD-66` — until filled, universal/app links open the browser chooser instead of the app.

## C. Store listing content (prepare before submitting)

- **Privacy policy + Terms public URLs.** Both stores require a publicly reachable privacy-policy URL. In-app legal is server-driven (`FR-SETTINGS-010`); also expose a public web copy (e.g. `https://karma-community-kc.com/legal/privacy`).
- **Apple App Privacy labels** + **Google Data Safety form**: declare account email/phone, user-generated content, and Sentry diagnostics.
- **Assets / copy:** screenshots per device class; description, keywords, category (Social), age rating, support email `karmacommunity2.0@gmail.com`. Marketing icons are ready: iOS 1024 is baked from `assets/icon.png`; Google Play 512 listing icon is `assets/play-store-icon-512.png`.

## D. Build

TestFlight and Play internal builds run nightly from CI (above). Manual equivalent, from `app/apps/mobile` (production profile auto-increments build number / versionCode; version string from `app/VERSION`):

```bash
eas build --platform ios     --profile production
eas build --platform android --profile production
```

## E. Submit

```bash
eas submit --platform ios     --profile production --latest
eas submit --platform android --profile production --latest
```

- iOS lands in TestFlight → then submit for App Review.
- Android lands on the `internal` track → test → promote to production.

## F. Pre-submit verification on a real device build

- [ ] Sign in with Apple completes (needs step A.3).
- [ ] A push notification is received (needs step A.1 projectId).
- [ ] Universal / app links open the app directly (needs step B fingerprints).
- [ ] No dev banner, no dev auto-sign-in (production env).

## Go-live blockers checklist

- [x] Real `extra.eas.projectId` committed (`TD-121`, closed).
- [ ] Supabase Apple provider configured (`FR-AUTH-004`; closes the go-live half of `TD-24`).
- [ ] Deep-link fingerprints filled (`TD-66`).
- [ ] Remaining app bugs resolved (PM-tracked) — the first production store submission is gated on this (nightly tester builds are not).
