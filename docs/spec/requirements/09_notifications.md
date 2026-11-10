# 2.9 Notifications

> **Status:** ✅ Implemented — All in-scope FRs shipped end-to-end. FR-NOTIF-004 (message_undeliverable) and FR-NOTIF-012 (account-deletion email) remain deferred — see TD-62 and TD-118 respectively. FR-NOTIF-016 (quiet hours) is out of MVP per spec. Web Push parity tracked under TD-65. ⚠️ Audit 2026-05-16: 4 🔴 — sign-out leaves device row active (TD-100 / FR-NOTIF-015 AC3); follow_started/approved tap routing broken (TD-73); ~50% of system-message pushes silently dropped (TD-74); FR-NOTIF-003 needs an AC2 foreground-suppression analogue. BACKLOG P2.13. See `docs/SSOT/archive/audit/2026-05-16/04_chat_notifications.md`.



Prefix: `FR-NOTIF-*`

---

## Scope

The complete notification taxonomy for MVP. Notifications are delivered via push (mobile + Web Push) only — there is **no** in-app notifications screen in MVP (`PRD_MVP/08_Out_of_Scope_and_Future.md`).

The system has exactly two user-controllable categories (per `D-5`):

- **Critical** — actions the user must know about to operate the product correctly (chat messages, recipient marking, follow requests, removals, expiry).
- **Social** — courtesy updates that strengthen connection but are non-blocking (someone followed you, someone approved your request).

A user toggle exists per category. Both categories default to **on**.

---

## FR-NOTIF-001 — New chat message *(Critical)*

**Description.**
A new message in any conversation triggers a notification to the recipient.

**Source.**
- PRD: `03_Core_Features.md` §3.4.3, `04_User_Flows.md` Flow 6.

**Acceptance Criteria.**
- AC1. Title: sender's `display_name`. Body: the first 80 characters of the message text. Tap → conversation screen.
- AC2. Suppressed when the recipient is currently active in that exact conversation screen (foreground + same chat).
- AC3. Coalescing: multiple messages from the same sender within 60 seconds collapse into a single OS-level notification with an updated count.
- AC4. Disabled by `notif_critical = false`.

**Related.** Domain: `Notification`, `NotificationPreference`.

---

## FR-NOTIF-002 — Mention in support thread (Super Admin → user) *(Critical)*

**Description.**
A response from the Super Admin in the user's support thread is treated as a Critical message.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4 (3rd entry), §3.5.

**Acceptance Criteria.**
- AC1. Same payload as `FR-NOTIF-001` but the title displays "Karma Community Support" instead of the literal Super Admin display name.
- AC2. Suppressing the support-thread notification individually is **not** allowed; the Critical category toggle is the only control.

**Related.** Domain: `Notification`.

---

## FR-NOTIF-003 — System message in any thread *(Critical)*

**Description.**
Every system-injected message into a chat thread emits a notification.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4, `02_Personas_Roles.md` §2.2.

**Acceptance Criteria.**
- AC1. Includes notifications for moderation outcomes that drop a system message into the user's thread (e.g., a chat being moderation-hidden after report processing).
- AC2. Tap → the thread.

**Related.** Domain: `Notification`, `Message.kind = system`.

---

## FR-NOTIF-004 — Message no longer deliverable (suspension / deletion) *(Critical)*

**Description.**
If a message I sent failed to be delivered because the recipient's account was deleted or suspended after I sent it, I receive a passive notification.

**Source.**
- (Internal: privacy-respecting feedback to the sender.)

**Acceptance Criteria.**
- AC1. Title: "Message could not be delivered". Body: "The recipient is no longer reachable."
- AC2. Tap → conversation screen with the failed message.
- AC3. Sent at most once per `(sender, chat)` pair within 24 hours, even if multiple messages failed.

**Related.** Domain: `Message`, `User.account_status`.

---

## FR-NOTIF-005 — Post expiring soon *(Critical)*

**Description.**
A post owner is informed 7 days before automatic expiry.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section ד).
- Constraints: `R-MVP-Items-5`.

**Acceptance Criteria.**
- AC1. Triggered exactly once per post when `now() = created_at + 293 days`.
- AC2. Title: "Your post is expiring in 7 days". Body: post title. Tap → owner's view of the post.
- AC3. Suppressed if the post is no longer in `open` status.

**Related.** Domain: `Post`.

---

## FR-NOTIF-006 — Follow request received *(Social)*

**Description.**
The owner of a `Private` profile receives a notification on a new follow request.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ב), `04_User_Flows.md` Flow 13.

**Acceptance Criteria.**
- AC1. Title: requester's `display_name`. Body: "Wants to follow you".
- AC2. Quick actions on the OS notification (where supported): "View", "Approve", "Reject".
- AC3. Tap (no quick action chosen) → Follow Requests screen (5.4).

