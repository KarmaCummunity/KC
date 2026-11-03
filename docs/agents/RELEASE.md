# KC release runbook

How we version, ship TestFlight / Play internal, promote, and roll back.  
**`main` / kc-prod / public store submission always need Nave's explicit approval.** Agents never push to `main` or run prod deploys.

Related: #949, #840, #841, #866. Version source of truth: [`app/VERSION`](../../app/VERSION).

## Versioning

| Field | Where | Who bumps |
|---|---|---|
| Marketing version (`MAJOR.MINOR.PATCH`) | `app/VERSION` (read by `app.config.ts` → Expo `version`) | [`bump-version-on-merge.yml`](../../.github/workflows/bump-version-on-merge.yml) on every merge to `dev`; a PR sets MINOR/MAJOR by editing the file |
| iOS `buildNumber` / Android `versionCode` | EAS remote (`eas build:version:get`) with `autoIncrement` on production profile | EAS on each store-bound build |

### Patch bump (automatic)

Every merge into `dev` bumps PATCH through `bump-version-on-merge.yml`; PRs do not touch `app/VERSION`. To release a MINOR or MAJOR, edit `app/VERSION` in that PR (a PR that edits the file is not auto-bumped). The bump commit is `[skip ci]`, so a deploy shows the previous number until the next merge.

Manual bump (rare): `node scripts/bump-app-version.mjs` writes `app/VERSION`; `--dry-run` only prints.

### Changelog

PR titles on `dev` since the last tagged/store build are the changelog. For a dry-run notes draft:

```bash
git log --oneline origin/dev --since='2 weeks ago' --grep='' 
# or: gh pr list --base dev --state merged --limit 30
```

## Pipelines (dev → stores)

**Mobile nightly** ([`mobile-nightly.yml`](../../.github/workflows/mobile-nightly.yml), 23:43 UTC) ships the newest green `dev` commit to TestFlight + Play internal after the P0 E2E journeys pass (`D-195`). The store workflows can also be dispatched by hand on `dev`, for a commit with a green `CI` push run. Missing secrets fail the job. Tester builds use the kc-dev backend (eas.json `nightly` profile, key in GitHub Environment `mobile-store`), and a build whose bundle points anywhere else is not uploaded — see [`ENVIRONMENTS.md`](../SSOT/ENVIRONMENTS.md).

| Stage | Workflow | What it does | Secrets (names only) |
|---|---|---|---|
| Preview smoke | [`kc-mobile-eas-preview.yml`](../../.github/workflows/kc-mobile-eas-preview.yml) | EAS `preview` profile build, no store submit | `EXPO_TOKEN` |
| TestFlight | [`testflight-ios.yml`](../../.github/workflows/testflight-ios.yml) | macOS local EAS `production` IPA → TestFlight | `EXPO_TOKEN`, `ASC_*`, `KC_IOS_TEAM_ID`, `KC_IOS_DIST_P12_*`; vars `KC_ASC_APP_ID`, `KC_EAS_PROJECT_ID`, `KC_IOS_DIST_CERT_ID`; env `mobile-store` |
| Play internal | [`play-internal.yml`](../../.github/workflows/play-internal.yml) | EAS cloud AAB → Play **internal** track | `EXPO_TOKEN`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`; var `KC_EAS_PROJECT_ID`; env `mobile-store` |
| DB → functions → web → smoke (kc-dev) | [`deploy.yml`](../../.github/workflows/deploy.yml) after the `dev` push's **CI** run passes | `supabase db push` → kc-dev, Edge Functions, Cloudflare Pages → `dev.karma-community.pages.dev` | envs `supabase-dev`, `cloudflare-dev` |

Optional on store builds: `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_URL`. If `SENTRY_AUTH_TOKEN` is empty, workflows export `SENTRY_DISABLE_AUTO_UPLOAD=true` (and `app.config.ts` does the same) so source-map upload is skipped.

Client observability env (EAS / EAS secrets — never commit values):

- `EXPO_PUBLIC_SENTRY_DSN` — Sentry no-op without it (#946)
- `EXPO_PUBLIC_POSTHOG_KEY` (+ optional `EXPO_PUBLIC_POSTHOG_HOST`) — PostHog no-op without it

## Dry run (EAS preview)

1. Ensure `app/VERSION` is what you intend to ship.
2. GitHub → Actions → **KC mobile — EAS preview build** → Run workflow (platform `all` or one OS).
3. If `EXPO_TOKEN` is missing, the job fails with the missing name.
4. When green, open the Expo build page from the job log; install the internal build on a device / simulator.
5. Smoke: cold start, sign-in, create listing, one donation sandbox path, one handoff reserve.

## Promotion

1. **Internal QA** — TestFlight + Play internal from the workflows above (still on builds from `dev` / production EAS profile).
2. **Public App Store / Play production** — **Nave only.** Submit from App Store Connect / Play Console (or a future dedicated workflow after explicit approval). Do not add `agent-ready` to a prod-submit PR.
3. **Web / DB prod (kc-prod)** — separate from mobile; same rule: Nave approval only.

## Rollback

| Layer | Fast rollback | Heavier |
|---|---|---|
| **JS / Expo Update** | If the bad release used EAS Update on a channel, publish a previous update to that channel (`eas update --branch <channel> --message rollback`). Prefer this when native binary is fine. | New binary (below) |
| **Native binary** | Point TestFlight / Play internal testers at the previous build in the console; pause the bad build. | Re-run store workflow from a known-good `dev` SHA after revert PR |
| **Web (Pages)** | Cloudflare Pages → previous deployment for the project | Revert merge on `dev` (redeploys) |
| **DB (kc-dev)** | Forward-fix migration only — never rewrite applied versions on remote | New migration that undoes the change |

Never `supabase db reset` against shared remotes. Never edit already-applied migration files expecting remotes to re-run them (ledger is append-only; see #962 note).

## Who approves what

| Action | Approver |
|---|---|
| Merge to `dev`, kc-dev DB/web deploy | CI + `agent-ready` auto-merge (coordinator) |
| TestFlight / Play **internal** dispatch | Maintainer with secrets access (agents may prepare; human triggers if policy requires) |
| Public store / `main` / kc-prod | **Nave** |
