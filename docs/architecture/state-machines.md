# State machines — inventory and migration onto the FSM kernel

> **Status:** 2026-11-09. Wave 0 shipped (kernel + admin-task pilot, `0680`). Gap `{{G:fsm-kernel-lifecycles}}`.
> **Kernel design:** [`docs/superpowers/specs/2026-11-09-fsm-kernel-design.md`](../superpowers/specs/2026-11-09-fsm-kernel-design.md).
> **Rule:** a lifecycle has **one** graph. It is declared in `@kc/domain` (`app/packages/domain/src/fsm/machines/`), mirrored row-for-row in `fsm_state` / `fsm_edge` (locked by the contract test), and enforced in Postgres by `fsm_assert_transition` from the RPC and from a `before update of status` trigger. No other copy of the move list may exist: not a SQL `case`, not a TS record, not a UI condition.

## 1. Why

The app has ~35 lifecycles. Before the kernel, each one had its legal moves written two to five times: a SQL `check`, a hard-coded trigger or `if` in each RPC, one or more TypeScript unions or transition records, and UI conditions that decide which buttons show. The inventory below found those copies disagreeing in almost every machine that has more than one writer. Each divergence is a latent bug: an RPC that raises on a state the graph allows, a button that calls an RPC that refuses, a state no code ever writes, a TS graph that no production code reads.

The posts ↔ listings gap (G1) is the largest case: three machines (`posts.status`, `listings.status`, `post_handoffs.status` with its legacy `giving_handoffs` twin) describe one product object, joined by a lossy mapping (`listing_status_for_post`, `0554`).

## 2. How a machine moves onto the kernel

Per design spec §4.1, one PR per machine (or per tight family), each with code + spec section + automated test:

1. Settle the graph with the product book. List every writer (the **latest** `create or replace` of each RPC / trigger / sweep) and every TS / UI copy. Open product questions go to the PM before code.
2. Declare the machine in `@kc/domain` with roles where callers differ (`owner`, `recipient`, `admin`, `system`), register it in `FSM_MACHINES`.
3. One migration in the `0680–0689` range (then the next claimed range): catalog `insert` rows; every writer calls `fsm_assert_transition` and maps codes to its existing client codes; a `before update of status` trigger replaces any hand-written transition trigger.
4. Delete every other copy: SQL `case` lists, TS transition records, UI conditions (the UI asks `canTransition`).
5. Tests: domain graph test, the contract test (automatic), a `supabase/tests/NNNN_*.sql` file covering every writer's legal and illegal moves, and a regression test per divergence fixed.

**Out of the kernel** (design spec §2): side effects (karma, notifications, audit) stay in the writer after the legal move; predicates that read other rows (seats, expiry, active handoff) stay in the writer or trigger before the kernel call; derived and composite states (§5) are not edge lists.

## 3. Inventory

"Copies" counts the places that encode the states or the moves today. "Wave" is the order in §6.

### 3.1 Giving content (posts, listings, handoffs)