**Related.** Domain: `Notification`, `FollowRequest`.

---

## FR-NOTIF-007 — Started following *(Social)*

**Description.**
A user is notified when someone starts following them in `Public` mode.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section א).

**Acceptance Criteria.**
- AC1. Title: follower's `display_name`. Body: "Started following you".
- AC2. Tap → follower's profile.
- AC3. Coalescing: ≥3 followers within 60 minutes coalesce to "X new followers".
- AC4. Disabled by `notif_social = false`.

---

## FR-NOTIF-008 — Follow request approved *(Social)*

**Description.**
The requester receives a notification when their request is approved.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ב).

**Acceptance Criteria.**
- AC1. Title: target's `display_name`. Body: "Accepted your follow request".
- AC2. Tap → target's profile.

---

## FR-NOTIF-009 — Marked as recipient *(Critical)*

**Description.**
A user is notified the moment a post owner marks them as the recipient.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section א), Decisions `D-5`.

**Acceptance Criteria.**
- AC1. Title: owner's `display_name`. Body: "Marked you as the recipient of [post title]".
- AC2. Tap → recipient's view of the post (`FR-POST-017`).
- AC3. Always Critical regardless of social toggle.

---

## FR-NOTIF-010 — Recipient un-marked themselves *(Critical)*

**Description.**
The post owner is notified when the recipient removes their mark.

**Source.**
- Decisions: `D-7`.

**Acceptance Criteria.**
- AC1. Title: recipient's `display_name`. Body: "Removed their recipient mark from [post title]".
- AC2. Tap → owner's view of the (now-`deleted_no_recipient`) post; from there the owner can reopen, re-mark, or let it expire.

---

## FR-NOTIF-011 — Content auto-removed *(Critical)*

**Description.**
The owner of an auto-removed target is notified.

**Source.**
- PRD: `03_Core_Features.md` §3.5, `04_User_Flows.md` Flow 9.A.

**Acceptance Criteria.**
- AC1. Title: "Your post was removed". Body: neutral language explaining the policy. Tap → a static help page.
- AC2. Suspended users do not receive notifications until the suspension lifts; the next sign-in attempt explains the suspension.

**Related.** Domain: `Notification`, `Report`.

---

## FR-NOTIF-012 — Account-deletion completion *(Critical)*

**Description.**
On final hard-deletion of an account (post 30-day cooldown), an email is sent (no push since there is no device left). Out of scope of push notifications but listed for completeness.

**Source.**
- Constraints: `R-MVP-Privacy-6`.

**Acceptance Criteria.**
- AC1. Email is sent to the original verified address (when applicable) confirming permanent deletion.
- AC2. The email is not retried more than 3 times; failure is logged as a privacy-event metric.

---

## FR-NOTIF-013 — Reopen by owner (no notification) *(decision)*

**Description.**
Reopening a `closed_delivered` post intentionally produces no notification to the recipient (`D-6`). This requirement formalizes that absence.

**Source.**
- Decisions: `D-6`.

**Acceptance Criteria.**
- AC1. The notification dispatcher must **not** emit any push for the reopen event. The recipient observes the change passively when revisiting their closed-posts area.
- AC2. An audit event still records the reopen (`R-MVP-Safety-3`).

---

## FR-NOTIF-014 — User notification preferences

**Description.**
The user controls notifications via two toggles in Settings.

**Source.**
- PRD: `03_Core_Features.md` §3.5.
- Decisions: `D-5`.

**Acceptance Criteria.**
- AC1. Toggles: `notif_critical` and `notif_social`. Default: both `true`.
- AC2. Disabling Critical disables every Critical-tagged FR (`FR-NOTIF-001..005`, `FR-NOTIF-009..013`).
- AC3. Disabling Social disables every Social-tagged FR (`FR-NOTIF-006..008`).
- AC4. Toggle changes apply within `NFR-PERF-007` (≤5s end-to-end propagation to the push provider).

**Related.** Screens: 5.1 · Domain: `NotificationPreference`.

---

## FR-NOTIF-015 — Push token lifecycle

**Description.**
Devices register and unregister push tokens.

**Source.**
- PRD: `06_Navigation_Structure.md` §6.6.4 (mobile baseline).

**Acceptance Criteria.**
- AC1. On sign-in, the client requests OS notification permission and registers an FCM (Android), APNs (iOS), or Web Push subscription with the server.
- AC2. Tokens are stored under `User.devices[]` with `platform` and `last_seen_at`.
- AC3. On sign-out, the corresponding token is deactivated.
- AC4. Tokens not used for 90 days are pruned by `bg-job-token-prune`.
- AC5. Permission denial is recorded; the user can opt back in via OS settings.

**Related.** Domain: `Device`.

---

## FR-NOTIF-016 — Quiet hours (out of scope MVP)

