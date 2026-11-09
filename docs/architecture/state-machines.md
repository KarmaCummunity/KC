# State machines — inventory and migration onto the FSM kernel

> **Status:** 2026-11-09. Waves 0, 1a, 1b-i … 1b-iv, 1d, 2 and 2b ✅ (`0680`–`0686`, `0694`, `0695`; post S1 and the four handoff machines on the kernel). Next: 1c, 3. Gap `G61`.
> **Kernel design:** [`docs/superpowers/specs/2026-11-09-fsm-kernel-design.md`](../superpowers/specs/2026-11-09-fsm-kernel-design.md).
> **Rule:** a lifecycle has **one** graph. It is declared in `@kc/domain` (`app/packages/domain/src/fsm/machines/`), mirrored row-for-row in `fsm_state` / `fsm_edge` (locked by the contract test), and enforced in Postgres by `fsm_assert_transition` from the RPC and from a `before update of status` trigger. No other copy of the move list may exist: not a SQL `case`, not a TS record, not a UI condition.

## 1. Why

A second, mechanical sweep (2026-11-09: every closed-set column, timestamp- or boolean-derived state, client state type, pg_cron job and queue) counts 67 server-side lifecycles (47 stored, 20 derived) and 26 client-side machines; §3 lists the stored ones, §3.4 the background workers, §3.5 the client machines, §5 the derived ones. Before the kernel, each one had its legal moves written two to five times: a SQL `check`, a hard-coded trigger or `if` in each RPC, one or more TypeScript unions or transition records, and UI conditions that decide which buttons show. The inventory below found those copies disagreeing in almost every machine that has more than one writer. Each divergence is a latent bug: an RPC that raises on a state the graph allows, a button that calls an RPC that refuses, a state no code ever writes, a TS graph that no production code reads.

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
| **Post (S1)** | `posts.status` | open, paused, closed_delivered, deleted_no_recipient, expired, hidden_pending_review, removed_admin | kernel (`postMachine`, `0681`) + SQL check (`0551`); 15+ writer RPCs and sweeps still filter by status; owner action bars | `fsm_assert_transition` in the `posts_status_fsm` trigger | **1a ✅** / 1b |
| Post admin-removal memory | `posts.status_before_admin_removal` | open, paused, closed_delivered, deleted_no_recipient, expired | SQL check (`0682`) | written by `admin_remove_post` / `admin_remove_listing`, read and cleared by `admin_restore_target` (`0682`) | **1b-i ✅** |
| **Handoff** (items, food, animals) | `post_handoffs.status` | reserved, confirmed, handed_over, cancelled, no_show | kernel `givingHandoffMachine` (`0694`), SQL check (`0564`), ~25 writer RPCs and sweeps, the `giving_handoffs` view's `instead of update` trigger (`0667`) | `fsm_assert_transition` in the `post_handoffs_status_fsm` trigger (`0694`); RPCs keep their predicates | **2 ✅** |
| **Ride booking** | `post_handoffs.status` (world `rides`) | reserved, confirmed, handed_over, cancelled | kernel `rideBookingMachine` (`0694`), `canPerformBookingAction` / `rideReinstateBlocker` (2b), ride RPCs (`0624`, `0649`, `0655`) | `fsm_assert_transition` in the `post_handoffs_status_fsm` trigger (`0694`); RPCs keep their predicates | **2 ✅** |
| **Housing booking** | `post_handoffs.status` (world `housing`) | reserved, confirmed, handed_over, cancelled, no_show | TS `housingStayRules.ts`, housing RPCs (`0610`, `0622`, `0666`) | `fsm_assert_transition` in the `post_handoffs_status_fsm` trigger (`0694`); RPCs keep their predicates | **2 ✅** |
| **Event registration** | `post_handoffs.status` (world `time`) | waitlisted, reserved, confirmed, handed_over, cancelled, no_show | TS `EVENT_REGISTRATION_STATUSES`, event RPCs (`0564`) | `fsm_assert_transition` in the `post_handoffs_status_fsm` trigger (`0694`); RPCs keep their predicates | **2 ✅** |
| Knowledge session | `post_handoffs.status` (world `knowledge`) | reserved, confirmed, handed_over, cancelled | knowledge RPCs (`0622`) | `fsm_assert_transition` in the `post_handoffs_status_fsm` trigger (`0694`); RPCs keep their predicates | **2 ✅** |
| Post availability | `posts.availability_status` | immediate, scheduled, ongoing | SQL check (`0626`); reserve / claim → scheduled, cancel and no-show sweep → immediate (items and food), handed over / pause / owner complete → ongoing (`0666`, `0667`) | no from-guards | 2 (moves with the handoff) |
| Content moderation | `posts.moderation_status` (the `listings` column is a view column since `0667`) | draft, pending_review, published, rejected | SQL check (`0626`); read by `operator_case_enqueue_for_post` | insert-time default only; no update writer | 4 |
| Ride series | `ride_series.status` | active, paused, cancelled | SQL check (`0531`), `set_ride_series_status` (`0666`) | none (any move) | 6 |
| Listing (legacy) | `listings` view over `posts` since `0667` | derived from S1: paused / deleted_no_recipient → cancelled, closed_delivered → closed | the view and its `instead of` trigger (`0667`) | no own state | **retired ✅ (`0667`)** |
| Handoff (legacy) | `giving_handoffs` view over `post_handoffs` since `0667` | as `post_handoffs` | the view (`0667`) | no own state | **retired ✅ (`0667`)** |
| Ride listing / participants / templates (legacy) | `ride_listings`, `ride_participants`, `ride_templates` | 6 / 4 / 3 states | SQL checks (`0177`, `0139`, `0148`), TS use cases | their pg_cron jobs are retired (`0695`) | **1d ✅**, then retire the tables (G44) |