| Machine | Stored in | States | Copies today | Enforcement today | Wave |
|---|---|---|---|---|---|
| **Post (S1)** | `posts.status` | open, paused, closed_delivered, deleted_no_recipient, expired, hidden_pending_review, removed_admin | SQL check (`0551`), trigger `posts_enforce_status_fsm` (`0665`), TS `POST_STATUS_TRANSITIONS` (`domain/src/posts.ts`, tests only), 15+ writer RPCs and sweeps, owner action bars | one hand-written trigger + per-RPC `where` filters | **1** |
| Post admin-removal memory | `posts.status_before_admin_removal` | open, closed_delivered, deleted_no_recipient | SQL check (`0097`) | check only | 1 (with S1) |
| **Handoff** (items, food, animals) | `post_handoffs.status` | reserved, confirmed, handed_over, cancelled, no_show | SQL check (`0564`), TS `canTransitionGivingHandoff` (tests only), ~25 writer RPCs and sweeps | per-RPC filters, no trigger | **2** |
| **Ride booking** | `post_handoffs.status` (world `rides`) | reserved, confirmed, handed_over, cancelled | TS `isValidRideBookingTransition`, `canReinstateRideBooking`, ride RPCs (`0624`, `0649`, `0655`) | per-RPC filters | **2** |
| **Housing booking** | `post_handoffs.status` (world `housing`) | reserved, confirmed, handed_over, cancelled, no_show | TS `housingStayRules.ts`, housing RPCs (`0610`, `0622`, `0666`) | per-RPC filters + time windows | **2** |
| **Event registration** | `post_handoffs.status` (world `time`) | waitlisted, reserved, confirmed, handed_over, cancelled, no_show | TS `EVENT_REGISTRATION_STATUSES`, event RPCs (`0564`) | per-RPC filters | **2** |
| Knowledge session | `post_handoffs.status` (world `knowledge`) | reserved, confirmed, handed_over, cancelled | knowledge RPCs (`0622`) | per-RPC filters | **2** |
| Content moderation | `posts.moderation_status`, `listings.moderation_status` | draft, pending_review, published, rejected | SQL checks (`0242`, `0626`) | insert-time default only | 4 |
| Ride series | `ride_series.status` | active, paused, cancelled | SQL check (`0531`), `set_ride_series_status` (`0666`) | none (any move) | 6 |
| Listing (legacy) | `listings.status` | open, closed, cancelled, expired, removed_admin, hidden_pending_review | SQL check (`0468`), lossy map from S1 (`0554`) | — | **retire with G1** |
| Handoff (legacy) | `giving_handoffs.status` | as `post_handoffs` minus waitlisted | SQL check (`0380`) | — | **retire with G1** |
| Ride listing / participants / templates (legacy) | `ride_listings`, `ride_participants`, `ride_templates` | 6 / 4 / 3 states | SQL checks (`0177`, `0139`, `0148`), TS use cases | — | **retire (G44)** |

### 3.2 People, social, safety

| Machine | Stored in | States | Copies today | Enforcement today | Wave |
|---|---|---|---|---|---|
| **Admin task** | `admin_tasks.status` | open, in_progress, blocked, done, archived | kernel only | `fsm_assert_transition` (RPC + trigger) | **0 ✅** |
| **Account status** | `users.account_status` (+ `account_status_until`, `deletion_purge_at`, `status_before_deletion`) | pending_verification, active, suspended_for_false_reports, suspended_admin, banned, pending_deletion, deleted | SQL check (`0549`), TS `AccountStatus` (`value-objects.ts`), `AccountGateReason`, `AccountGateRejectionReason`, 3 mobile lists, 9 definer writers + 2 crons | per-writer filters | **3** |
| **Onboarding** | `users.onboarding_state` | pending_basic_info, pending_avatar, completed | SQL check (`0001`), TS `value-objects.ts`, 3 use cases, `AuthGate.tsx` | TS use cases only | **3** |
| **Report** | `reports.status` | open, confirmed_violation, dismissed_no_violation | SQL check + trigger (`0005`), TS `value-objects.ts`, `ReportCaseDetail.ts` | hand-written trigger | **4** |
| **Follow request** | `follow_requests.status` | pending, accepted, rejected, cancelled | SQL check (`0003`), TS `value-objects.ts`, infra `followRequestMethods.ts` | RLS policies only | **4** |
| Chat message | `messages.status` | pending, delivered, read | SQL check + trigger (`0004`), TS `value-objects.ts` | hand-written trigger | 7 |

### 3.3 Organizations, volunteering, money, automation

