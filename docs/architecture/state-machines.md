# State machines — one graph per status lifecycle

> **Status:** 2026-11-13. Every stored status lifecycle is on the FSM kernel: 32 machines, each declared once in `@kc/domain`, mirrored in Postgres and enforced by a trigger. The app decides which actions to offer by asking the same machines. Gap `G61`; program issue #1989.
> **Kernel design:** [`docs/superpowers/specs/2026-11-09-fsm-kernel-design.md`](../superpowers/specs/2026-11-09-fsm-kernel-design.md) · engineering decision `D-226` (`docs/SSOT/DECISIONS.md`).

## 1. The rule

A lifecycle has **one** transition graph, and it lives in three places that cannot drift apart:

| Where | What | File |
|---|---|---|
| TypeScript | `defineMachine({ id, states, edges })`, registered in `FSM_MACHINES` | `app/packages/domain/src/fsm/machines/*.ts`, `fsm/catalog.ts` |
| Postgres | rows of `kc_private.fsm_state` and `kc_private.fsm_edge` (role `''` = any caller) | the module that owns the table, under `supabase/schemas/**` or a forward migration |
| Contract test | replays the schema and the forward migrations and compares both catalogs row for row | `app/packages/infrastructure-supabase/src/fsm/__tests__/catalogMatchesSql.test.ts` |

No other copy of a move list may exist: not a SQL `case`, not a TS record of allowed targets, not a UI condition on status literals that decides an action.

How a move is enforced:

- A `before insert or update` trigger on the status column runs `kc_private.fsm_guard_status('<machine>', '<column>')`, which calls `kc_private.fsm_assert_transition(machine, from, to, role)`. A write that is not an edge fails with `illegal_transition`, an unknown value with `unknown_state`, an edge the caller's role does not hold with `forbidden_role` (all `P0001`). A same-status write is legal and changes nothing.
- The role is declared by the writer, never inferred: an RPC, sweep or webhook sets the transaction-local setting `kc.fsm_role` (`set_config('kc.fsm_role', role, true)`) around its update. A direct write with no role can take only unrestricted edges.
- `post_handoffs.status` holds four machines in one column. Its own trigger (`kc_private.post_handoffs_guard`) picks the machine by the post's type (`kc_private.handoff_machine_of`; TS twin `handoffMachineFor`).

What stays outside the kernel: side effects (karma, notifications, audit) run in the writer after the legal move; predicates that read other rows (free seats, a time window, an active handoff) are checked by the writer before the move.

## 2. Adding or changing a lifecycle

One PR, with code, the spec section and tests:

1. Settle the graph against `docs/spec/`. List every writer of the column. An open product question goes to the PM before code.
2. Declare the machine in `app/packages/domain/src/fsm/machines/`, with roles where callers differ, and register it in `FSM_MACHINES` (`catalog.ts`) and `fsm/index.ts`.
3. Add a forward migration `supabase/migrations/next-NN_snake_slug.sql` (its number is assigned on merge, `D-234`): the `fsm_state` / `fsm_edge` rows and the status trigger. Every writer sets `kc.fsm_role` when the edge is role-restricted.
4. Delete every other copy of the move list, in SQL and in TS.
5. Tests: the machine's graph test in `@kc/domain`, the contract test (automatic), and a `supabase/tests/NNN_*.sql` file that drives every writer through a legal and an illegal move.
6. If the app offers actions on the lifecycle, add or extend its action helper (§4) with tests; components never compare the status to a literal to decide an action.

## 3. The catalog

"Roles" lists the roles that restrict at least one edge; `—` means every edge is open to any writer (the RPC still authorizes the caller).

### 3.1 Posts and handoffs

| Machine | Column | States | Roles |
|---|---|---|---|
| `post` | `public.posts.status` | draft, open, paused, closed_delivered, deleted_no_recipient, expired, hidden_pending_review, removed_admin | owner, admin, system |
| `giving_handoff` | `public.post_handoffs.status` (items, food, animals, knowledge and any world without a booking machine) | reserved, confirmed, handed_over, cancelled, no_show | owner, recipient, system |
| `ride_booking` | `public.post_handoffs.status` (rides) | reserved, confirmed, handed_over, cancelled | owner, recipient, system |
| `housing_booking` | `public.post_handoffs.status` (housing) | reserved, confirmed, handed_over, cancelled, no_show | owner, recipient, system |
| `event_registration` | `public.post_handoffs.status` (time) | waitlisted, reserved, confirmed, handed_over, cancelled, no_show | owner, recipient, system |
| `post_media` | `public.post_media.processing_status` | pending, ready, failed | system |
| `post_comment` | `public.post_comments.status` | active, deleted | author, post_owner, admin |
| `post_series` | `public.post_series.status` | active, paused, ended | — |
| `ride_series` | `public.ride_series.status` | active, paused, cancelled | — |

