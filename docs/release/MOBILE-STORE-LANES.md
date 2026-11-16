# Mobile store lanes: iOS and Android are independent

iOS and Android need different things (macOS + local `eas build` + ASC/TestFlight vs EAS cloud + Play service account; different build numbers, signing, artifact layout and failure modes). The store pipeline therefore runs them as two lanes that share only platform-agnostic preconditions.

```
PROD:    gate (per-platform decision) → ledger (read-only kc-prod) → ios ∥ android → summary (per-platform verdict)
Nightly: resolve (per-platform decision) → e2e P0 (kc-dev) → ios → record-ios
                                                           → android → record-android
Preview: matrix [ios, android], fail-fast off, one concurrency group per platform
```

## Rules

| Concern | iOS lane | Android lane |
|---|---|---|
| Workflow | `testflight-ios.yml` (macOS, local `eas build`, `eas submit` to TestFlight) | `play-internal.yml` (ubuntu, EAS cloud build, `eas submit` to Play **internal**) |
| Depends on the other lane | never | never |
| Concurrency (no cancel) | `testflight-ios-<caller>` | `play-internal-android-<caller>` |
| Secrets passed (by name, from env `mobile-store`) | `EXPO_TOKEN`, `ASC_API_KEY_*`, `KC_IOS_TEAM_ID`, `KC_IOS_DIST_P12_*`, `MOBILE_SUPABASE_ANON_KEY(_PROD)`, `SENTRY_AUTH_TOKEN` | `EXPO_TOKEN`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `MOBILE_SUPABASE_ANON_KEY(_PROD)` |
| Shared artifact check | `mobile-store-config.mjs verify` (backend refs, PROD Google web client) on `main.jsbundle` + `EXConstants.bundle/app.config` | same on `index.android.bundle` + `base/assets/app.config` |
| Platform artifact check | `verify-platform ios`: bundle id; Google iOS client ⇒ its reversed URL scheme must be in Info.plist (warning if no iOS client = browser OAuth) | `verify-platform android`: package name; warning if no Google web client |
| Build number | EAS remote autoIncrement `buildNumber` | EAS remote autoIncrement `versionCode` |
| Marketing version | `app/VERSION` (shared on purpose: one release = one version on both stores) | same |
| PROD switch | `KC_PROD_STORE_BUILD_IOS_ENABLED` | `KC_PROD_STORE_BUILD_ANDROID_ENABLED` |
| Nightly kill switch | `KC_NIGHTLY_IOS_ENABLED` | `KC_NIGHTLY_ANDROID_ENABLED` |
| Nightly shipped tag | `mobile/ios/v<version>-b<buildNumber>` | `mobile/android/v<version>-c<versionCode>` |

## Switches (repo variables, owner only; workflows never set them)

- PROD: a platform's own variable wins: exactly `true` = on; any other non-empty value (e.g. `false`) = that platform off. Unset = fallback to `KC_PROD_STORE_BUILD_ENABLED` (exactly `true` = both on). A tagged release with one platform off builds the other and logs a notice; with both off it fails closed. A dispatch that names one platform that is off fails.
- Nightly: unset or `true` = on, `false` = off, anything else = error (typo safety).
- Dispatch: `prod-store-build.yml` and `mobile-nightly.yml` take `platform: both | ios | android`.

## Legacy

The combined nightly tag `mobile/v<ver>-ios<N>-android<M>` still counts as shipped for both platforms. `KC_PROD_STORE_BUILD_ENABLED` keeps working unchanged when the per-platform variables are unset.