| Machine | Stored in | States | Copies today | Enforcement today | Wave |
|---|---|---|---|---|---|
| **Review queue** (one shape, four tables) | `org_applications`, `bot_admin_review_items`, `claim_requests`, `donation_links.review_status` | pending, approved, rejected | SQL checks; `donation_links` guard trigger (`0546`) | reviewer RPCs; one guard trigger | **4** |
| **Volunteer opportunity** | `volunteer_opportunities.status` | draft, open, closed, cancelled | SQL check (`0370`), RPCs (`0371`, `0379`) | RPC filters | **5** |
| **Shift signup** | `volunteer_shift_signups.status` | registered, waitlisted, checked_in, cancelled, no_show | SQL check (`0370`), RPCs (`0373`, `0374`) | RPC filters | **5** |
| **Timesheet entry** | `timesheet_entries.status` | draft, submitted, approved, rejected | SQL check + RPCs (`0171`), TS `TimesheetEntry.ts` | RPC filters | **5** |
| **Donation intent** | `donation_intents.status` | created, checkout, paid, failed, cancelled | SQL check (`0268`), RPC (`0362`), TS `PaymentTypes.ts` | RPC filters | **6** |
| **Payment / refund / payout** | `payments`, `payment_refunds`, `payment_payouts` | pending, succeeded, failed, refunded / pending, succeeded, failed / pending, paid, failed | SQL checks (`0268`, `0269`) | upsert only | **6** |
| **Standing order** | `standing_orders.status` | active, paused, cancelled | SQL check (`0269`), RPCs (`0363`, `0365`) | RPC filters | **6** |
| KYC profiles | `payer_kyc_profiles`, `payment_recipients_kyc` | none, pending, approved, rejected | SQL checks (`0267`) | no writer yet | 6 |
| Finance ledger entry | `finance_ledger_entries.status` | pending, cleared, canceled | SQL check (`0170`), TS `FinanceLedger.ts` | none (any move) | 6, with FR-FIN reconcile |
| Webhook event | `provider_webhook_events.status` | pending, processed, failed | SQL check (`0270`) | insert → processed | 6 |
| **WhatsApp outbound** | `bot_outbound_messages.status` | queued, sending, sent, failed, skipped_* (6) | SQL check (`0306`), worker RPCs (`0306`, `0307`), admin RPCs (`0308`), admin screen filter | RPC filters | **7** |
| **WhatsApp bot session** | `bot_conversation_sessions.state` | collecting, confirm, published, idle | SQL check + RPCs (`0302`) | partial RPC filters | **7** |
| WhatsApp template review | `bot_message_templates.meta_status` (+ `is_approved`) | draft, submitted, approved, rejected, paused, deprecated | SQL check (`0307`) | seeding only | 7 |
| Challenge | `challenges.status` (+ `ends_at`) | active, ended | SQL check (`0594`), TS `ChallengeTypes.ts`, `end_challenge` (`0639`) | RPC | off (§5) |

## 4. Divergences found (verified in code, 2026-11-09)

Each item is a task for the wave that owns the machine; the fix ships with a regression test that fails before it.

**Post (S1)**
- TS `POST_STATUS_TRANSITIONS` rejects a same-status move; the SQL trigger treats it as a no-op. The TS graph has no production caller.
- Spec `07_cross_cutting_systems.md` §7.1 lists no `paused` state and allows reopen only from `closed_delivered` / `expired`; code also reopens `deleted_no_recipient` and restores `removed_admin` → `open`.
- `admin_remove_post` (`0452`) refuses `paused` and `expired`; the trigger allows both into `removed_admin`.
- `admin_remove_listing` (`0666`) stores `paused` / `expired` into `status_before_admin_removal`, whose check (`0097`) rejects them, so the call fails on those posts.
- `admin_restore_target` (`0666`) always restores to `open` (ignores `status_before_admin_removal`) and keeps a branch on `moderation_status = 'held'`, a value the check does not allow.
- `mark_giving_handed_over` (`0666`) writes `closed_delivered` without a source-status filter and raises on `expired` / `removed_admin` posts.
- `expired → open` is in the graph but no RPC performs it; the expired screen calls `rpc_republish_post` (`0155`), which clones only the legacy item columns (no `world_slug`, `details`, `kind_id`).
- Items get `expires_at = now() + 30 days` (`0612`, `0666`) while D21 says items never expire and no sweep expires them: after 30 days a paused item cannot resume and never expires.
- Pause / fulfill / delete RPCs (`0666`) count `time` (event) handoffs as active; the trigger (`0665`) excludes them.
- Two `owner_complete_offer_with_user` overloads coexist (`0658` with `p_mode`, `0666` without) with different handoff and karma behaviour; the app calls the `0658` one.
- Events never move to `expired` at their date; only food, rides and ride series have expiry writers.

