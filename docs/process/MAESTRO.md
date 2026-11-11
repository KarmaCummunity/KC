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
| `18-org-event-create-and-register` | time offer form: an organization member's event choice and fields, the unchanged shift form otherwise (no seeded membership or event yet, see the flow header) | `docs/spec/08` Events, FR-POST-001 AC6 |
| `19-edit-profile-keyboard-toolbar` | edit profile (deep link): focusing the phone field keeps the sticky save button on screen, with the keyboard open and after it closes | FR-RESP-006 AC5 |

`.maestro/subflows/` holds the shared steps (`sign-in`, `open-email-sign-in`, `dismiss-gates`); `config.yaml` runs only `flows/`.

## How CI builds and runs it

1. `scripts/maestro-dev-env.mjs` resolves the kc-dev URL, the **public** anon key (read from the deployed dev web bundle) and the kc-dev seed password (from the `E2E_SEED_PASSWORD` Actions secret; fails if unset). It refuses to target production.
2. `expo prebuild` + `./gradlew assembleRelease` for `x86_64` only, with `KC_E2E_BUILD=1` (OTA updates off, so the APK runs this PR's JS), `EXPO_PUBLIC_LAUNCH_EMAIL_AUTH=1` and Sentry upload off. No EAS / `EXPO_TOKEN`. The E2E APK has no `EXPO_PUBLIC_ENVIRONMENT`, so `launchSurfaces.ts` treats it as production and hides email sign-in (#2134); every flow signs in by email, so the workflow turns that surface back on with its build override. A remote `app_flags` row `launch_email_auth_enabled` on kc-dev would beat the override; keep it unset.
3. `scripts/maestro-run-android.sh` installs the APK on an API 34 emulator and runs each flow on its own, screen-recording it.
4. Artifacts (`maestro-android`): JUnit per flow, Maestro debug output, and a video **only for failed flows**. The debug output (screenshots, view hierarchy, `maestro.log`) sits under `debug/<flow>/.maestro/tests/`, a hidden folder, so the upload sets `include-hidden-files: true`; without it the artifact holds only the reports and videos. Maestro records every `-e` variable in that output in plain text, so `scripts/maestro-redact.mjs` replaces the seed password (`KC_E2E_PASSWORD`) in it after each flow, before upload; the artifact is readable by everyone with repository access and log masking does not reach files. Keep a new secret out of `-e` or add it to the redaction. A flow `name:` also becomes a folder in the artifact, so it must not contain `" ' : < > | * ?` (`check-maestro-flows.mjs` enforces it). Start a failure investigation there: the screenshot and hierarchy at the failed step say what was on screen.

Known emulator quirks and CI flakes the job handles:
- The release lint step needs more than the template's 512 MB Metaspace; the workflow raises the Gradle daemon to `-Xmx4096m -XX:MaxMetaspaceSize=1536m` after prebuild.
- Transient Gradle build failures: occasionally `assembleRelease` fails due to daemon Metaspace or lock contention on cold runners. The workflow adds an automatic single retry step (`if: steps.build-apk.outcome == 'failure'`) that stops the daemon (`./gradlew --stop`) and retries the build cleanly. Gradle caches (`setup-gradle`) are active. The emulator AVD is deliberately not cached: a restored AVD keeps app data (for example a signed-in session) between runs, which made flows start in the wrong state.
- A cold-booted emulator can show a system "Pixel Launcher isn't responding" dialog over the app. The runner sets `hide_error_dialogs`, and `dismiss-gates.yaml` taps "Wait" if one still appears.
- First-launch interstitials and consent gates: signing in on a fresh install or when documents/onboarding update can present blocking interstitials before `feed-screen` mounts:
  1. The server-driven legal consent modal + required 18+ age checkbox (#1450), where the continue button stays disabled until all terms and age checkboxes are checked.
  2. Multi-step onboarding flows (`(onboarding)/...`).
  3. System (Android 13+ / API 33+) or in-app push notification permission dialogs.
  Previously, these caused `extendedWaitUntil: visible: id: feed-screen` to fail after ~1m24s across all flows. Now, `.maestro/subflows/dismiss-gates.yaml` conditionally checks and taps the exact testIDs (`legal-consent-terms-checkbox`, `legal-consent-privacy-checkbox`, `legal-consent-age-checkbox`, `legal-consent-submit`, `onboarding-skip`, `push-gate-decline`) and text fallbacks. The shared `.maestro/subflows/sign-in.yaml` waits for auth submission to transition, loops `dismiss-gates` while `feed-screen` is not visible, and uses generous timeouts (60–90s) without hiding real failures.

The check is **not required** for merge yet. Make it required (issue AC6) after it has been green for a week of PRs.

## Writing a flow

- Select by `id:` (React Native `testID`), never by Hebrew/English text: the UI language can change. Add a `testID` to the component if one is missing.
- Start signed-in flows with `- runFlow: ../subflows/sign-in.yaml` (fresh install, seed user `user1@seed.kc.test`).
- Put the spec reference in the flow's header comment and in the table above.
- Bug fixes start with a failing flow that reproduces the bug, then the fix (issue AC5).
- Wait with `extendedWaitUntil` (kc-dev latency), not fixed sleeps.
- Wait for an id the screen itself renders (e.g. its root `testID`), not one on a shared component the screen may not use: `post-detail-header` lives on a card component the post screen does not render, so flow 06 waits for `post-detail-screen`.
- Reach rows below the fold with `scrollUntilVisible` (settings rows sit under the donation card on a phone screen).
- Give `scrollUntilVisible` a `direction: UP` when the target is above the viewport. `scrollUntilVisible` scrolls down by default. A failed publish scrolls the create form down to its first problem field (FR-POST-001 AC6), so flow 13 looks for the category row upward.
- A tap that follows `scrollUntilVisible` needs `centerElement: true` when the target can end up under the floating tab bar. The default stops as soon as the element is inside the screen bounds, however much of it an overlay covers, so the tap can land on a tab (flows 16 and 17 opened the search tab instead of the rides tile). `centerElement` keeps scrolling until the element is mid-screen and gives up after a few tries when the list cannot scroll further. `check-maestro-flows.mjs` requires an explicit `centerElement` on every downward `scrollUntilVisible` that is followed by a tap on the same element: `true` where the tab bar can cover it (flow 10's settings row failed the same way), `false` where nothing can and centering would scroll it away (the category row at the top of the create form).
- A screen with a legitimate gate can show either of two roots. Accept both with a quoted `|` id (`id: "housing-verify-gate|listing-create-form"`); `scripts/maestro-flows.test.mjs` checks each alternative against the app's testIDs. Housing shows the verification card below level 2 (FR-HOUSING-003 AC2), and the seed members span levels 0-2.
- Do not call a deterministic failure environment flakiness. A flow that fails on every PR, whatever the PR changes, has a cause in the flow, the app or the build: read its video and debug output first.
- Mark a step `optional` only when the screen may legitimately lack it. A bare command (`back`, `hideKeyboard`) takes no options. `node scripts/check-maestro-flows.mjs` (static lane of `CI gate`) fails on a flow that does not parse or whose every step is optional.

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
