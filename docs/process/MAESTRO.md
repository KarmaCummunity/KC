# Maestro mobile E2E (Android)

Real end-to-end tests that tap through the native app on an Android emulator, against **kc-dev**.
Tracking issue: KC#1235. Workflow: [`ci-maestro-android.yml`](../../.github/workflows/ci-maestro-android.yml).

## What runs

| Flow (`.maestro/flows/`) | Journey | Spec |
|---|---|---|
| `01-auth-email-sign-in` | fresh install → welcome → email sign-in → feed | FR-AUTH-001 AC2, FR-AUTH-002 |
| `02-auth-wrong-password` | wrong password stays signed out | FR-AUTH-002 |
| `03-auth-welcome-no-guest-entry` | the welcome screen offers sign-in only, no guest preview | FR-AUTH-001 AC4 |
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
| `20-import-post-kill-switch` | with `external_post_import_enabled` off, the import link opens the plain create form and the form offers no import entry | FR-IMPORT-001 AC4 |
| `21-employment-job-offer-form` | employment job offer: the role/scope/requirements/salary fields render, title and role are required, and the publish stops at the organization gate (no eligible org seeded, so no publish, salary validation and cards stay unit-covered, see the flow header) | spec 05 §5.11, #2278, #2537, #1476 |
| `22-edit-profile-save-persistence` | edit profile: editing the phone and tapping Save persists it to kc-dev; reopening shows the saved value | FR-PROFILE-007 |

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

## Required for a PR that touches the app, and a health run on `dev`

- **In the dev merge queue (required):** `maestro` is a lane of the `CI gate` (the only required check, D-195), planned by `scripts/ci-changes.mjs` for a merge group into `dev` whose diff (group base → group head, so every PR in the group) touches `app/apps/mobile`, `app/packages`, `app/pnpm-lock.yaml`, `.maestro`, `scripts/maestro-*` or the workflow (`MAESTRO_RULES`), except files that never reach the APK (`MAESTRO_IGNORE`: `public/`, `functions/`, `web-edge/`, unit tests and mocks, vitest config, ratchet baselines, `*.md`). An undiffable group runs it (fail closed). So nothing that changes what the journeys see lands on `dev` without passing them on the exact commit that lands. A failed flow fails the group and the queue drops the PR. A PR into `main` (no queue after it) still runs the lane on its own diff.
- **Queue head first (#2613):** every merge into dev is followed by a version-bump commit that rebuilds all merge groups, so up to five groups ask for the emulator together. The concurrency queue is FIFO by request time, so the queue's head could be served last (24 Nov 2026: ~2.5 h per merge). The `maestro · queue turn` job (`scripts/maestro-queue-turn.mjs`) runs alongside the APK build. A merge_group run waits there while any earlier merge-queue entry (found by walking the `gh-readonly-queue/dev/pr-N-<base sha>` refs back from its own base; GraphQL `mergeQueue` refuses the workflow token) still has Maestro to finish (APK building, emulator pending or running), and only then lets its emulator job ask for the emulator. It holds neither the emulator nor a kc-dev slot while waiting. Other events pass straight through, and a failed lookup, an entry no longer in the queue or 150 min of waiting go on as before (fail-open).
- **Orphaned entries free the emulator (#2746):** when the queue is rebuilt, GitHub deletes the old entries' `gh-readonly-queue/…` refs but does not cancel their runs, which still waited for the emulator, about an hour each, ahead of the live entries (26–27 Nov 2026: four, then five, at a time). The emulator job's first step (`scripts/maestro-queue-entry.mjs`) checks its own queue ref once it holds the emulator. On a `404` it skips the kc-dev slot wait and the flows and ends green within seconds. Any other answer, or any other event, runs the suite as before (fail-open).
- **On a PR into dev (opt-in):** add the `maestro` label and push (a label alone starts no run) to get the journeys as early feedback; without it the PR's gate leaves the lane to the queue. A Dependabot PR never runs it on the PR (no secrets); its merge group does.
- **No runner held while waiting (#2613):** the lane builds the E2E APK in its own job, in parallel, then the emulator job waits on the `kc-dev-maestro-emulator` concurrency group (`queue: max`, FIFO, shared with `maestro-dev-health.yml`) as a queued job that holds no runner. Before this, on 23 Nov 2026, 15 of ~17 running jobs were Maestro runs idling in the kc-dev slot step on the ~20-runner Free plan, so merge groups, gates and verdicts all queued behind them. The kc-dev test slot step still orders it with the other kc-dev suites; it never lets a job through on a GitHub API error, and only after 120 min proceeds without a slot. The runner stops early, failed and with the reason, when kc-dev cannot sign the seed user in during the 10-minute wait or when 3 flows in a row fail twice; the flow step times out at 55 min (a green run is 24–28 min). It starts only after `static` and `frontend` did not fail. Expect about 15 min (APK) + queue + ~30 min (emulator) per merge group that needs it.
- **On `dev`:** `maestro-dev-health.yml` runs the same journeys after a push to `dev` that touches the app (one run in flight, a newer push replaces it) and on demand. It is **not** part of `CI`: `deploy.yml` deploys on a green `CI` push run, kc-dev is what those deploys and reseeds change, and a 45-minute run that needs kc-dev quiet must never hold, or be held by, a deploy. Read a red run as a signal to look at; the artifact has the evidence. It **yields to the merge queue** (`yield_to_queue`, `scripts/maestro-dev-yield.mjs`): while it waits for the kc-dev slot it checks, each poll, whether dev has moved past its commit or a merge-group emulator job is waiting, and if so it skips the flows and ends green, freeing the emulator group. On 24 Nov 2026 a superseded dev-health run held the emulator ahead of three merge groups for ~70 min. Manual runs never yield.
- **Retry:** a flow that fails is run once more (`scripts/maestro-run-android.sh`). Passing only on the retry prints a warning naming the flow and keeps the first attempt's video and debug output, so an unstable flow stays visible; failing twice fails the lane. A flow that is retried often is a bug to fix, not a retry to raise.
- **Waiting for kc-dev.** Before the retry, `scripts/maestro-wait-kc-dev.mjs` probes a password sign-in of the seed user (up to ten minutes, a probe every 15 s) so the retry meets a working environment: a deploy that applies migrations, a reseed or an outage can leave kc-dev unable to sign anyone in for minutes (it took flows 18 and 19 down for eight on 2026-11-12). If none works it prints a warning that says so, and the flow's failure is the outage's, not the flow's.
- **kc-dev is shared and mutable.** A rebuild, a reseed or a deploy while the lane runs can fail sign-in or hide data (this happened on 2026-11-11 after the baseline cut-over). If a PR is red on sign-in across many flows, check the `Seed KC dev` and `Deploy` runs of the same window before touching the PR, and re-run the failed job once.
- **Changing the lane** (`ci.yml`, `ci-changes.mjs`, `ci-gate.mjs`) is a gate-weakening-class change: it needs the owner's approval on the head SHA (INFRA-CI-2).

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
