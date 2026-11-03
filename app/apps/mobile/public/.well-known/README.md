# Deep-link manifests — fingerprint placeholders

These two files are served from `/.well-known/` to register the app for
universal links (iOS) and app links (Android). They are checked into the
public bundle so the dev web server + production hosting both serve them.

## Status (TD-66, escalated to 🔴 on audit 2026-05-16)

Both files still contain placeholder fingerprints:

- `apple-app-site-association` → `appID: "REPLACE_WITH_APPLE_TEAM_ID.org.karmacommunity.app"`
- `assetlinks.json` → `sha256_cert_fingerprints: ["REPLACE_WITH_ANDROID_RELEASE_SHA256"]`

Until both placeholders are filled in with real values, the universal-link /
app-link handoff falls back to the in-browser chooser dialog on a release
build. The custom-scheme `karmacommunity://` fallback still works for dev
(Expo Go), but production users will see "Open in browser?" instead of a
direct app open.

## How to fill them

### Apple Team ID

1. Log in to https://developer.apple.com/account → Membership → Team ID
   (10-character alphanumeric).
2. Replace `REPLACE_WITH_APPLE_TEAM_ID` in `apple-app-site-association`.
3. Re-deploy. AASA is fetched by Apple at install time — already-installed
   builds need to be reinstalled (or wait for the cache to expire).

### Android SHA-256 release fingerprint

1. Build a release APK via EAS: `eas build --platform android --profile production`.
2. After the build completes, EAS prints the upload-key SHA-256, or fetch it from:
   `eas credentials --platform android` → "App signing key fingerprint (SHA-256)".
3. Replace `REPLACE_WITH_ANDROID_RELEASE_SHA256` in `assetlinks.json` with
   the colon-delimited fingerprint (e.g. `12:34:56:...`).
4. Re-deploy. Android verifies app-link manifests on install; existing
   installs need re-verification (Settings → Apps → KC → Open by default
   → Verify links).

## Path coverage

Both files now cover every route the app deep-links into:

- `/auth/verify*` — email verification (FR-AUTH-006)
- `/auth/callback*` — OAuth code exchange (FR-AUTH-003 Google, FR-AUTH-004 Apple)
- `/post/*` — post detail (push tap from FR-NOTIF-007/008, share intent)
- `/user/*` — profile (push tap, share intent)
- `/chat/*` — chat thread (push tap from FR-NOTIF-001)

Before this fix only `/auth/verify*` was claimed — every other deep link
silently degraded to a web open even after Team ID is filled.

`assetlinks.json` does not carry per-path coverage (Android verifies
whole-domain), so the paths listed above are enforced by the AASA file
alone on iOS and by the app's `android:autoVerify` intent filters on
Android. Both surfaces need the fingerprint replaced before they verify.
