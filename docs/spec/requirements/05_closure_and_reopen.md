# 2.5 Posts: Closure & Reopen

> **Status:** Core flows exist, but this is not a claim of complete product acceptance. Reconciliation checkpoint: 2026-11-24, current DEV baseline. The legacy `recipients` table is replaced by `post_handoffs`; closure metadata lives in `post_closures`. Current schema and checked-in SQL tests are evidence of implementation, not new PM decisions. Open questions and historical guarantees not yet reverified are listed below.

## Reconciliation checkpoint (2026-11-24, #1850)

The project book [7.1 and 7.5](../07_cross_cutting_systems.md), decisions D17/D19/D104/D127/D129/D130/D141, and [G34](../93_implementation_gaps.md) remain the product references. FR and AC identifiers below are retained. Older numbered migrations describe history; current executable definitions are under `supabase/schemas/` and assembled into the baseline migration.

| Area | Current source and checked-in evidence | Boundary |
|---|---|---|
| Recipient mark | `25_handoffs/010_post_handoffs.sql`, `070_post_closure_rpcs.sql`; `035_handoffs.sql` closes naming a member | A recipient is a handed-over handoff, not a separate `Recipient` row. |
| Reopen | `reopen_post` in `070_post_closure_rpcs.sql`; `035_handoffs.sql` checks `open / cancelled / reopened`, counter reversal and no recipient notification | Withdraws the completed single-taker mark. It does not reopen an expired post (D127); rides, stays and events keep their own completion rules. The older #2089 observation about an untouched handoff is not a description of this baseline. |
| Recipient unmark | `recipient_unmark_self`; `035_handoffs.sql` checks `deleted_no_recipient`, seven-day deadline, recipient counter reversal and retained owner delivery count | The old AC3 contained two conflicting terminal statuses and a different owner-counter claim. Current behavior is recorded below without turning it into a fresh product approval. |
| Closure effects | `050_post_closures.sql`, `40_messaging/050_chat_system_messages.sql`, `10_identity/040_user_stats.sql` | Server triggers and outbox consumers apply effects. A queued event is not proof it was delivered on a hosted environment. |
| Reopen moderation | `post_closures.reopen_count`, `035_handoffs.sql`, `060_moderation.sql` | Internal signal; the count is not readable by a member. |

These tests were inspected, not rerun for this docs-only checkpoint. No database, runtime policy, production configuration or notification was changed.

### Remaining reconciliation and verification

- **Product decision:** confirm whether recipient unmark should retain the owner's delivery count, as current code/tests do, or reverse it as the historical AC3 said. See [open questions](../92_open_questions.md), closure checkpoint. Do not change counters from this documentation edit.
- **Policy verification:** the book protects a completed handoff from deletion (D104) and allows owner reopen in general. The current single-taker reopen withdraws the mark; do not infer that a completed ride, stay, multi-recipient offer or event may be undone by the item flow. #2089 tracks the wider lifecycle question.
- **Unverified historical guarantees:** `closure_step1_completed`, `closure_cleanup_deleted_total`, the exact cleanup cadence, and chat behavior after recipient unmark require current execution/wiring evidence. Their ACs remain below, not silently dropped or marked passed. Current chat closure fan-out is queued only for `open` to a closed status.
- **Manual/runtime proof:** UI copy, educational-note behavior, push delivery, background purge including storage, concurrency and installed-device behavior are not established by this source inspection.

Prefix: `FR-CLOSURE-*`

---

## Scope

The most KPI-critical workflow in the MVP: marking a post as delivered. Two paths (with recipient / without), a multi-step dialog, statistics propagation, the reopen mechanism, and the recipient's ability to un-mark themselves.

Successful closures contribute to the north-star metric across giving worlds; see [16 KPIs](../16_kpis.md). This is not the only domain that changes that metric.

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
- AC5. On "Mark and Close": post status moves to `closed_delivered`; the named member is represented by a `post_handoffs` row in `handed_over` (D19). The former separate `Recipient` row is superseded by the baseline handoff record.
- AC6. On "Close without marking": post status moves to `deleted_no_recipient` with `post_closures.purge_after = now() + 7 days`. It is refused while an active handoff must be settled first (D104); world-specific exceptions are in FR-CLOSURE-011.
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
   - The completed single-taker handoff is cancelled with reason `reopened`; the handoff history is retained, not deleted. The separate `Recipient` table is legacy terminology.
   - The recipient's `items_received_count` decrements by 1 (`D-6`).
   - **No** push notification is sent to the recipient (`D-6`); they observe the change passively when they next view their closed-posts tab.
