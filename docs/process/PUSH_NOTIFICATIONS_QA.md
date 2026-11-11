# Push notifications — device QA

Real delivery through APNs and FCM cannot run in CI or in a sandbox: it needs signed builds,
physical devices and provider credentials. The automated suites cover everything up to the
provider request and everything from the tap onward; this runbook covers the part in between.
Run it before every store release and after any change to `dispatch-notification`, the kind
registry, `app.json` notification settings or `apps/mobile/src/lib/notifications/`.

## What is automated (do not repeat by hand)

| Layer | Suite | Covers, for every kind of the registry |
|---|---|---|
| Database | `supabase/tests/051_push_contract.sql` | push payload fields, tokens by device, badge, quiet hours, retries, receipts, dead devices |
| Worker | `supabase/functions/dispatch-notification/*.test.ts` | Android and iOS message per kind, batching, partial failure, back-off, concurrency, no token or text in logs |
| App | `app/apps/mobile/src/i18n/__tests__/notificationKinds.test.ts` | Hebrew and English texts and their arguments, route, channel |
| Generator | `scripts/generate-notification-kinds.test.mjs` | kind list derived from SQL, missing pieces named |

## Configuration and credentials (names only)

| What | Where | Needed for |
|---|---|---|
| `EXPO_ACCESS_TOKEN` | Supabase Edge Function secret | Expo push API with enhanced security enabled |
| `SUPABASE_DB_URL` | Edge Function secret (built in) | the worker's Postgres connection (transaction pooler) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function secret (built in) | caller check of the worker |
| APNs key (`.p8`), key id, team id | EAS credentials of the iOS app | Expo → APNs |
| FCM V1 service account key | EAS credentials of the Android app | Expo → FCM |
| `google-services.json` | EAS file secret / build input | FCM on Android builds |
| EAS project id | `app.json` → `extra.eas.projectId` | Expo push token |
| iOS capability **Push Notifications** | App ID (EAS manages it) | any push on iOS |
| iOS capability **Time Sensitive Notifications** | App ID; `app.json` → `ios.entitlements` (`com.apple.developer.usernotifications.time-sensitive`) | `time-sensitive` pushes; without it iOS shows them as ordinary ones |
| Worker schedule | a job that calls `dispatch-notification` with the service-role bearer (at least every minute) | delivery at all |

## Device matrix

| Device | Build | Why |
|---|---|---|
| iPhone, current iOS, physical | TestFlight | APNs works on physical devices only; production APNs environment |
| iPhone, oldest supported iOS, physical | TestFlight | interruption levels and Focus behave differently across versions |
| Android phone, Android 13+, physical | Play internal track | runtime notification permission, channels, Doze |
| Android emulator with Google Play services | internal build | FCM works; quick regression of channels and tap routing |
| Android 8–12 device or emulator | internal build | no runtime permission; channels still required |

Two accounts are needed (A acts, B receives). B signs in on the device under test and allows
notifications. Check `Settings → Notifications → device status` shows the device registered.

## States to cover for every row below

1. **Foreground** — app open on another screen: banner shown, sound on important kinds.
2. **Background** — app in the background: notification in the tray.
3. **Killed** — app swiped away: notification in the tray; tap cold-starts the app.
4. **Tap** — lands on the expected screen after sign-in restore (also from a killed app).
5. **Badge** — iOS app icon number equals the unread count shown on the bell; opening the
   notification centre and marking all read clears it.

## Scenarios (one row per category of kinds)

| # | Kinds | Trigger (A does) | Expected on B's device |
|---|---|---|---|
| 1 | `chat_message` | sends B a chat message | title = A's name, body = first 80 characters; tap opens the conversation |
| 2 | `chat_message` grouping | sends three messages within a minute | **one** notification that is replaced, body shows the count and the latest text; iOS groups under one thread |
| 3 | `chat_message` suppression | sends a message while B has that conversation open | nothing shown; with another conversation open, the banner is shown |
| 4 | `support_message`, `system_message` | support replies in the support thread; a system message is posted | title is the support / system title; tap opens the thread |
| 5 | `giving_handoff_*` | requests B's item; B's request is confirmed, declined, cancelled, completed | one push per change; tap opens the post |
| 6 | `ride_booking_*` (time-critical) | books a seat on B's ride; driver confirms / declines | Android: heads-up immediately even in Doze; iOS: marked Time Sensitive, breaks through Focus and scheduled summary |
| 7 | `housing_booking_*`, `event_registration_*` | requests a stay / registers for B's event; host decides | push per change; tap opens the post |
| 8 | `mark_recipient`, `unmark_recipient` | marks B as recipient of a post, then removes the mark | push each time; tap opens the post |
| 9 | `follow_*`, `post_reaction`, `post_comment*`, `post_mention` (social) | follows B, reacts, comments, mentions | **no push**; the bell badge and the notification centre update in real time; app icon badge updates on next app start or push |
| 10 | `auto_removed`, `account_suspended` (bypass) | moderation removes B's post / suspends B, with B's important notifications switched off | still pushed; tap opens the audit screen / the account screen |
| 11 | `match_suggested`, `post_expiring` | matching run / expiry job (operator-triggered on the test environment) | push; tap opens matches / the post |
| 12 | Quiet hours | B enables quiet hours covering now; A triggers rows 1, 5 and 6 | rows 1 and 5: no push, centre updated; row 6: pushed |
| 13 | Preferences | B switches off important notifications; A triggers rows 1 and 10 | row 1: nothing at all; row 10: pushed |
| 14 | Sign-out | B signs out; A sends a message | no push on that device |
| 15 | Second device | B signs in on a second device | both devices get the push; reading on one clears the badge on the other at the next push or app start |
| 16 | Uninstall | B uninstalls; A sends two messages 20 minutes apart | the device row disappears from `user_devices` after the receipt check (operator checks) |
| 17 | Android channels | open system settings → app → notifications | two channels, named in Hebrew: important (heads-up, sound) and social (silent); the old single channel is gone |
| 18 | Permission denied | B denies the permission, then enables it in system settings and reopens the app | device registers on reopen; pushes arrive |

## Why there is no Maestro flow for tap routing

A Maestro flow would need the app to schedule a local notification on request. The app has
no such entry point, and adding a debug-only trigger to a production binary is not worth it:
the routing decision is pure code (`notificationRoutes.ts`, `tapRouting.ts`) and is unit
tested for every kind, and what Maestro would add — pulling down the system shade and tapping
a system-rendered notification — is not stable across emulator images. Rows 1–11 above cover
it on real devices.

## Recording a run

Note, per row and device: build number, pass / fail, and for a failure the notification id
from the notification centre (never a push token). File failures as issues with the label
of the affected world.