### 3.2 People, social, safety

| Machine | Stored in | States | Copies today | Enforcement today | Wave |
|---|---|---|---|---|---|
| **Admin task** | `admin_tasks.status` | open, in_progress, blocked, done, archived | kernel only | `fsm_assert_transition` (RPC + trigger) | **0 ✅** |
| **Account status** | `users.account_status` (+ `account_status_until`, `deletion_purge_at`, `status_before_deletion`) | pending_verification, active, suspended_for_false_reports, suspended_admin, banned, pending_deletion | SQL check (`0549`, `deleted` dropped in `0699`), TS `AccountStatus` (`value-objects.ts`), `AccountGateReason`, `AccountGateRejectionReason`, 3 mobile lists, 9 definer writers + 2 crons | per-writer filters | **3** |
| **Onboarding** | `users.onboarding_state` | pending_basic_info, pending_avatar, completed | SQL check (`0001`), TS `value-objects.ts`, 3 use cases, `AuthGate.tsx` | TS use cases only | **3** |
| **Report** | `reports.status` | open, confirmed_violation, dismissed_no_violation | SQL check + trigger (`0005`), TS `value-objects.ts`, `ReportCaseDetail.ts` | hand-written trigger | **4** |
| **Follow request** | `follow_requests.status` | pending, accepted, rejected, cancelled | SQL check (`0003`), TS `value-objects.ts`, infra `followRequestMethods.ts` | RLS policies only | **4** |
| Chat message | `messages.status` | pending, delivered, read | SQL check + trigger (`0004`), TS `value-objects.ts` | hand-written trigger | 7 |
| Post comment | `post_comments.status` | active, deleted | SQL check (`0250`), `rpc_delete_post_comment` (`0251`) | RPC; no restore, no admin path | 4 |
| Knowledge topic | `knowledge_topics.status` (+ `merged_into_id`) | proposed, active, merged | SQL check (`0570`), propose / review / merge RPCs (`0570`) | RPCs; approve has no from-guard; `merged` ⇔ `merged_into_id` set | 4 |

### 3.3 Organizations, volunteering, money, automation