**Listings (G1 gap)**
- `listing_status_for_post` (`0554`) maps `paused → cancelled` and both `closed_delivered` and `deleted_no_recipient → closed`; the reverse direction cannot be reconstructed.
- `owner_offer_set_status` (`0658`) closes the listing but leaves a listing-sourced mirror post `open` since the sync triggers were dropped (`0666`).
- `my-listings.tsx` shows Delete for `closed`, which includes `deleted_no_recipient`; `delete_my_listing` refuses that state.

**Handoffs**
- Four TS copies disagree: `canTransitionGivingHandoff` forbids `reserved → handed_over`, `isValidRideBookingTransition` allows it; neither has `waitlisted`, `confirmed → no_show`, `no_show → handed_over` (event attendance, `0564`) or `cancelled → reserved` (ride reinstate, `0655`), all of which SQL performs.
- `cancel_giving_handoff` (`0666`) accepts event registrations without promoting the waitlist (`event_promote_waitlist`), and resets `availability_status` for items and food but not animals.
- Items, animals and knowledge reservations get `confirm_by = +24h`, but only rides and housing sweep on it; a stale reservation never lapses and blocks pause / fulfill / delete.
- `rides_expired_listings_sweep` (`0624`) expires the ride post but leaves its reserved / confirmed bookings live; the food sweep cancels them.

**Account and onboarding**
- `pending_deletion` exists in SQL (`0549`) and is missing from TS `AccountStatus`, `AccountGateRejectionReason`, the admin user filter and its locale labels; `AccountGateReason` lacks `pending_verification` and `deleted`.
- The check `users_pending_deletion_purge_chk` (`0549`) ties `pending_deletion` to `deletion_purge_at`; `admin_ban_user` (`0037`), the report auto-suspend trigger (`0452`) and the false-report sanctions trigger (`0039`) move a `pending_deletion` user without clearing it, so each raises `23514` — for the auto-suspend that fails the reporter's report insert.
- `deleted` is a dead state (no writer); the gate shows it with the "banned" copy.
- No RPC moves `banned → active`; spec `12_super_admin.md` assumes a manual unban.
- `admin_dismiss_report` (`0118`) lifts a suspension when fewer than 3 reports are open; auto-suspension uses 5. Neither restore nor auto-suspend resets `account_status_until`.
- `handle_user_verified` (`0068`) acts only from `pending_verification`; restoring a user who verified while `pending_deletion` returns them to `pending_verification`.
- `CompleteOnboardingUseCase` rejects `pending_basic_info → completed`; `ReconcileDeferredBasicInfoUseCase` performs it.

**Social and moderation**
- `messages.status = 'delivered'` is never written; `rpc_chat_mark_read` (`0055`) goes straight to `read`.
- The report dismiss cascade (`0118`) restores a post only from `removed_admin`, while auto-moderation now hides with `hidden_pending_review` (`0452`).

**Organizations, volunteering, money, automation**
- Timesheets: the UI offers delete only for `draft`; the RPC (`0171`) also deletes `rejected`.
- `close_volunteer_opportunity` (`0379`) has no from-guard; the UI shows Close in every status. `cancelled` and shift `no_show` have no writer; the my-shifts screen labels unknown statuses as "registered".
- Money vocabularies split: the intent says `paid`, the payment `succeeded`; the ledger spells `canceled`, every other table `cancelled`. `created` (intent) is accepted but never written. Refund, payout and KYC statuses have no writer. `cancel_standing_order` re-stamps an already cancelled order.
- The finance ledger upsert (`0470`) allows any move, including out of `cleared`; spec `19_org_finance.md` says reconciled entries are frozen.
- WhatsApp: the admin screen offers Resend for every `skipped_*`; the RPC (`0308`) accepts three of six. The bot session re-enters `confirm` from `published` (`0302`), and `idle` has no writer. Template sends read `is_approved` and never `meta_status`.
- Match v1 `listing_matches` (`0303`) accepts on one side's response; v2 `match_candidates` requires both.

