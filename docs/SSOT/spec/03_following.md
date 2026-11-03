# 2.3 Following & Follow Requests

> **Status:** ✅ Core Complete — Follow/unfollow, requests, approval/rejection all shipped. ⚠️ Audit 2026-05-16: 🔴 FR-NOTIF-006/008 dedupe keys lack a cycle segment → re-requests after FR-FOLLOW-008 14-day cooldown silently drop the notification (TD-78, BACKLOG P2.13); FR-FOLLOW-002 AC1 unfollow confirm copy missing name interpolation; followers/following pagination cursor disagrees with sort key. TD-95 / TD-112. See `docs/SSOT/archive/audit/2026-05-16/05_following_moderation_admin.md`. 2026-11-03: a follow edge to a Private profile is created only through an approved request, enforced by the `follow_edges_insert_self` policy (`0541`, test `supabase/tests/0541_follow_edges_private_by_request.sql`; FR-FOLLOW-003 AC4, FR-FOLLOW-012 AC2).



Prefix: `FR-FOLLOW-*`

---

## Scope

The directed-edge social graph between users:

- Follow / unfollow with the right semantics for `Public` and `Private` profiles.
- Follow requests, approval, rejection, cancellation, and cooldown.
- Removing existing followers.
- Side effects: notification, post visibility, blocking interactions.

Out of scope here:

- Profile screen rendering of follow state → [`02_profile_and_privacy.md`](./02_profile_and_privacy.md)
- Notifications produced by follow events → [`09_notifications.md`](./09_notifications.md)
- Blocking → [`08_moderation.md`](./08_moderation.md)

---

## FR-FOLLOW-001 — Follow a public profile

**Description.**
Tapping "Follow" on a `Public` profile creates a `FollowEdge` immediately, no approval required.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section א), `04_User_Flows.md` Flow 8.A.
- Constraints: `R-MVP-Profile-2`.

**Acceptance Criteria.**
- AC1. The action creates a `FollowEdge { follower, followed, created_at }` exactly once (idempotent on retry).
- AC2. `followed.followers_count` increments and `follower.following_count` increments atomically.
- AC3. The followed user receives a `follow_started` notification (`FR-NOTIF-007`) — Social category, dismissible.
- AC4. The button updates to "Following ✓" optimistically; rollback on server error.
- AC5. Following oneself is rejected at the API layer.

**Edge Cases.**
- The followed user is blocked by me (or vice versa): the action is rejected with `BlockedByPolicy` (`R-MVP-Profile-3`).
- The followed user has been suspended: the action is rejected with `UserUnavailable`.

**Related.** Screens: 2.3, 3.3 · Domain: `FollowEdge`.

---

## FR-FOLLOW-002 — Unfollow

**Description.**
Tapping "Following ✓" surfaces a confirmation; on confirm, the edge is removed.

**Source.**
- PRD: `05_Screen_UI_Mapping.md` §3.3.

**Acceptance Criteria.**
- AC1. The confirmation copy is contextual: *"Stop following [name]?"*.
- AC2. On confirm, the `FollowEdge` is hard-deleted; both counters decrement; the button reverts to "Follow".
- AC3. **No** notification is sent to the formerly-followed user (privacy decision aligned with `R-MVP-Privacy-12` philosophy).
- AC4. If the now-formerly-followed user is in `Private` mode, my access to their `Followers only` posts is revoked immediately.

**Related.** Screens: 3.3.

---

## FR-FOLLOW-003 — Send follow request to a private profile

**Description.**
Tapping "Send Follow Request" on a `Private` profile creates a `FollowRequest` in `pending` state.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ב), `04_User_Flows.md` Flow 8.B.
- Constraints: `R-MVP-Profile-2`, `R-MVP-Profile-10`.

**Acceptance Criteria.**
- AC1. Creates a `FollowRequest { requester, target, created_at, status = pending }` if no pending or accepted edge already exists.
- AC2. The recipient receives a `follow_request_received` notification (`FR-NOTIF-006`) — Social category, with quick-actions ("View", "Approve", "Reject").
- AC3. The button updates to "Request Sent ⏳"; tapping again offers "Cancel Request" (`FR-FOLLOW-004`).
- AC4. The request is **not** equivalent to a follow edge: the requester gains no access to private content while the request is pending (`R-MVP-Profile-10`).

