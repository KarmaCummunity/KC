# KC mobile (Expo / React Native)

Native KC app (`@kc/mobile`) — resumed for App Store / Google Play (issues #836, #837).
Uses the shared Supabase backend in `supabase/` (same project as the KC web export).

If `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are missing at runtime, the app shows a configuration error screen instead of crashing on launch (#857).

## Prerequisites

- Node.js per repo [`.nvmrc`](../../../.nvmrc)
- [pnpm](https://pnpm.io/) from `app/package.json`
- Local Supabase: `./scripts/dev-up.sh` from repo root (see [CONTRIBUTING.md](../../../CONTRIBUTING.md))
- For device builds: [EAS CLI](https://docs.expo.dev/build/setup/) and an Expo account

## Install & run (local)

```bash
cd app
pnpm install
cp .env.example .env.local   # fill EXPO_PUBLIC_SUPABASE_* from dev-up output
pnpm --filter @kc/mobile start:go    # Expo Go (limited — dev client recommended)
pnpm --filter @kc/mobile start       # dev client
pnpm --filter @kc/mobile ios         # local iOS simulator (macOS + Xcode)
pnpm --filter @kc/mobile android     # local Android emulator
```

Typecheck (also runs in CI):

```bash
pnpm --filter @kc/mobile typecheck
```

## Native identifiers (proposal)

| Platform | Id |
| -------- | --- |
| iOS `bundleIdentifier` | `org.karmacommunity.app` |
| Android `package` | `org.karmacommunity.app` |
| Expo slug | `karma-community` |
| URL scheme | `karmacommunity` |

Marketing version comes from [`app/VERSION`](../../VERSION) via `app.config.ts`.
EAS **production** profile sets `autoIncrement: true` for native build numbers.

## EAS profiles (`eas.json`)

| Profile | Use |
| ------- | --- |
| `development` | Dev client, internal, iOS simulator builds |
| `preview` | Internal QA builds (OTA channel `preview`) |
| `production` | Store-bound builds (OTA channel `production`, auto-increment) |

Set Supabase and Sentry values as [EAS secrets](https://docs.expo.dev/build-reference/variables/) or GitHub Actions secrets (see below). Never commit keys.

## One-time manual setup (maintainers)

1. **Expo / EAS**
   - Create or link an Expo project: from this directory run `eas init` (writes `extra.eas.projectId` into config).
   - Create an access token → GitHub secret `EXPO_TOKEN`.
   - Configure **EAS environment variables** (per profile: `development`, `preview`, `production`):
     - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (hosted dev or prod — never commit values)
     - `EXPO_PUBLIC_WEB_BASE_URL` (optional; defaults in CI workflows)
     - `EXPO_PUBLIC_SENTRY_DSN` (optional; Sentry is a no-op without it)
     - `EXPO_PUBLIC_POSTHOG_KEY` / optional `EXPO_PUBLIC_POSTHOG_HOST` (PostHog is a no-op without the key)
     - `GOOGLE_SERVICES_JSON` — **EAS file** env pointing at `google-services.json` for FCM (Android push)
     - `SENTRY_AUTH_TOKEN` (optional source maps; store workflows set `SENTRY_DISABLE_AUTO_UPLOAD` when absent)

2. **Apple (TestFlight)**
   - App Store Connect app for `org.karmacommunity.app`.
   - App Store Connect API key → secrets `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, `ASC_API_KEY_P8` (contents of the `.p8` file).
   - Team id → secret `KC_IOS_TEAM_ID`. Variable `KC_ASC_APP_ID` (numeric App Store Connect app id).
   - **Mobile nightly** uploads every night; manual runs: **TestFlight iOS** (`testflight-ios.yml`: macOS `eas build --local` + upload only, no App Review).

3. **Google Play (internal track)**
   - Play Console app with package `org.karmacommunity.app`.
   - Service account JSON → secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
   - **Mobile nightly** uploads every night; manual runs: **Play Internal Android** (`play-internal.yml`: EAS cloud AAB + internal-track submit).

4. **Store listings** — screenshots, privacy policy URLs, and review metadata are out of scope for CI; prepare in App Store Connect / Play Console before public release.

## GitHub Actions workflows

| Workflow | Purpose |
| -------- | ------- |
| [`kc-mobile-eas-preview.yml`](../../../.github/workflows/kc-mobile-eas-preview.yml) | Manual EAS preview builds (no store submit) |
| [`mobile-nightly.yml`](../../../.github/workflows/mobile-nightly.yml) | Nightly: newest green `dev` commit → P0 E2E → TestFlight + Play internal |
| [`testflight-ios.yml`](../../../.github/workflows/testflight-ios.yml) | TestFlight upload (macOS local EAS build); nightly or manual on `dev` |
| [`play-internal.yml`](../../../.github/workflows/play-internal.yml) | Play internal-track upload; nightly or manual on `dev` |

Store builds only build commits with a green `CI` push run and fail fast when required secrets are missing. They use the eas.json `nightly` profile and the kc-dev Supabase backend (key in the GitHub Environment `mobile-store`), and refuse to upload a build whose bundle points elsewhere ([`ENVIRONMENTS.md`](../../../docs/SSOT/ENVIRONMENTS.md)).

## OTA updates

`runtimeVersion` policy is `appVersion` (see `app.json`). After `eas init`, configure EAS Update channels matching `eas.json` (`development`, `preview`, `production`).