| Machine | Stored in | States | Copies today | Enforcement today | Wave |
|---|---|---|---|---|---|
| **Review queue** (one shape, four tables) | `org_applications`, `bot_admin_review_items`, `claim_requests`, `donation_links.review_status` | pending, approved, rejected | SQL checks; `api_bot_admin_review_resolve` (`0304`); `donation_links` guard trigger (`0546`) sends an edited link back to `pending`; `claim_requests` has no reviewer RPC; `donation_links.hidden_at` (`0014`) is dead since removal became a delete (`0050`) | reviewer RPCs; one guard trigger | **4** |
| **Volunteer opportunity** | `volunteer_opportunities.status` | draft, open, closed, cancelled | SQL check (`0370`), RPCs (`0371`, `0379`) | RPC filters | **5** |
| **Shift signup** | `volunteer_shift_signups.status` | registered, waitlisted, checked_in, cancelled, no_show | SQL check (`0370`), RPCs (`0373`, `0374`) | RPC filters | **5** |
| **Timesheet entry** | `timesheet_entries.status` | draft, submitted, approved, rejected | SQL check + RPCs (`0171`), TS `TimesheetEntry.ts` | RPC filters | **5** |
| **Donation intent** | `donation_intents.status` | created, checkout, paid, failed, cancelled | SQL check (`0268`), `complete_sandbox_donation` (`0690`, behind the `sandbox_payments` flag, wrapping the `0362` body), TS `PaymentTypes.ts` | RPC filters | **6** |
| **Payment / refund / payout** | `payments`, `payment_refunds`, `payment_payouts` | pending, succeeded, failed, refunded / pending, succeeded, failed / pending, paid, failed | SQL checks (`0268`, `0269`) | upsert only | **6** |
| **Standing order** | `standing_orders.status` | active, paused, cancelled | SQL check (`0269`), RPCs (`0363`, `0365`); the `subscriptions-charger` worker reads due orders and writes nothing (stub, no schedule) | RPC filters | **6** |
| KYC profiles | `payer_kyc_profiles`, `payment_recipients_kyc` | none, pending, approved, rejected | SQL checks (`0267`) | no writer yet | 6 |
| Finance ledger entry | `finance_ledger_entries.status` | pending, cleared, canceled | SQL check (`0170`), TS `FinanceLedger.ts` | none (any move) | 6, with FR-FIN reconcile |
| Webhook event | `provider_webhook_events.status` | pending, processed, failed | SQL check (`0270`), `payments-webhook` | insert → processed; `failed` has no writer | 6 |
| **WhatsApp outbound** | `bot_outbound_messages.status` | queued, sending, sent, failed, skipped_* (6) | SQL check (`0306`), worker RPCs (`0306`, `0307`), admin RPCs (`0308`), admin screen filter; the `whatsapp-sender` worker has no schedule in the repo | RPC filters | **7** |
| **WhatsApp bot session** | `bot_conversation_sessions.state` | collecting, confirm, published, idle | SQL check + RPCs (`0302`) | partial RPC filters | **7** |
| WhatsApp template review | `bot_message_templates.meta_status` (+ `is_approved`) | draft, submitted, approved, rejected, paused, deprecated | SQL check (`0307`) | seeding only | 7 |
| Challenge | `challenges.status` (+ `ends_at`) | active, ended | SQL check (`0594`), TS `ChallengeTypes.ts`, `end_challenge` (`0639`) | RPC | off (§5) |
| Match v1 | `listing_matches.status` | suggested, operator_queue, dismissed, accepted | SQL check (`0260`), `find_matches` (`0260`), `api_bot_record_match_response` (`0303`) | upsert; a re-run puts accepted / dismissed back to suggested | retire (matching v2) |
| Embedding job | `embedding_jobs.status` | pending, processing, done, failed | SQL check (`0244`), posts trigger (`0667`), claim / store / fail RPCs (`0634`) | RPC filters; claim with `skip locked` | 7 |
| Ride route alert | `ride_route_alerts.status` | pending, sent, capped, skipped | SQL check (`0516`), `ride_route_alert_deliver` (`0516`) from a posts trigger and a 10-minute cron | RPC | 7 |
| Operator case | `operator_cases.status` | open, assigned, resolved, cancelled | SQL check (`0263`), posts trigger inserts `open` (`0667`) | insert only; no writer for the other three | 7 (§7 question 5) |
| Ingestion run | `ingestion_runs.status` | running, completed, failed | SQL check (`0246`), `api_whatsapp_ingest_inbound` (`0305`) | inserted as `completed`; `running` and `failed` never written | 7 |
| Entity-resolution candidate | `er_candidates.status` | open, merged, dismissed | SQL check (`0247`), insert (`0304`), `merge_entities` (`0247`) | `merged` is unreachable (the merge deletes the actor first and the cascade removes the row); `dismissed` has no writer | 7 |
| CRM contact | `crm_contacts.status` (+ `deleted_at`) | cold, warm, active, inactive; soft-deleted | SQL check (`0169`), `crm_contact_upsert` / `crm_contact_delete` (`0169`) | any move by design; delete is terminal | off |
| Demo data operation (kc-dev tooling) | `kc_dev_demo_operation_state` (`operation` × free-text `phase`) | idle, seed, wipe × seed and wipe phases | SQL check (`0654`), seed / wipe step RPCs (`0657`) | lease: a row stale for 3 minutes resets to idle | off |

### 3.4 Background workers and queues

Workers that move a machine without a user action. A row names the trigger; the machine itself is in §3.1–§3.3 or §5.