**Edge Cases.**
- A request was previously rejected within the last 14 days: the request is rejected with `CooldownActive` and a hint of when it can be retried (`R-MVP-Privacy-12`).
- The target unblocks the requester and a stale rejected request exists with cooldown still active: the cooldown still applies.

**Related.** Screens: 3.3, 5.4 · Domain: `FollowRequest`.

---

## FR-FOLLOW-004 — Cancel a pending follow request

**Description.**
The requester cancels their own pending request from the target's profile.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ב, "ביטול בקשה").

**Acceptance Criteria.**
- AC1. The action transitions the `FollowRequest` to status `cancelled` (soft state for analytics) and removes it from the target's pending list.
- AC2. The button reverts to "Send Follow Request"; the requester may immediately re-request (no cooldown applies because cancellation is voluntary on the requester's side).
- AC3. The target receives no notification about the cancellation.

**Related.** Domain: `FollowRequest`.

---

## FR-FOLLOW-005 — Approve a pending follow request

**Description.**
The target accepts a pending request, creating a `FollowEdge`.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ב), `04_User_Flows.md` Flow 13.A.
- Constraints: `R-MVP-Profile-10`.

**Acceptance Criteria.**
- AC1. The action atomically transitions the `FollowRequest` to `accepted` and creates a `FollowEdge { follower = requester, followed = target }`.
- AC2. Both counters update; cache invalidation propagates within the freshness budget defined in `NFR-PERF-005`.
- AC3. The requester receives a `follow_approved` notification (`FR-NOTIF-008`) — Social category.
- AC4. The approval may be triggered from three surfaces: the push-notification quick-action, the profile screen of the requester, and the Follow Requests screen (5.4).
- AC5. After approval, the requester's read access to the target's `Followers only` posts becomes effective on next query.

**Related.** Screens: 5.4, 3.3 · Domain: `FollowRequest`, `FollowEdge`.

---

## FR-FOLLOW-006 — Reject a pending follow request (silent)

**Description.**
The target rejects a pending request silently.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ב), `04_User_Flows.md` Flow 13.A.
- Constraints: `R-MVP-Privacy-12`.

**Acceptance Criteria.**
- AC1. The action transitions the `FollowRequest` to `rejected` and stamps a `cooldown_until = now() + 14 days`.
- AC2. **No** notification is delivered to the requester (`R-MVP-Privacy-12`).
- AC3. The button on the requester's view of the target's profile reverts to "Send Follow Request" but is disabled until `cooldown_until` with a quiet tooltip *"You can request again in N days"*. (Avoids leaking the rejection but indicates time-based unavailability uniformly with other cooldowns.)
- AC4. Rejection from the push quick-action behaves identically to in-app rejection.

**Edge Cases.**
- The requester reports the same target during the cooldown: the report is processed normally (rejection does not exempt from the moderation flow).

**Related.** Domain: `FollowRequest.cooldown_until`.

---

## FR-FOLLOW-007 — Follow Requests list

**Description.**
The list of pending follow requests, accessible from Settings → Privacy when the profile is `Private`.

**Source.**
- PRD: `03_Core_Features.md` §3.5, `05_Screen_UI_Mapping.md` §5.4.

**Acceptance Criteria.**
- AC1. The list is sorted newest-first, paginated at 50 rows.
- AC2. Each row: avatar, name, city, relative timestamp, two buttons "Approve" and "Reject".
- AC3. Tapping the row opens the requester's profile (`FR-PROFILE-002`) where the same approve/reject buttons appear at the top.
- AC4. The screen is reachable only when `User.privacy_mode = Private`. If the user toggles to `Public` mid-session, the screen auto-dismisses (after `FR-PROFILE-006` triggers).
- AC5. The row count is reflected in Settings as `Follow requests (X)` (`FR-SETTINGS-004`).

**Edge Cases.**
- Empty state: friendly message "No pending requests. New requests will arrive with a notification." (per `D-15`).

**Related.** Screens: 5.4.

---

## FR-FOLLOW-008 — Re-follow after cooldown expiry

**Description.**
After 14 days from rejection, the requester may attempt the follow request again.

**Source.**
- Constraints: `R-MVP-Privacy-12`.