- AC4. If the post was `deleted_no_recipient` and within the grace window, reopening cancels the scheduled deletion (`bg-job-soft-delete-cleanup`).
- AC5. The owner's `items_given_count` decrements by 1 to keep totals consistent.
- AC6. There is no upper bound on reopen count; however, after 5 reopens a `Suspect` flag is raised (`R-MVP-Items-7`), surfacing the post for admin review (`FR-MOD-008`).
- AC7. When reopen completes successfully from **post detail**, the client shows a short success toast and navigates back (same shell behavior as FR-CLOSURE-001 AC5), after list caches are refreshed.

**Edge Cases.**
- The post was `removed_admin`: cannot be reopened (only the Super Admin may restore it via `FR-ADMIN-002`).
- The post is past the 7-day grace window of `deleted_no_recipient`: it has been hard-deleted; "Reopen" is no longer available.
- The recipient has since deleted their account: the requirement remains that reopen works without decrementing a non-existent user. This historical guarantee has not been reverified against the current handoff/account-deletion model in this checkpoint.
- An expired post is never reopened: the owner republishes a new post with date fields cleared (D127, D130).

**Related.** Screens: 6.5 · Domain: `Post`, `Recipient`, `Statistic`.

---

## FR-CLOSURE-006 — Recipient receives a one-time educational notification

**Description.**
The recipient (when marked) is informed about being credited.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section א).
- Decisions: `D-5`.

**Acceptance Criteria.**
- AC1. On creation of an already handed-over recipient mark, a `mark_recipient` notification (`FR-NOTIF-009`), Critical category, must reach the recipient. Current code queues the notification; enqueue alone does not verify this delivery requirement.
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
   - The single-taker `giving_handoff` recipient mark is cancelled with reason `unmarked`; its history is retained.
   - The marked member's receipt counter is reversed.
   - **Historical owner-counter rule, not current behavior:** the earlier AC required decrementing the owner's given count. Current baseline tests explicitly retain the delivery in the owner's count. This conflict is pending PM confirmation in the closure checkpoint of `92_open_questions.md`; this docs edit authorizes no counter change.
   - The `unmark_recipient` notification, Critical category, must inform the owner (FR-NOTIF-010). Current code queues it; delivery is not established here. The old FR-NOTIF-013 cross-reference was incorrect: that requirement is the absence of an owner-reopen notification.
   - The post transitions to `deleted_no_recipient` with `post_closures.purge_after = now() + 7 days`. The earlier statement that it also remains `closed_delivered` is superseded as internally contradictory. A valid next step must follow the current status machine; do not infer that this closed state permits the open-post recipient picker without reopening.
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
- AC3. Counters are server-owned projections in `user_stats`, updated by post/handoff triggers and checked by server recomputation. Application use cases request operations; they do not own or directly write the database projection logic (D19).
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
- AC9. A time-world (volunteering) post, offer or request, is never "delivered": the button reads «ההתנדבות התקיימה ✓» / "Volunteering took place ✓", and the confirmation, picker and explainer speak of the volunteering taking place (#2078, D141). The member's activity timeline (FR-STATS-003) words the close and the marks as volunteering too (`0742` returns each row's world). The stored status stays `closed_delivered`; the status badge already reads «הושלם». An organization's event ends through its own bar (G18).
- AC10. Every giving world words the post detail chrome in its own language (#2539): the screen title (e.g. «פרטי המשרה» / "Job details" for employment), the owner close action (employment «המשרה אוישה ✓», knowledge «השיעור התקיים ✓», food, money, medical, challenges each have their own; items keep «לסמן כנמסר ✓»), the reopen label (item wording only for items), the closed pill (e.g. «אוישה» / "Filled") and the photo placeholder icon (employment: briefcase). A world with no wording of its own (democracy, unknown) reads the generic «פרטי הפוסט» / «לסמן כהושלם ✓». The request side of employment reads «מצאתי עבודה ✓». Stored statuses and the close RPCs are unchanged.

**Related.** Screens: listing post detail, My listings, ride bookings, housing host, animal handoff. RPC: `0658_owner_complete_offer_with_user`.

---

## FR-CLOSURE-010 — Suspect flag at 5+ reopens

**Description.**
A post that has been reopened 5 or more times triggers a moderation flag.

**Source.**
- Constraints: `R-MVP-Items-7`.

**Acceptance Criteria.**
- AC1. Each successful reopen increments the internal `post_closures.reopen_count` (legacy `Post.reopen_count` terminology is superseded).
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
| 0.4 | 2026-11-21 | FR-CLOSURE-011 AC10: per-world detail title, close / reopen wording, closed pill and placeholder icon (#2539). |

| 0.5 | 2026-11-24 | #1850 partial reconciliation: baseline handoff/closure records, explicit unmark conflict, current server ownership, expired-post rule, and unverified acceptance boundaries. No runtime change or blanket completion claim. |