## 5. Not edge lists — kept off the kernel

| Model | Why | Where |
|---|---|---|
| Match candidate | composite: `status` + `offer_response` + `request_response`; needs its own spec | `match_candidates` (`0420`, `0635`) |
| WhatsApp consent | composite: identity `consent_status` + per-user boolean | `0303`, `0305` |
| Pro entitlement | derived: `active` + `expires_at` + `source` | `user_entitlements` (`0430`, `0439`) |
| Challenge "ended" | derived: `status = 'ended'` or `ends_at <= now()` | `0594`, `0639` |
| Verification level | derived by trigger from columns | `0637` |
| Notification outbox / inbox | derived from `dispatched_at`, `attempts`, `read_at` | `0056`, `0255` |
| Admin role grant, org membership, blocks, mutes | row existence / `revoked_at` | `0442`, `0264`, `0281` |
| Feed exposure | boolean `feed_hidden` | `0557`, `0624` |
| CRM contact status | free label, any move by design | `0169` |
| Survey completion, ops health check | computed on read | `0130`, `0463` |
| Translation, closure sheet, draft hydration | client step lists; pure helper only, no SQL catalog (design spec §2 item 10) | mobile |

## 6. Waves (execution order)

One PR per row. Each wave starts only after the previous one is merged, so the catalog contract stays green on `dev`.

| Wave | Machines | Why this order |
|---|---|---|
| 0 ✅ | Kernel, admin task | Infrastructure + a pilot with no product change |
| 1 | Post S1 (roles owner / recipient / admin / system), `status_before_admin_removal` | One graph already agreed in TS and SQL; one trigger to replace; fixes the S1 items in §4; prerequisite for G1 step 6d (drop `listings`) |
| 2 | Handoffs as five machines on one table (`item_handoff`, `ride_booking`, `housing_booking`, `event_registration`, `knowledge_session`), one `before update` trigger choosing the machine by `world_slug`; reservation-expiry sweep | Most writers and most divergences; TS copies collapse to the kernel |
| 3 | Account status (+ composite invariant check beside the kernel call), onboarding | Many writers, failing checks, drifted unions |
| 4 | Reports, follow requests, review-queue family, content moderation | Small graphs; replaces hand-written triggers and RLS-only edges |
| 5 | Volunteer opportunity, shift signup, timesheets | First role-heavy graphs outside giving |
| 6 | Money (intent, payment, refund, payout, standing order, KYC), ride series, finance ledger | Before the real payment provider webhook lands |
| 7 | WhatsApp outbound and session, template review, chat message | Service-only, lowest risk |
| — | `listings`, `giving_handoffs`, `ride_listings`, `ride_participants`, `ride_templates`, `listing_matches` | Retire with G1 / G44 / matching v2, never port |

## 7. Product questions for the PM (block the wave that owns them)

1. **Items TTL (wave 1).** D21 says items never expire, yet items carry a 30-day `expires_at`. Drop the TTL for items, or add an item expiry sweep?
2. **Reopen an expired post (wave 1).** Real `expired → open` with a new date, or keep "republish" as a new post (and fix its clone)?
3. **Events at their date (wave 1).** `open → expired` when the event starts or ends?
4. **Unban (wave 3).** Is `banned → active` an admin edge, and who may take it?
5. **Suspension lift threshold (wave 3).** One number for suspend and lift (5 distinct reporters?).
6. **`delivered` chat state (wave 7).** Write it from the client receipt, or drop it?
7. **Money vocabulary (wave 6).** One word for a completed payment (`paid` or `succeeded`) and `cancelled` everywhere.