**Acceptance Criteria.**
- AC1. When `now() >= FollowRequest.cooldown_until`, a new request can be created; the prior `rejected` row is preserved for audit but does not block the new one.
- AC2. The newly created request follows the normal flow (`FR-FOLLOW-003`).
- AC3. There is no global limit on consecutive rejection-then-rerequest cycles in MVP, but each cycle starts a new 14-day cooldown after rejection.

**Related.** Domain: `FollowRequest`.

---

## FR-FOLLOW-009 — Remove existing follower

**Description.**
The owner of a profile (in either mode) removes a current follower from their list.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ג), `04_User_Flows.md` Flow 14.
- Constraints: `R-MVP-Profile-10`.

**Acceptance Criteria.**
- AC1. The action is exposed via the `⋮` menu on a follower row in the Followers list (`FR-PROFILE-009`).
- AC2. A confirmation modal lists the consequences: *"They will no longer see your Followers-only posts; they will not be notified; they can re-follow (instantly if your profile is Public, by request if Private)."*
- AC3. On confirm, the corresponding `FollowEdge` is hard-deleted; counters update; affected user's access to `Followers only` posts is revoked.
- AC4. **No** notification to the removed follower.

**Related.** Screens: 3.4 · Domain: `FollowEdge`.

---

## FR-FOLLOW-010 — Mutual follow detection

**Description.**
The system computes a `mutual` flag whenever two users follow each other.

**Source.**
- (Internal: required for analytics on KPI #4.)

**Acceptance Criteria.**
- AC1. The flag is derived (not stored) and exposed by domain queries when both directions of `FollowEdge` exist.
- AC2. The mutual flag is **not** displayed in the MVP UI; it is used only for analytics events `chat_started_with_mutual_follow` (see `06_cross_cutting/01_analytics_and_events.md`).
- AC3. The mutual computation must perform within `NFR-PERF-002` for batches of up to 1,000 user pairs.

---

## FR-FOLLOW-011 — Follow-button state machine on Other Profile

**Description.**
The "Follow" button on `Other Profile` reflects 5 distinct states.

**Source.**
- PRD: `03_Core_Features.md` §3.2.2, `05_Screen_UI_Mapping.md` §3.3.

**Acceptance Criteria.**
- AC1. State `not_following_public`: label "+ Follow", action → `FR-FOLLOW-001`.
- AC2. State `following_public_or_private_approved`: label "Following ✓", action → `FR-FOLLOW-002`.
- AC3. State `not_following_private_no_request`: label "+ Send Follow Request", action → `FR-FOLLOW-003`.
- AC4. State `request_pending`: label "Request Sent ⏳", action → `FR-FOLLOW-004`.
- AC5. State `cooldown_after_reject`: label "+ Send Follow Request" disabled with tooltip indicating cooldown remaining.
- AC6. State `blocked_in_either_direction`: button hidden; the `⋮` menu is the only available action surface.

---

## FR-FOLLOW-012 — Follow side effects on visibility (Followers-only posts)

**Description.**
The set of posts a viewer can see depends on whether the viewer is an approved follower of each post's owner.

**Source.**
- PRD: `03_Core_Features.md` §3.2.4 (sub-section ו).
- Constraints: `R-MVP-Items-12`.

**Acceptance Criteria.**
- AC1. A viewer V can read a post P if:
   - `P.visibility = Public`, **or**
   - `P.visibility = FollowersOnly` and there exists `FollowEdge { follower = V, followed = P.owner }`, **or**
   - `P.visibility = OnlyMe` and `V = P.owner`.
- AC2. The visibility filter is enforced at the data layer (RLS in Supabase) so that bypassing the UI cannot leak protected posts (see `NFR-SEC-002`).
- AC3. Removing a follower (`FR-FOLLOW-009`) immediately revokes their access; cached responses must be invalidated within `NFR-PERF-005`.

**Related.** Domain: `FollowEdge`, `Post`.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.2.4 and Flows 8, 13, 14. |
| 0.2 | 2026-05-11 | Implementation notes (no AC change): FR-FOLLOW-001 AC4 optimistic transition + rollback shipped in `app/apps/mobile/app/user/[handle]/index.tsx` (TD-125); FR-FOLLOW-006 AC3 toast parity — days-remaining surfaced on `cooldown_active` errors (TD-126). |