| Worker | Runs from | Moves | Notes |
|---|---|---|---|
| Post expiry | crons: food (`0666`), ride offers and ride-series requests (`0624`), events (`0685`), legacy `ride_listings_expire_check` (`0135`) | S1 open → expired | the legacy cron writes through the `ride_listings` view (§4, background jobs) |
| Post purge | cron `closure_cleanup_daily` (`0016`) | deletes a `deleted_no_recipient` row once `delete_after` (7 days) passes | not an S1 edge: the row leaves the table |
| Handoff sweeps | crons (`0558`, `0610`, `0666`) | reserved → cancelled (`confirm_by`, rides and housing); confirmed → no_show (`pickup_window_end`); housing confirmed → cancelled (`not_completed`); food expiry cancels open handoffs | the no-show sweep has no world filter |
| Account suspension and purge | crons (`0076`, `0549`), `pg_net` → `purge-deleted-accounts` | suspended_for_false_reports → active; pending_deletion → row deleted | ✅ wave 3c (`0699`): the row stays `pending_deletion` until the identity delete cascades it, so every failed step is retried |
| Notification outbox | database webhook (not in migrations), cron `notifications_retry_pending` every minute (`0058`) | pending → dispatched; dead after 3 attempts or 1 hour; deleted after 7 days | no in-flight state; `dispatched_at` is also stamped on a suppressed or failed send |
| Matching v2 | cron `matching_v2_sweep` every 10 minutes (`0635`), posts trigger (`0667`) | match candidate suggested → expired; delivery timestamps | |
| Ride route alerts | posts trigger and a 10-minute cron (`0516`) | pending → sent / capped / skipped | quiet hours keep a row pending |
| Embedding jobs | posts trigger (`0667`), `embed-worker` | pending → processing → done / failed | no schedule in the repo; nothing reclaims a stuck `processing` or retries `failed` |
| Feed cache | pgmq `feed_cache_refresh`, cron every 5 minutes (`0348`); `feed_mv_refresh_state.dirty`, cron every 2 minutes (`0346`) | message visible → invisible (30 s) → deleted; dirty → clean | no retry limit and no dead-letter queue |
| WhatsApp | `whatsapp-sender` over pgmq `whatsapp_outbound` (`0306`); `whatsapp-webhook` claims (`0431`) | outbound queued → sending → sent / failed / skipped_*; inbound claim inserted, released on failure, pruned after 7 days | the sender has no schedule in the repo |

Edge functions with no schedule or caller in the repo: `embed-worker`, `match-rerank`, `whatsapp-sender`, `subscriptions-charger`, `rotate-research-salt` (no schedule); `whatsapp-intake-worker`, `receipts-issuer`, `backfill-image-thumbs` (no caller; the last is run by hand). Their queues drain only if a schedule exists outside the repo.

### 3.5 Client-side machines

Client state that encodes a server machine is a copy (§1 rule): it goes when its wave lands, and the UI asks the kernel's `canTransition` instead. Client-only flows stay local (§5).

| Client machine | Where | Server machine | Today |
|---|---|---|---|
| Post owner actions (mark delivered, reopen, edit, delete) | `OwnerActionsBar.tsx`, `PostMenuSheet.tsx`, `edit-post/[id].tsx`, `ReopenPostUseCase.ts` | Post S1 | hand-written; the kernel helper `canTransitionPostStatus` (`domain/src/posts.ts`) has no production caller |
| My-listings actions | `marketplace/my-listings.tsx` | Post S1 in the listing vocabulary | hand-written |
| Admin post moderation | `lib/moderation/postModeration.ts` | Post S1 (admin edges) | in sync with `0682` |
| Closure flow | `store/closureStore.ts` | Post S1 close | client steps; the store has no from-state guards |
| Item / knowledge handoff actions | `GivingHandoffActions.tsx` | Handoff | inline conditions |
| Ride booking actions | `RideBookingRow.tsx`, `RideBooking.ts` (`canPerformBookingAction`, `canReinstateRideBooking`) | Ride booking | two copies that disagree (complete from reserved) |
| Housing booking actions | `housingStayRules.ts` | Housing booking | in sync, time windows included |
| Event roster actions | `lib/eventPost.ts` (`rosterActionsFor`) | Event registration | in sync |
| Volunteer signup | `my-shifts.tsx` | Shift signup | no check-in window |
| Ride series, standing order, timesheet | `MyRideSeriesList.tsx`, `standing-orders.tsx`, `TimesheetEntryCard.tsx` | Ride series, standing order, timesheet | inline |
| Onboarding routing | `AuthGate.tsx`, three use cases | Onboarding | the only guards (§4) |
| Account gate, delete-account modal | `accountGateDecision.ts`, `DeleteAccountConfirmModal.tsx` | Account status | classification; drifted union (§4) |
| Chat message | `chatStore.ts`, `useChatSend.ts` | Chat message | adds a client-only `failed`; status patches have no order check |
| Match UI | `lib/matching.ts` | Match candidate | narrower, consistent |
| Admin task | `(admin)/tasks/[taskId]` | Admin task | on the kernel ✅ |
| Unused graph copies | `canTransitionGivingHandoff`, `validateGivingHandoffTransition` (`givingHandoff.ts`), `isValidRideBookingTransition` (`RideBooking.ts`) | Handoff, ride booking | tests only or unused: delete in wave 2 |
| Legacy ride types | `RideStatus.ts`, `RideParticipantStatus.ts`, `StartRideUseCase`, `ArriveRideUseCase` | retired ride tables | retire with G44 (wave 1d) |