There is one post object and one status vocabulary. The former `listings` tables, their status column and the lossy post ↔ listing mapping no longer exist; a "listing" in the app is a post read through a marketplace view model that carries the post's own status.

A post has no `cancelled` state (`D142`). A post its owner calls off moves to `deleted_no_recipient`; what happened is told by the reason code of that move in the status history (§5).

### 3.2 People, social and safety

| Machine | Column | States | Roles |
|---|---|---|---|
| `account_status` | `public.user_account.status` | pending_verification, active, suspended_for_false_reports, suspended_admin, banned, pending_deletion | — |
| `onboarding` | `public.user_account.onboarding_state` | pending_basic_info, pending_avatar, completed | — |
| `follow_request` | `public.follow_requests.status` | pending, accepted, rejected, cancelled | requester, target, system |
| `report` | `public.reports.status` | open, confirmed_violation, dismissed_no_violation | admin |
| `moderation_queue` | `public.moderation_queue.status` | open, resolved | admin |
| `challenge` | `public.challenges.status` | active, ended | admin, manager |
| `match` | `kc_private.match_candidates.status` | suggested, accepted, declined, expired | member, system |
| `knowledge_topic` | `public.knowledge_topics.status` | proposed, active, merged | — |

### 3.3 Organizations and money

| Machine | Column | States | Roles |
|---|---|---|---|
| `organization` | `public.organizations.status` | active, suspended | admin |
| `org_sec46` | `public.organizations.sec46_status` | none, pending, active, expired, revoked | system |
| `org_application` | `public.org_applications.status` | pending, approved, rejected | admin |
| `donation_link_review` | `public.donation_links.review_status` | pending, approved, rejected | reviewer |
| `standing_order` | `billing.standing_orders.status` | pending, active, paused, cancelled | provider |
| `donation_intent` | `billing.donation_intents.status` | created, checkout, succeeded, failed, cancelled | provider |
| `payment` | `billing.payments.status` | succeeded, failed, refunded | provider |
| `refund` | `billing.refunds.status` | pending, succeeded, failed | provider |
| `payout` | `billing.payouts.status` | pending, succeeded, failed | provider |
| `kyc` | `billing.kyc_profiles.status` | pending, approved, rejected | provider |
| `webhook_event` | `billing.webhook_events.status` | pending, processed, failed | — |
| `org_finance_entry` | `billing.org_finance_entries.status` | pending, cleared, cancelled | — |

### 3.4 Back office and workers

| Machine | Column | States | Roles |
|---|---|---|---|
| `admin_task` | `kc_private.admin_tasks.status` | open, in_progress, blocked, done, archived | — |
| `timesheet` | `kc_private.timesheet_entries.status` | draft, submitted, approved, rejected | — |
| `embedding_job` | `kc_private.embedding_jobs.status` | pending, processing, done, failed | — |

## 4. The app asks the machines

The kernel's pure functions (`app/packages/domain/src/fsm/machine.ts`) answer every question the app has about a lifecycle: `canTransition` (the answer with its error code), `allowsMove` (a real move this role may make), `hasEdge` (a real move for some caller), `isTerminal`, `assertTransition`.

**Rule.** A component or use case that decides whether to offer or perform an action never compares the status to a literal. It calls the lifecycle's action helper, which derives the answer from the machine, so the app offers exactly what the server accepts. A status the app does not know (a newer server) offers no action. Showing a label, a color or a caption per status is display, and may read the status directly.

