# Deep-link manifests (universal links / app links)

Served from `/.well-known/` on `karma-community-kc.com`; both files are checked in and copied into the web export.

| File | Value | Source |
| --- | --- | --- |
| `apple-app-site-association` | `HVW3H3DLRB.org.karmacommunity.app` (Apple Team ID + bundle id) | Apple Team ID (also the repo variable `KC_IOS_TEAM_ID`) |
| `assetlinks.json` | package `org.karmacommunity.app`, two SHA-256 fingerprints | see below |

Android fingerprints (public certificate hashes, not secrets):

- `FA:D0:06:B5:…:C8:D4:16` — Google Play **app-signing key** (what users' installs are signed with; read from the Play Developer API `generatedApks` for the uploaded versions).
- `F5:37:49:60:…:1B:B9:80` — **upload key** (the EAS-managed keystore; `eas credentials` → Android, or the Expo GraphQL `androidKeystore.sha256CertificateFingerprint`). It covers builds installed straight from EAS (internal distribution) and any build signed with the upload key.

If Play ever rotates the app-signing key, or the EAS keystore changes, update `assetlinks.json` (Play Console → Test and release → App signing, https://play.google.com/console → the app → App integrity → App signing).

## Paths

`/auth/verify*`, `/auth/callback*`, `/post/*`, `/user/*`, `/chat/*` and `/sign-in`. They mirror the Android `intentFilters` in `app.json` (`check-well-known-links.mjs` fails when a claimed prefix is missing). `/sign-in` is the store-review email login (hidden from the UI in production, reachable by link). AASA also carries `webcredentials` for the `webcredentials:` associated domain.

## Serving rules

Apple and Google fetch these files without following redirects and require JSON. `apple-app-site-association` has no extension, so `scripts/web-headers.mjs` writes an explicit `Content-Type: application/json` rule into the `_headers` of the Cloudflare Pages export (see `web-headers.test.mjs`).

Checks:

- static lane: `node app/scripts/check-well-known-links.mjs` (no placeholders, ids match `app.json`, paths covered);
- bundles lane: the same with `--dist` (both files present in the export and the JSON rule in `_headers`);
- deploy smoke: the `applinks` check (HTTP 200 with no redirect, `application/json`, body equals the deployed commit's file).

Apple caches the AASA at install time and through its CDN, so a changed file reaches devices after a reinstall or a delay; Android re-verifies on install (Settings → Apps → KC → Open by default).
