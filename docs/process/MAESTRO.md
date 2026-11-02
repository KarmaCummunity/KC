# Maestro mobile E2E (Android)

Real end-to-end tests that tap through the native app on an Android emulator, against **kc-dev**.
Tracking issue: KC#1235. Workflow: [`ci-maestro-android.yml`](../../.github/workflows/ci-maestro-android.yml).

## What runs

| Flow (`.maestro/flows/`) | Journey | Spec |
|---|---|---|
| `01-auth-email-sign-in` | fresh install → welcome → email sign-in → feed | FR-AUTH-001 AC2, FR-AUTH-002 |
| `02-auth-wrong-password` | wrong password stays signed out | FR-AUTH-002 |
| `03-auth-guest-preview` | guest preview opens the guest feed | FR-AUTH-014 |
| `04-auth-forgot-password` | forgot password opens the reset form | FR-AUTH-008 |
| `05-tabs-navigation` | all five tabs open, tab bar stays docked | FR-RESP-001, book §04 |
| `06-feed-open-post` | feed lists posts, a post opens its detail | FR-FEED-001, `04_posts` |
| `07-create-post-form` | composer opens with the unified header | FR-POST-001, book §7.2 |
| `08-chat-inbox` | chat inbox opens from the top bar | `07_chat` |
| `09-notifications-inbox` | notification center opens | book §7.11 |
| `10-settings-notifications` | notification preferences open | FR-NOTIF-014, FR-SETTINGS-005 |
| `11-matches` | "Matches for you" opens by deep link | `MATCHING_V2` |
| `12-donations-hub` | donations hub shows the worlds entry | FR-DONATE-001 |
| `13-create-form-categories` | every create category opens in both directions | FR-POST-001 AC6 |
| `14-world-feed` | food world: request / offer, search and direction filter; "request" opens the food request form | FR-FEED-020 AC2 |

`.maestro/subflows/` holds the shared steps (`sign-in`, `open-email-sign-in`, `dismiss-gates`); `config.yaml` runs only `flows/`.

## How CI builds and runs it

1. `scripts/maestro-dev-env.mjs` resolves the kc-dev URL, the **public** anon key (read from the deployed dev web bundle) and the kc-dev seed password (read from `supabase/seed/kc-dev/seed.sql`). No repository secrets; it refuses to target production.
2. `expo prebuild` + `./gradlew assembleRelease` for `x86_64` only, with `KC_E2E_BUILD=1` (OTA updates off, so the APK runs this PR's JS) and Sentry upload off. No EAS / `EXPO_TOKEN`.
3. `scripts/maestro-run-android.sh` installs the APK on an API 34 emulator and runs each flow on its own, screen-recording it.
4. Artifacts (`maestro-android`): JUnit per flow, Maestro debug output (screenshots, logs), and a video **only for failed flows**.

Known emulator quirks the job handles:
- The release lint step needs more than the template's 512 MB Metaspace; the workflow raises the Gradle daemon to `-Xmx4096m -XX:MaxMetaspaceSize=1536m` after prebuild.
- A cold-booted emulator can show a system "Pixel Launcher isn't responding" dialog over the app. The runner sets `hide_error_dialogs`, and `dismiss-gates.yaml` taps "Wait" if one still appears. If every flow fails on its first assertion, check the failure video for a system dialog before suspecting the app.

The check is **not required** for merge yet. Make it required (issue AC6) after it has been green for a week of PRs.

## Writing a flow

- Select by `id:` (React Native `testID`), never by Hebrew/English text: the UI language can change. Add a `testID` to the component if one is missing.
- Start signed-in flows with `- runFlow: ../subflows/sign-in.yaml` (fresh install, seed user `user1@seed.kc.test`).
- Put the spec reference in the flow's header comment and in the table above.
- Bug fixes start with a failing flow that reproduces the bug, then the fix (issue AC5).
- Wait with `extendedWaitUntil` (kc-dev latency), not fixed sleeps.
- Wait for an id the screen itself renders (e.g. its root `testID`), not one on a shared component the screen may not use: `post-detail-header` lives on a card component the post screen does not render, so flow 06 waits for `post-detail-screen`.
- Reach rows below the fold with `scrollUntilVisible` (settings rows sit under the donation card on a phone screen).

## Running locally

Needs an Android emulator or device, JDK 17, the Android SDK and the [Maestro CLI](https://maestro.mobile.dev).

```bash
eval "$(node scripts/maestro-dev-env.mjs | sed 's/^/export /')"
cd app/apps/mobile && KC_E2E_BUILD=1 npx expo prebuild --platform android --clean
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64)
cd ../../.. && scripts/maestro-run-android.sh app/apps/mobile/android/app/build/outputs/apk/release/app-release.apk
# a single flow: maestro test .maestro/flows/01-auth-email-sign-in.yaml -e KC_E2E_PASSWORD="$KC_E2E_PASSWORD"
```

## Not yet covered (phase 2)

iOS simulator job (macOS runner), screenshot comparison for layout regressions, and deeper journeys that write data (create a post with a photo, chat with an image, handoff + feedback, map pan, delete account).