## 4. Divergences found (verified in code, 2026-11-09)

Each item is a task for the wave that owns the machine; the fix ships with a regression test that fails before it.

**Post (S1)**
- ~~TS `POST_STATUS_TRANSITIONS` and the trigger's `case` list were two copies of the graph.~~ ✅ wave 1a: one kernel machine; the TS helper delegates to it.
- ~~Spec §7.1 listed no `paused` state and reopened from `expired`.~~ ✅ wave 1a: spec reconciled; `expired → open` removed (D127).
- ~~`admin_remove_post` (`0452`) silently skipped `paused` and `expired` posts.~~ ✅ wave 1b-i (`0682`): removes any status; the admin search row offers Remove accordingly.
- ~~`admin_remove_listing` (`0666`) failed on a paused or expired post (the `0097` check rejected the saved status).~~ ✅ wave 1b-i (`0682`): the check covers every removable status.
- ~~`admin_restore_target` (`0666`) always restored to `open`, also "restored" never-removed paused posts, and kept a dead `held` branch.~~ ✅ wave 1b-i (`0682`): restores to the saved status (D129).
- ~~`mark_giving_handed_over` (`0666`) wrote `closed_delivered` without a source-status filter and raised on `expired` / `removed_admin` posts.~~ ✅ wave 1b-ii (`0683`): closes a live post only; the handoff completes either way; a post under review stays hidden. `post_close_from_handoff` (items) no longer writes the `listings` view.
- ~~The expired screen called `rpc_republish_post` (`0155`), which cloned only the legacy item columns.~~ ✅ wave 1b-iii: "Republish" on an expired listing-world post opens the create form prefilled from it, dates cleared (D130). Not yet carried: sub-category and additional worlds (the listing detail does not return them) and a ride's private house numbers. `rpc_republish_post` and its items-only screen stay until a cleanup PR (items no longer expire).
- ~~Items got `expires_at = now() + 30 days` (`0612`, `0666`) although D21 says items never expire; matching v2 skipped them after 30 days and a paused item could not resume.~~ ✅ wave 1b-iii (`0684`): no item expiry; existing defaulted dates cleared.
- ~~Pause / fulfill / delete RPCs (`0666`) counted event registrations as active; the trigger (`0665`) did not.~~ ✅ wave 1b-iv (`0686`): registrations never block; an upcoming event's open registrations are cancelled and attendees notified (D131).
- ~~Two `owner_complete_offer_with_user` overloads coexisted (`0658` with `p_mode`, `0666` without).~~ ✅ wave 1b-ii (`0683`): the unused two-argument overload is dropped.
- ~~Events never moved to `expired`; only food, rides and ride series had expiry writers.~~ ✅ wave 1b-iii (`0685`): `events_expired_sweep` (hourly) expires an open or paused event when its window ends (D128).

**Listings (G1 gap)** — the table is a view over `posts` since `0667`; the items below are history except where marked.
- `listing_status_for_post` (`0554`) maps `paused → cancelled` and both `closed_delivered` and `deleted_no_recipient → closed`; the reverse direction cannot be reconstructed.
- `owner_offer_set_status` (`0658`) closes the listing but leaves a listing-sourced mirror post `open` since the sync triggers were dropped (`0666`).
- `my-listings.tsx` shows Delete for `closed`, which includes `deleted_no_recipient`; `delete_my_listing` refuses that state.

