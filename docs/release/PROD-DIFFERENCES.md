# PROD differences (main vs dev)

> Owner direction (Nave, 15 Nov 2026): **"main should be the same as dev, except for specific differences."**
> This file is the list of those differences. Anything not listed here is drift.
> Values are never written here: only *where* a setting lives and the *class* of its value.
> Last reviewed: 2026-11-15 (release v1.9.109, main `ebf64611` = dev head `37caaa28`, identical trees).

## 1. In git: none

The main tree must equal the dev commit it was released from. `scripts/release-merge.mjs` squashes a dev head into main and records `dev head <sha>` in the commit body; `scripts/check-main-dev-parity.mjs` (workflow **main ↔ dev parity**, on every push to main and on dispatch) compares the main tree with that commit and fails on any path outside [`prod-differences.allowlist.json`](./prod-differences.allowlist.json).

The allowlist is **empty on purpose**. Code that behaves differently in PROD reads a build-time or runtime setting (sections 2–5); the same file ships on both branches. To add a real git difference, add a row below **and** an allowlist entry with a reason (the script's test checks each allowlisted path appears in this file).

Run locally: `node scripts/check-main-dev-parity.mjs --main origin/main` (or `--dev <sha>` to compare with any dev commit).

## 2. GitHub environments (names only)

| Concern | dev side | PROD side | Value class (dev → PROD) |
|---|---|---|---|
| Web build env | `cloudflare-dev` | `cloudflare-prod` | same secret names on both: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_ENVIRONMENT`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| ↳ `EXPO_PUBLIC_SUPABASE_URL` | secret | secret | kc-dev URL (`enbqriuxvvuontiwslun`) → kc-prod URL (`kdqtbdbzwvlugkhonexg`); `deploy-preflight.mjs` refuses any other URL for prod |
| ↳ `EXPO_PUBLIC_SUPABASE_ANON_KEY` | secret | secret | kc-dev publishable key → kc-prod publishable key |
| ↳ `EXPO_PUBLIC_ENVIRONMENT` | secret (read by `deploy-web.yml`) + variable (unused, see §7) | same | `development` → `production`; preflight requires the exact value per target |
| ↳ `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | secret | secret | kc-dev web OAuth client → PROD web OAuth client (GCP project 501) |
| ↳ Cloudflare | secrets | secrets | Pages project / branch differ per target (`deploy-web.yml`) |
| DB / functions env | `supabase-dev` | `supabase-prod` | secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `EDGE_SENTRY_DSN`; variables `BACKUP_AGE_RECIPIENT`, `PUBLIC_RESEARCH_ALLOWED_ORIGINS` |
| ↳ `SUPABASE_PROJECT_REF` | secret | secret | kc-dev ref → kc-prod ref |
| ↳ `KC_PROD_SCHEMA_MODE` | — | variable on `supabase-prod` only | unset → `baseline` (D-228; unset = block prod db push) |
| ↳ `E2E_SEED_PASSWORD` | secret on `supabase-dev` only | — | seeded test users exist on kc-dev only |
| Deploy approval | — | `production` (no secrets; reviewers only) | only `deploy.yml` may use it (`check-deploy-isolation.mjs`) |
| Store builds | `mobile-store` (shared) | `mobile-store` (shared) | `MOBILE_SUPABASE_ANON_KEY` (kc-dev, nightly) vs `MOBILE_SUPABASE_ANON_KEY_PROD` (kc-prod, `backend=prod`); everything else (ASC / Play / iOS signing / `EXPO_TOKEN` / `SENTRY_AUTH_TOKEN` secrets; `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY/HOST`, `SENTRY_*`, `KC_*` variables) is the same for both backends |
| PROD store switch | — | repo variable `KC_PROD_STORE_BUILD_ENABLED` | unset (block) → `"true"` only by the owner; `prod-store-build.yml` never sets it |

Repo-level secrets `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` exist too; jobs in an environment read the environment's value first, and the prod preflight rejects a non-kc-prod URL, so a missing env secret cannot silently ship the repo-level value to PROD web.

## 3. Mobile build profiles (in git, selected at build time)

`app/apps/mobile/eas.json` is identical on both branches; the workflow picks the profile.

| | Tester store builds (from dev) | PROD store builds (from a tagged main SHA) |
|---|---|---|
| Workflow | `mobile-nightly.yml` → `testflight-ios.yml` / `play-internal.yml` (`backend` dev) | `prod-store-build.yml` → same two workflows with `backend: prod` |
| EAS profile | `nightly` | `production` |
| EAS server environment | `preview` | `production` |
| OTA channel | `preview` | `production` |
| `EXPO_PUBLIC_ENVIRONMENT` | `development` (tester worlds, launch surfaces default ON) | `production` |
| `EXPO_PUBLIC_STORE_BUILD` | `true` (no DEV strip; PR #2310) | `true` |
| Supabase | kc-dev URL + `MOBILE_SUPABASE_ANON_KEY`, pinned by `mobile-store-config.mjs pin`, checked by `verify` | kc-prod URL + `MOBILE_SUPABASE_ANON_KEY_PROD`; `verify` also requires the PROD Google web client and rejects the kc-dev one |
| Sentry `environment` | `dev` (derived from `EXPO_PUBLIC_ENVIRONMENT`) | `prod` (traces 0.1) |
| PostHog | same key/host; super property `environment=development` | same key/host; `environment=production` |
| RevenueCat iOS key | same public SDK key in both profiles | same |
| Submit | TestFlight + Play `internal` only | TestFlight + Play `internal` only (store rollout stays manual) |

Internal builds (`development`, `preview` profiles, `kc-mobile-eas-preview.yml`) are not store builds and keep the DEV strip.

### EAS server environments (expo.dev, outside git)

Per `docs/SSOT/ENVIRONMENTS.md`: `preview` and `production` each hold `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, `GOOGLE_SERVICES_JSON` (file) and Sentry variables. Value class: `preview` → kc-dev / dev OAuth clients allowed; `production` → PROD (GCP 501) OAuth clients only. Profile `env` in eas.json wins over the server environment. *Not re-listed in this review (no Expo token on the reviewer's machine); verify with `eas env:list --environment production` before the first PROD store build.*

## 4. Supabase project settings (dashboard / Management API)

| Setting | kc-dev (`enbqriuxvvuontiwslun`) | kc-prod (`kdqtbdbzwvlugkhonexg`) |
|---|---|---|
| Plan / compute | Free, Nano | Free (owner decides upgrades) |
| Auth `site_url` | dev web origin (not re-read in this review) | `https://karma-community-kc.com` |
| Auth redirect allow-list | dev web origins + app scheme (not re-read in this review) | `/auth/callback` and `/auth/verify` on apex and `www`, plus `karmacommunity://**` (set 15 Nov; reset-password URL to be re-added when email flows open) |
| Auth providers (Google / Apple) | dev OAuth clients | PROD OAuth clients (GCP 501) — not re-read in this review |
| Edge Function secrets | `SENTRY_ENVIRONMENT=dev` (+ DSN, release) | `SENTRY_ENVIRONMENT=prod`; synced by `deploy-functions.yml` from `EDGE_SENTRY_DSN` |
| Vault secrets | upserted by `deploy-db.yml` per target | same names, PROD values |
| Schema | migrations applied by Deploy (dev) | `0001_baseline` + approved list (`supabase/baseline/prod-allowed-migrations.txt`) only |
| Seed | reference + content + E2E users (`supabase/seed/e2e`) | reference + content only; no test users |
| Backups | `db-backup-dev.yml` | `db-backup-prod.yml` (+ restore check) |

## 5. Feature flags in the database (`public.app_flags`)

`supabase/seed/reference/data/app_flags.csv` seeds the same `world_*_enabled` rows into both projects, **only when missing**; after that the super admin owns each row per project, so values may legitimately differ.

| Flag | Seeded | Effect when no row |
|---|---|---|
| `world_*_enabled` | yes, same defaults on both | — |
| `launch_email_auth_enabled`, `launch_whatsapp_bot_enabled`, `launch_payments_enabled` | **no** | build default: ON when `EXPO_PUBLIC_ENVIRONMENT=development`, OFF in production (`launchSurfaces.ts`); `EXPO_PUBLIC_LAUNCH_*` overrides |
| Support-KC options (Bit / PayBox, `useKcSupportOptions`) | no (`kc_support_channels` is in `supabase/seed/content/deferred/`) | server config with a compiled fallback in the app, so shown on both (owner decision 15 Nov: ON at launch) |

The current per-project values are read in the admin portal; they are not copied here.

## 6. How to change a difference

1. Change the setting in the place named above (never by committing a value to one branch only).
2. Update this file in a PR into dev; it reaches main with the next release.
3. A real git-level difference also needs an allowlist entry; the parity check enforces it on the next push to main.

## 7. Known drift / cleanup (15 Nov review)

- `cloudflare-dev` and `cloudflare-prod` define `EXPO_PUBLIC_ENVIRONMENT` both as a secret and as a variable; `deploy-web.yml` reads only the secret. The variable is redundant and can mislead an operator.
- `docs/SSOT/ENVIRONMENTS.md` says the store credentials are repository-level (`TD-227`); `ASC_API_KEY_*`, iOS signing and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` now live only in the `mobile-store` environment (repo level keeps `EXPO_TOKEN`).
- The nightly profile sets `EXPO_PUBLIC_ENVIRONMENT=development`, so a nightly binary sent to App Review also has launch surfaces (email sign-in, WhatsApp bot, payments) defaulting ON before sign-in and tester worlds active. For review, submit a `production`-profile build.
