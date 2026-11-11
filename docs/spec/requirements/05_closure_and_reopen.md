# 2.5 Posts: Closure & Reopen

> **Status:** ✅ Core Complete — Close with/without recipient, reopen, chat fan-out shipped. **2026-11-04 (G34, `0559`):** an item handed over through a reservation closes through this same flow (recipient row + `closed_delivered`), so its karma is paid once here and reversed on reopen; closing the post settles any live reservation. **Audit 2026-05-29:** closure candidates scoped to `anchor_post_id` (FR-CLOSURE-003 AC1). Counter drift on `rpc_recipient_unmark_self` + `reopen_post_deleted_no_recipient` (TD-71) closed by migration `0149` under P2.16. FR-CLOSURE-007 still silent on whether `closed_delivered → deleted_no_recipient` from unmark should emit a system message in anchored chats (see `docs/SSOT/archive/audit/2026-05-16/03_posts_closure_feed.md` POST-16).



Prefix: `FR-CLOSURE-*`

---

## Scope

The most KPI-critical workflow in the MVP: marking a post as delivered. Two paths (with recipient / without), a multi-step dialog, statistics propagation, the reopen mechanism, and the recipient's ability to un-mark themselves.

This is the only domain whose changes directly move the **North Star Metric** (Closed-Delivered Posts).

---

## FR-CLOSURE-001 — Initiate closure

**Description.**
The owner of an `open` post taps "Mark as Delivered" from Post Detail.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section א), `04_User_Flows.md` Flow 7.

**Acceptance Criteria.**
- AC1. The action is visible only on the owner's view of an `open` post.
- AC2. Tapping it opens **Closure Step 1** (`FR-CLOSURE-002`); no state change occurs until the user confirms.
- AC3. Cancellation at any closure step leaves the post unchanged in `open`.
- AC4. On successful close (regardless of trigger location — post detail screen or chat anchor card per FR-CHAT-015), the database fans out to every `Chat` with `anchor_post_id = postId` and inserts a `kind='system'` message describing the outcome. See FR-CHAT-015 AC4-AC6 for the bodies and `system_payload` schema.
- AC5. When closure completes successfully from **post detail**, the client shows a short success toast, navigates back (or to the main tabs shell if there is no stack history), and invalidates list caches (including profile closed-posts) so feeds and profile grids are not stale. **Reopen** from the same screen uses the same toast + back pattern (see FR-CLOSURE-005 AC7).
- AC6. (P1.2.x) Clear anchor on close: after the system-message fan-out in AC4, the same closure trigger sets `chats.anchor_post_id = NULL` for every chat that was anchored to the closed post. The clear runs after the message inserts (so the loop still finds the anchored chats) and applies to both `closed_delivered` and `deleted_no_recipient` transitions. Pairs with FR-CHAT-014 AC6 (re-anchor on next entry from a different post). Implemented in `supabase/migrations/0026_chat_anchor_lifecycle.sql`.