**Handoffs**
- ~~Four TS copies disagree: `canTransitionGivingHandoff` forbids `reserved → handed_over`, `isValidRideBookingTransition` allows it; neither has `waitlisted`, `confirmed → no_show`, `no_show → handed_over` (event attendance, `0564`) or `cancelled → reserved` (ride reinstate, `0655`), all of which SQL performs.~~ ✅ wave 2 (`0694`): four kernel machines by world; the unused TS copies are deleted.
- `cancel_giving_handoff` (`0666`) accepts event registrations without promoting the waitlist (`event_promote_waitlist`), and resets `availability_status` for items and food but not animals.
- Items, animals and knowledge reservations get `confirm_by = +24h`, but only rides and housing sweep on it; a stale reservation never lapses and blocks pause / fulfill / delete.
- `rides_expired_listings_sweep` (`0624`) expires the ride post but leaves its reserved / confirmed bookings live; the food sweep cancels them.
- ✅ wave 1b-ii (`0683`): the generic handed-over step (`mark_giving_handed_over`) serves the four worlds whose screen offers it (items, food, knowledge, animals); rides, housing and events complete through their own RPCs and windows.

**Account and onboarding**
- `pending_deletion` exists in SQL (`0549`) and is missing from TS `AccountStatus`, `AccountGateRejectionReason`, the admin user filter and its locale labels; `AccountGateReason` lacks `pending_verification` and `deleted`.
- The check `users_pending_deletion_purge_chk` (`0549`) ties `pending_deletion` to `deletion_purge_at`; `admin_ban_user` (`0037`), the report auto-suspend trigger (`0452`) and the false-report sanctions trigger (`0039`) move a `pending_deletion` user without clearing it, so each raises `23514` — for the auto-suspend that fails the reporter's report insert.
- ~~`deleted` is a dead state (no writer); the gate shows it with the "banned" copy.~~ ✅ wave 3c (`0699`): not an account status any more; `auth_check_account_gate` keeps an unreachable branch for it.
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

**Handoffs — second sweep (wave 2 design inputs)**
- ~~The `giving_handoffs` view's `instead of update` trigger (`0667`) sets `status` on every update, also when only a time column changes; the wave 2 `before update of status` trigger must accept `old.status = new.status`.~~ ✅ wave 2 (`0694`): the trigger treats a same-status write as a no-op.
- Moves leave end states: cancelled → reserved / confirmed (ride reinstate), no_show → handed_over (event attendance correction). Nothing leaves `handed_over`.
- `cancel_giving_handoff` (`0666`) also cancels event registrations; `mark_giving_handed_over` served rides, housing and events until `0683`.
- Knowledge has no confirm RPC: its `confirmed` is reachable only through the view.
- ~~About 12 test fixtures set handoff statuses directly; wave 2 rewrites them through the RPCs.~~ ✅ wave 2: every fixture move is a legal edge; none needed rewriting.

**Background jobs (wave 1d unless noted)**
- ~~`ride_templates_materialize` (`0148`, daily) inserts through the `ride_listings` view; the unique index that made it idempotent went with the table (`0667`) and the view drops `template_id`, so each active template creates its rides again every night.~~ ✅ wave 1d (`0695`): unscheduled and dropped; ride series replace templates (FR-RIDE-046).
- ~~`ride_listings_expire_check` (`0135`, every 15 minutes) still runs: through the view it expires every ride post 3 hours after departure, requests included, without `ride_post_set_status`, and leaves its bookings live — a fifth expiry writer beside `0624`.~~ ✅ wave 1d (`0695`): unscheduled and dropped; requests never expire (D21).
- ~~`ride_complete_pending_rating_cleanup` (`0177`) and `ride_food_overdue_alert` (`0182`) match no row: the view has no `completed_pending_rating` or `in_transit`, and hard-codes `food_shipping_enabled = false`.~~ ✅ wave 1d (`0695`): unscheduled and dropped.
- ~~`ride_participants_expire_stale_check` (`0151`) joins the view and still writes the retired `ride_participants` table.~~ ✅ wave 1d (`0695`): unscheduled and dropped.
- ~~`food_expired_listings_sweep` (`0666`): the second loop (`legacy_post_id is null`) never matches, and its writes through the views repeat the direct cancel.~~ ✅ wave 1d (`0695`): rewritten on `posts` / `post_handoffs` only.
- `notifications_retry_pending` (`0058`) does not skip when the functions URL is unset (as `0079`, `0080`, `0549` do), and with no in-flight state a minute retry can resend a push (wave 7).
- An embedding job stuck in `processing` is never reclaimed, and a `failed` one is retried only after a text edit (wave 7).