> ⚠️ **Superseded by the project book** — D26 — quiet hours are in scope (default 22:00–08:00) and shipped in `0256` (Settings → Notifications → Quiet hours; matching honors them in `0422`). Binding text: `docs/spec/07_cross_cutting_systems.md` §7.11. The text below is kept as history (D35).

**Description.**
Quiet hours / Do-Not-Disturb scheduling is **not** in MVP. Documented to prevent accidental implementation.

**Source.**
- PRD: `08_Out_of_Scope_and_Future.md` (implicit — single toggle decision).

**Acceptance Criteria.**
- AC1. The Settings UI does not expose quiet-hours controls.
- AC2. The notification dispatcher does not look up time-zone-based suppression; OS-level Do-Not-Disturb is honored implicitly through the OS layer.

---

## FR-NOTIF-017 — Per-type opt-out: match suggestions

> **Status (2026-10-30):** ✅ Implemented — KC#1120. Book §7.11 (D26) "per-type and per-channel preferences"; this FR covers the first type, `match_suggested`.

**Description.**
Besides the two category toggles (FR-NOTIF-014), the user can turn off a single notification type. The first one exposed in Settings is **Match suggestions** (matching engine v2, `docs/SSOT/MATCHING_V2.md`).

**Acceptance Criteria.**
- AC1. Preferences carry an optional `kinds` map (`{ <notification kind>: false }`). Opt-out model: a missing key means "on", so existing users keep every notification (no backfill).
- AC2. Updating one kind keeps the other kinds (`users_merge_notification_preferences` merges `kinds` per key; a non-object `kinds` is rejected with `22023`). Only the caller's own row is written.
- AC3. Settings → Notifications shows a "Match suggestions" toggle (he + en), default on, applied optimistically.
- AC4. With `match_suggested` off, `match_deliver_pending` sends no in-app, push or WhatsApp match alert to that user; their side is settled (`delivery.<side>.opted_out = true`) and does not count toward the daily cap (§7.11: 3/day).
- AC5. Opting out of alerts does not hide the match itself: it stays in "Matches for you" (`rpc_my_matches`).

**Related.** Migration `0460` · Domain `isNotificationKindEnabled` · Application `applyNotificationPreferencesPatch` · Tests `supabase/tests/0460_notification_kind_preferences.sql`, `packages/domain/src/__tests__/notifications.test.ts`, `packages/application/src/notifications/__tests__/`.

---

## FR-NOTIF-018 — Item and food handoff changes *(Critical)*

> **Status (2026-11-02):** ✅ Implemented — KC#1391. Book §7.5 (closing and handoff). Rides have the same contract for bookings (0511, D73); this FR covers the items and food worlds.

**Description.**
Every change to an item or food handoff (`giving_handoffs`) pushes the other side, so neither the giver nor the requester has to open the app to learn about it.

**Acceptance Criteria.**
- AC1. A new item request (`reserved`) pushes the giver (`giving_handoff_requested`). A food quick claim, which is confirmed at once, pushes the giver (`giving_handoff_claimed`).
- AC2. The giver approving a request (`confirmed`) pushes the requester (`giving_handoff_confirmed`).
- AC3. The giver cancelling a waiting request pushes the requester as a decline (`giving_handoff_declined`). Any other cancellation pushes the side that did not cancel, and a system cancel pushes both sides (`giving_handoff_cancelled`).
- AC3b. A request the giver did not answer within its 24 h confirm window lapses; both sides are pushed `giving_handoff_expired` ({{D:giving-reservation-expires}}, `0704`).
- AC4. Marking the handoff handed over pushes the other side to rate it (`giving_handoff_completed`).
- AC5. The side that acted is never pushed about its own action. Each recipient gets each change once (dedupe per kind, handoff and recipient).
- AC6. The push names the other side and the listing, in Hebrew. Tapping it opens the listing's post — the one detail screen (G1 step 4c, `0562`; the same holds for every notification about a listing: food expiry, ride bookings and routes, housing stays).
- AC7. Rides and knowledge handoffs are not affected: rides keep their booking pushes (0511).

**Related.** Migration `0528` · Domain `NotificationKind` · Mobile `pushRouteAllowlist` · Copy `dispatch-notification/i18n.json` + `notifications` locales · Tests `supabase/tests/0528_giving_handoff_notifications.sql`, `src/lib/notifications/__tests__/pushRouteAllowlist.test.ts`, `src/i18n/__tests__/handoffPushCopy.test.ts`.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft. Master list synthesized from PRD flows + Decisions D-5, D-6, D-7. |
| 0.2 | 2026-10-30 | FR-NOTIF-017 per-type opt-out (match suggestions); FR-NOTIF-016 marked superseded by D26. |
| 0.3 | 2026-11-02 | FR-NOTIF-018 item and food handoff pushes (KC#1391). |