**Related.** Screens: 2.3, 6.4.1 · Spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-chat-post-anchor-lifecycle-design.md`.

---

## FR-CLOSURE-002 — Closure Step 1: confirm delivery

**Description.**
The first modal asks whether the item was actually delivered.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6, `05_Screen_UI_Mapping.md` §6.4.1.
- Constraints: `R-MVP-Items-4`.

**Acceptance Criteria.**
- AC1. The copy emphasizes that closure should happen **after** the physical handoff, not after a coordination message.
- AC2. Two buttons: "Yes, delivered" (primary) → advances to Step 2 (`FR-CLOSURE-003`); "Cancel" (secondary) → dismiss.
- AC3. Telemetry event `closure_step1_completed` fires upon confirmation (see [`06_cross_cutting/01_analytics_and_events.md`](../../SSOT/archive/SRS/06_cross_cutting/01_analytics_and_events.md)).

**Related.** Screens: 6.4.1.

---

## FR-CLOSURE-003 — Closure Step 2: pick recipient (optional)

**Description.**
The second modal offers a recipient picker built from the set of users who messaged the owner about this post.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6, `05_Screen_UI_Mapping.md` §6.4.2.

**Acceptance Criteria.**
- AC1. The recipient picker lists every distinct user who has at least one message in a chat thread anchored to this post (or this post's owner with reference to this post — see `FR-CHAT-004`).
- AC2. The list is sorted by recency of latest message; each row shows avatar, name, optional city.
- AC3. Two CTAs: "Mark and Close" (primary, requires a selection) and "Close without marking" (secondary).
- AC4. If no chat partners exist, the picker shows an empty state and only "Close without marking" is enabled.
- AC5. On "Mark and Close": post status moves to `closed_delivered`; a `Recipient { post, user, marked_at }` row is created.
- AC6. On "Close without marking": post status moves to `deleted_no_recipient` with `delete_after = now() + 7 days`.
- AC7. Both paths advance to Step 3 (`FR-CLOSURE-004`).

**Related.** Screens: 6.4.2 · Domain: `Recipient`, `PostStatus`.

---

## FR-CLOSURE-004 — Closure Step 3: educational note (one-time)

**Description.**
A one-time explanation of the closure mechanism, dismissible forever.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section א, Step 4), `05_Screen_UI_Mapping.md` §6.4.3.

**Acceptance Criteria.**
- AC1. Shown the first time the user closes a post (with or without recipient) and on every subsequent closure until they tick "Don't show this again".
- AC2. Copy explains: marked posts are kept forever; unmarked posts are deleted after 7 days; personal stats update either way.
- AC3. Setting persists per user as `User.closure_explainer_dismissed = true`.

**Related.** Screens: 6.4.3.

---

## FR-CLOSURE-005 — Reopen a closed post

**Description.**
The owner can return a `closed_delivered` post (or a `deleted_no_recipient` post still inside the 7-day grace window) to `open` status.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section ב), `04_User_Flows.md` Flow 7 (חלק ב).
- Constraints: `R-MVP-Items-6`, `R-MVP-Items-7`.
- Decisions: `D-6`.

**Acceptance Criteria.**
- AC1. The primary CTA for reopening uses the shared *"item not delivered"* framing (`closure.itemNotDeliveredCta`); behavior remains reopen per AC3–AC7.
- AC2. Confirmation modal warns about consequences and (when relevant) that the recipient mark will be removed.
- AC3. On confirm, the post's status returns to `open`. If the post was `closed_delivered`:
   - The associated `Recipient` row is deleted.
   - The recipient's `items_received_count` decrements by 1 (`D-6`).
   - **No** push notification is sent to the recipient (`D-6`); they observe the change passively when they next view their closed-posts tab.
- AC4. If the post was `deleted_no_recipient` and within the grace window, reopening cancels the scheduled deletion (`bg-job-soft-delete-cleanup`).
- AC5. The owner's `items_given_count` decrements by 1 to keep totals consistent.
- AC6. There is no upper bound on reopen count; however, after 5 reopens a `Suspect` flag is raised (`R-MVP-Items-7`), surfacing the post for admin review (`FR-MOD-008`).
- AC7. When reopen completes successfully from **post detail**, the client shows a short success toast and navigates back (same shell behavior as FR-CLOSURE-001 AC5), after list caches are refreshed.

**Edge Cases.**
- The post was `removed_admin`: cannot be reopened (only the Super Admin may restore it via `FR-ADMIN-002`).
- The post is past the 7-day grace window of `deleted_no_recipient`: it has been hard-deleted; "Reopen" is no longer available.
- The recipient has since deleted their account: reopen still works; no decrement is applied to a non-existent user.

**Related.** Screens: 6.5 · Domain: `Post`, `Recipient`, `Statistic`.

---

## FR-CLOSURE-006 — Recipient receives a one-time educational notification

**Description.**
The recipient (when marked) is informed about being credited.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section א).
- Decisions: `D-5`.

**Acceptance Criteria.**
- AC1. On `Recipient` creation, a notification (`FR-NOTIF-009`) — Critical category — is delivered to the recipient.
- AC2. Copy: *"[Owner name] marked you as the receiver of [post title]. Thanks for being part of the community!"*
- AC3. The notification deep-links to the recipient's view of the post (`FR-POST-017`).

**Related.** Domain: `Notification`, `Recipient`.

---

## FR-CLOSURE-007 — Recipient un-marks themselves

**Description.**
The recipient can remove their recipient mark from a post they were credited with.

**Source.**
- Decisions: `D-7`.

**Acceptance Criteria.**
- AC1. Available only on the recipient's view of `FR-POST-017` for posts in `closed_delivered`.
- AC1b. The primary CTA label matches the shared *"item not delivered"* copy (`closure.unmarkSelfCta`); behavior remains un-mark per AC3–AC4.
- AC2. Confirmation modal explains the consequences: *"You will no longer be credited for this item, and the post owner will be notified that you removed your mark."*
- AC3. On confirm:
   - The `Recipient` row is deleted.
   - `items_received_count` of the recipient decrements by 1.
   - `items_given_count` of the owner decrements by 1.
   - A notification (`FR-NOTIF-013`) — Critical category — informs the owner.
   - The post status remains `closed_delivered` (the post is still considered delivered, just to no specific recipient). To preserve post integrity it transitions to `deleted_no_recipient` with `delete_after = now() + 7 days` so the owner can either reopen, re-mark a different recipient, or let it expire.
- AC4. Audit event recorded (`R-MVP-Safety-3`).

**Edge Cases.**
- If the owner has already deleted their account: the un-mark proceeds; no notification is delivered.
- If the post is concurrently reopened by the owner during the same race: the system serializes the operations such that the final state is `open` with no `Recipient` row and consistent counters.

**Related.** Domain: `Recipient`, `Statistic`, `Notification`.

---

## FR-CLOSURE-008 — Cleanup of unmarked closures

**Description.**
A scheduled job hard-deletes posts that ended in `deleted_no_recipient` after the 7-day grace window.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section א, Step 3).

**Acceptance Criteria.**
- AC1. `bg-job-soft-delete-cleanup` (see [`06_cross_cutting/05_background_jobs.md`](../../SSOT/archive/SRS/06_cross_cutting/05_background_jobs.md)) runs daily.
- AC2. Posts whose `delete_after` has passed are hard-deleted along with their image assets.
- AC3. Reopen of a `deleted_no_recipient` post cancels the scheduled deletion (already in `FR-CLOSURE-005`).
- AC4. The job emits a metric `closure_cleanup_deleted_total` for observability.

**Related.** Domain: `Post`.

---

## FR-CLOSURE-009 — Statistics propagation invariants

**Description.**
The closure flow has strict invariants on counters.

**Source.**
- PRD: `03_Core_Features.md` §3.6.
- Constraints: `R-MVP-Items-4`.

**Acceptance Criteria.**
- AC1. **Items given**: `User.items_given_count` increments **only** when a post moves to `closed_delivered` or `deleted_no_recipient`. Reopen, recipient un-mark, and admin removal decrement appropriately.
- AC2. **Items received**: `User.items_received_count` increments **only** on `Recipient` creation; decrements on its deletion (reopen, recipient un-mark, admin removal of the post).
- AC3. The two counters are computed via materialized projections (Postgres triggers + denormalized columns); the projection logic is owned by the Application layer.
- AC4. Drift detection: a daily job recomputes ground-truth counters from event logs and asserts equivalence; mismatches alert and log (`NFR-RELI-005`).

**Related.** Domain: `Statistic`, `User`.

---

## FR-CLOSURE-011 — Close or assign an open offer to a named member

**Description.**
The owner of an open **give** offer can name the member who received it, using the same recipient picker as a social post (chats, or search). A listing-world post detail shows that action. "My listings" opens the same sheet instead of closing an offer with nobody named. Items, food and animals close when that one handoff is finished. A ride confirms one seat and completes the trip only after departure. A stay confirms one night for the chosen guest and completes it only inside the stay window; the listing stays open for other guests.

**Source.**
- Design: `docs/superpowers/specs/2026-11-07-owner-close-with-recipient-unified-design.md`
- Decisions: D17, D19, D73, D104, D125, G34. Housing and rides defaults below.

**Acceptance Criteria.**
- AC1. On an open give listing post, the owner sees the world label («סומן כנמסר», «סומן כמסור», «סיום האירוח», «שיבוץ נוסע», «ההתנדבות התקיימה ✓») and the existing closure steps.
- AC2. Step 2 is the existing picker: chats and search (`SearchUsersForClosureUseCase`). The primary action requires a selection.
- AC3. «Close without marking» is available for items and animals offers with no live handoff, and hidden for rides and housing.
- AC4. `owner_complete_offer_with_user` refuses a non-owner, a closed or paused offer, the owner as recipient, a blocked pair, and a recipient who cannot see the listing.
- AC5. Assigning an animals adoption or foster offer writes a handed-over handoff and closes the post as `closed_delivered`.
- AC6. Assigning a passenger on a ride that has not left confirms one seat and does not close the ride. A further assign past the seat cap is refused.
- AC7. Assigning a guest on a housing offer confirms that one stay (or completes it when the stay window is open) and does not close the listing.
- AC8. Offer rows on My listings open this sheet when the listing has a feed post. Request listings keep `fulfill_my_listing`.
- AC9. A time-world (volunteering) post, offer or request, is never "delivered": the button reads «ההתנדבות התקיימה ✓» / "Volunteering took place ✓", and the confirmation, picker and explainer speak of the volunteering taking place (#2078, {{D:volunteering-close-wording}}). The member's activity timeline (FR-STATS-003) words the close and the marks as volunteering too (`0742` returns each row's world). The stored status stays `closed_delivered`; the status badge already reads «הושלם». An organization's event ends through its own bar (G18).

**Related.** Screens: listing post detail, My listings, ride bookings, housing host, animal handoff. RPC: `0658_owner_complete_offer_with_user`.

---

## FR-CLOSURE-010 — Suspect flag at 5+ reopens

**Description.**
A post that has been reopened 5 or more times triggers a moderation flag.

**Source.**
- Constraints: `R-MVP-Items-7`.

**Acceptance Criteria.**
- AC1. Each successful reopen increments `Post.reopen_count`.
- AC2. When `reopen_count >= 5`, the post is added to the moderation queue (`FR-MOD-008`) with reason `excessive_reopens`.
- AC3. The user is **not** notified of the flag (we don't want to encourage gaming).
- AC4. The flag is informational; the post remains `open` until the Super Admin acts.

**Related.** Domain: `Post.reopen_count`, `ModerationQueueEntry`.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.3.6, Flow 7, and Decisions D-6, D-7. |
| 0.2 | 2026-11-07 | FR-CLOSURE-011: owner assign / close of an open offer with a named member. |
| 0.3 | 2026-11-11 | FR-CLOSURE-011 AC9: volunteering closes as "took place", not "delivered" (#2078). |