**Client ↔ server (each fixed in the wave that owns the machine)**
- Post menu offers Delete in every status (a hard delete, outside the graph); the delete policy (`0053`) allows only `open`, or `closed_delivered` / `deleted_no_recipient` with no recipient. Paused, expired and delivered-with-recipient posts fail with `post_owner_delete_forbidden`.
- ~~Ride reinstate is offered on the cancel reason alone; the RPC also needs an open post, a ride not departed and a free seat.~~ ✅ wave 2b: `rideReinstateBlocker` applies the RPC's rules and codes.
- ~~"Complete trip" shows on every confirmed booking (the row is not given `departsAt`); the RPC refuses more than 1 hour before departure.~~ ✅ wave 2b: held, with a hint, until an hour before departure.
- ~~Approve counts confirmed and handed-over seats; the RPC counts reserved seats too, so Approve can fail with `ride_seats_exhausted`.~~ ✅ wave 2b: other waiting bookings count too.
- ~~Owner assign in housing and items is not gated on an open post; the RPC refuses with `closure_wrong_status`.~~ ✅ wave 2b: assign shows only on an open listing.
- Volunteer check-in shows for any registration; the RPC allows it only from 2 hours before the shift to 4 hours after.
- Onboarding moves are guarded only in TS use cases (read, then write); the column is client-writable with a check constraint only (wave 3).
- `StartRideUseCase` / `ArriveRideUseCase` are wired but unused; `rpc_ride_start` writes `posts.status = 'in_transit'`, which S1 forbids (retire, wave 1d).
- The client chat renders `pending` and `delivered` alike and cannot show `delivered`; donations model only `paid`, so failed and cancelled intents cannot show.

**Other lifecycles from the second sweep**
- Operator cases: only `open` is ever written; `assigned_operator_id` is never set (§7 question 5).
- Ingestion runs are inserted as `completed`; `running` and `failed` are never written.
- Entity resolution: `merged` is unreachable and `dismissed` has no writer; `undo_merge` stamps `undone_at` without restoring the merged actor.
- Knowledge topics: approve has no from-guard (active → active).
- Match v1: a `find_matches` re-run moves accepted / dismissed back to suggested; the last WhatsApp response wins.
- Ride emergencies: `resolved_at` has no writer.
- WhatsApp consent: the admin block moves to `opted_out` without stamping `consent_updated_at`; only a keyword returns to `opted_in`.

## 5. Not edge lists — kept off the kernel

| Model | Why | Where |
|---|---|---|
| Match candidate | composite: `status` + `offer_response` + `request_response`; needs its own spec | `match_candidates` (`0420`, `0635`) |
| WhatsApp consent | composite: identity `consent_status` + per-user boolean | `0303`, `0305` |
| Pro entitlement | derived: `active` + `expires_at` + `source` | `user_entitlements` (`0430`, `0439`) |
| Challenge "ended" | derived: `status = 'ended'` or `ends_at <= now()` | `0594`, `0639` |
| Verification level | derived by trigger from columns | `0637` |
| Notification outbox / inbox | derived from `dispatched_at`, `attempts`, `created_at`, `read_at` (worker in §3.4) | `0056`, `0058`, `0255` |
| Admin role grant, org membership, blocks, mutes | row existence / `revoked_at` | `0442`, `0264`, `0281` |
| Feed exposure | boolean `feed_hidden` | `0557`, `0624` |
| Survey completion, ops health check | computed on read | `0130`, `0463` |
| Chat removal, per-user inbox hide | timestamps: `chats.removed_at` (report threshold → removed, admin restore → live), `inbox_hidden_at_a` / `_b` (cleared by a new message) | `0033`, `0452`, `0682` |
| Moderation queue entry, report sanction | timestamps: `moderation_queue_entries.resolved_at` (admin update only), `reports.sanction_consumed_at` (stamped once) | `0005`, `0039` |
| Report SLA | computed on read: on_track, warning (12 h), overdue (24 h); hourly alert | `ReportSla.ts`, `0611` |
| Soft deletes | `deleted_at` on `crm_contacts`, `finance_ledger_entries`, `timesheet_entries`: terminal, no restore | `0169`–`0171` |
| Challenge participation, match run, entity merge undo, ride emergency | timestamps (`completed_at` can revert; `finished_at`; `undone_at`; `resolved_at` has no writer) | `0594`, `0260`, `0247`, `0517` |
| Queue messages and claims | pgmq visibility (`feed_cache_refresh`, `whatsapp_outbound`), WhatsApp inbound claim rows, the feed refresh flag (§3.4) | `0306`, `0346`, `0348`, `0431` |
| Device, WhatsApp identity link | booleans / nullable link | `0432` |
| Translation, closure sheet, draft hydration, legal consent gate, push pre-prompt, follow button | client step lists; pure helper only, no SQL catalog (design spec §2 item 10) | mobile |

## 6. Waves (execution order)

One PR per row. Each wave starts only after the previous one is merged, so the catalog contract stays green on `dev`. Each wave also deletes the client copies of its machines (§3.5) and fixes their client ↔ server divergences (§4).