| Lifecycle | Helper | File (`app/packages/domain/src/` unless noted) |
|---|---|---|
| Post, owner and admin actions | `postOwnerActions`, `postAdminActions`, `isPostEditableByOwner`, `isPostEnded` | `postActions.ts` |
| Giving handoff, knowledge booking | `givingHandoffActions`, `isGivingHandoffLive`, `canCompleteKnowledgeSession` | `marketplace/givingHandoffActions.ts`, `knowledge/knowledgeSlots.ts` |
| Ride booking | `canPerformBookingAction` (with the caller's side), `canCompleteRideBooking`, `rideReinstateBlocker` | `rides/RideBooking.ts` |
| Housing booking | `hostBookingActions`, `guestStayActions` | `housing/housingStayRules.ts` |
| Event registration | `canLeaveEventRegistration`; the organizer's `rosterActionsFor` | `marketplace/eventPost.ts`; `app/apps/mobile/src/lib/eventPost.ts` |
| Post series, ride series | `postSeriesActions`, `rideSeriesActions` | `series/postSeriesActions.ts`, `rides/rideSeriesActions.ts` |
| Standing order | `standingOrderActions` | `payments/standingOrderActions.ts` |
| Timesheet | `timesheetActions` | `admin/timesheetActions.ts` |
| Account | `canBanAccount`, `canRequestAccountDeletion` | `accountActions.ts` |
| Organization application | `isOrgApplicationOpen` | `admin/OrgApplication.ts` |
| Donation link review | `isDonationLinkAwaitingReview` | `donations.ts` |

Status vocabularies in TypeScript are read from the machine where a second list used to exist (`STANDING_ORDER_STATUSES`, `MatchStatus`), so a state added to a machine reaches its type without a second edit.

## 5. Status history of a post

`public.post_status_events` keeps one row per status change of a post, whoever made it: the status it left and the one it reached, the kernel role of the move, the acting member (none for a system move) and an optional reason code (`series_cancelled` when a date is called off with its series). The row is written by a trigger on `posts`, so no writer can skip it. The owner reads the history of their own posts; nobody writes it through the API; it is deleted with its post. The moderation audit trail is a separate record with its own retention.

## 6. Not lifecycles — kept off the kernel

| Model | Why it is not an edge list |
|---|---|
| `posts.status_before_removal`, `user_account.status_before_deletion` | The status to return to after an admin removal or a cancelled deletion: a memory of a state, not a state |
| `kc_private.crm_contacts.status` | A classification an admin sets freely: any value may follow any other |
| `ops.job_runs.status` | The outcome of one run, written once when the run ends |
| On/off flags and single stamps (`feed_folded`, `show_active_status`, `resolved_at`, `read_at`, soft-delete stamps) | Two values with no ordering to guard, or a stamp set once |
| Row existence (follows, blocks, memberships, role grants, saved posts) | The state is whether the row exists |
| Derived states (a challenge that has ended by its date, the verification level, a full or finished knowledge slot, an approval that lapsed) | Computed from other columns on read or by a job that then makes a kernel move |
| Client step lists (create form steps, closure sheet, consent gates) | Pure UI flow with no stored status |

A model moves onto the kernel when it gains a stored status with more than one legal move.

## 7. Product decisions

Answered by the PM, in the order they were asked:

1. **Unban.** `banned → active` exists and is taken by an admin restore.
2. **Suspension threshold.** One number suspends a member and lifts the suspension (`D134`; by default 5 distinct reporters within 30 days, kept in the moderation settings).
3. **`delivered` chat state.** Dropped: a chat has no per-message read state.
4. **Money vocabulary.** A completed payment is `succeeded`; a called-off one is `cancelled`, everywhere.
5. **Operator cases.** Retired; the review queue (`moderation_queue`) replaces them.
6. **Recurring rides.** Ride templates are retired in favour of ride series.
7. **Account deletion.** There is no `deleted` state: the purge removes the row, and a failed purge is retried.

Also decided: an admin restore returns a removed post to its previous status (`D129`); items have no expiry (`D21`); an expired post is republished as a new post, never reopened (`D127`); an event expires when it ends (`D128`); a post has no `cancelled` state and its closed label follows the world (`D141`, `D142`); a recurring event or ride is one card in the feed (FR-POST-024, FR-RIDE-046).

## 8. Follow-ups

Tracked as issues under #1989; none of them is a second copy of a graph.

| Issue | Subject |
|---|---|
| #2083 | One terminal-cascade policy for a post and standard idempotent sweeps |
| #2084 | A closure profile per post kind instead of world-slug conditions in the UI |
| #2085 | Challenge participation as a machine; `ends_at` sweep |
| #2087 | Handoff capacity: food portions, volunteer places, several recipients |
| #2088 | A deleted member's counterparts keep their posts and handoffs |
| #2089 | One recipient record at closing; reopen after a handoff |
| #2158 | Recurring posts, second version: edit one date, rides on the shared series model |