| Wave | Machines | Why this order |
|---|---|---|
| 0 ✅ | Kernel, admin task | Infrastructure + a pilot with no product change |
| 1a ✅ | Post S1 graph on the kernel (`0681`), no roles yet | One graph already agreed in TS and SQL; one trigger to replace; prerequisite for G1 step 6d (drop `listings`) |
| 1b-i ✅ | Admin remove in any status, restore to the previous status, `status_before_admin_removal` (`0682`) | PM decision D129 |
| 1b-ii ✅ | Handoff writers close a post only from `open`; the handed-over step serves its four worlds; one `owner_complete_offer_with_user` (`0683`) | Divergences in §4 |
| 1b-iii ✅ | Expiry: items without TTL (D21, `0684`), events expire when they end (D128, `0685`), republish through the prefilled create form (D127) | Behaviour fixes on the agreed graph, each with a regression test |
| 1b-iv ✅ | An organizer pauses, closes or deletes an event with registrations; they are cancelled and every attendee is notified, on any delete path (`0686`) | PM decision 2026-11-09 |
| 1c | Writer-declared actor role (`owner` / `recipient` / `admin` / `system`) passed to the trigger, then role-restricted S1 edges | Needs a small kernel addendum: the trigger cannot infer the actor (a report's auto-hide runs in the reporter's session) |
| 1d ✅ | Background jobs on the retired ride tables (§4): template materializer, legacy ride expiry, the two no-op crons, the `ride_participants` sweep, the food sweep's dead loop; retired in `0695`; the legacy ride TS types and use cases go with G44 | A live defect on `dev` since `0667`; lands before the next release |
| 2 ✅ | Handoffs as four machines on one table (`giving_handoff` for items, food, animals, knowledge and any other world; `ride_booking`, `housing_booking`, `event_registration`), one `before update of status` trigger choosing the machine by `world_slug` (`0694`) | Most writers and most divergences; TS copies collapse to the kernel |
| 2b ✅ | Client booking and assign actions follow the machines and the RPC preconditions (reinstate, complete, approve seats, assign) | The UI offers only what the server accepts |
| 2c | Reservation-expiry sweep for items, animals and knowledge (`confirm_by`) | §4 handoffs |
| 3 | Account status (+ composite invariant check beside the kernel call), onboarding | Many writers, failing checks, drifted unions |
| 4 | Reports, follow requests, review-queue family, content moderation, post comments, knowledge topics | Small graphs; replaces hand-written triggers and RLS-only edges |
| 5 | Volunteer opportunity, shift signup, timesheets | First role-heavy graphs outside giving |
| 6 | Money (intent, payment, refund, payout, standing order, KYC), ride series, finance ledger | Before the real payment provider webhook lands |
| 7 | WhatsApp outbound and session, template review, chat message; background machines (embedding job, ride route alert, ingestion run, entity-resolution candidate, operator case), notification outbox in-flight state, worker schedules (§3.4) | Service-only, lowest risk |
| — | `listings`, `giving_handoffs`, `ride_listings` (retired ✅ `0667`, views over the record); `ride_participants`, `ride_templates`, `listing_matches` | Retire with G44 / matching v2, never port. A writer that updates the `listings` view moves the post through the view's `instead of` trigger; moderation writers act on `posts` directly (`0682`) |

## 7. Product decisions

Answered by the PM on 2026-11-09:
- An admin restore returns a removed post to its previous status (D129; wave 1b-i).
- Items have no expiry (D21 stands): the 30-day `expires_at` on items goes (wave 1b).
- An expired post is republished as a new post, never reopened (D127; graph change in wave 1a, full copy in 1b).
- An event or ticket expires when it ends (D128; wave 1b).

Open, block the wave that owns them:
1. **Unban (wave 3).** Is `banned → active` an admin edge, and who may take it?
2. **Suspension lift threshold (wave 3).** One number for suspend and lift (5 distinct reporters?).
3. **`delivered` chat state (wave 7).** Write it from the client receipt, or drop it?
4. **Money vocabulary (wave 6).** One word for a completed payment (`paid` or `succeeded`) and `cancelled` everywhere.
5. **Operator cases (wave 7).** Three of four states have no writer: build the operator flow (assign, resolve, cancel) or retire `operator_cases`?
6. **Recurring rides (wave 1d).** Ride templates (`0148`) and ride series (`0531`) both repeat a ride; retire templates in favour of series?
7. **Account deletion (wave 3).** The purge deletes the row, so `deleted` is never written: keep a tombstone row in `deleted`, or drop `deleted` from the graph?
