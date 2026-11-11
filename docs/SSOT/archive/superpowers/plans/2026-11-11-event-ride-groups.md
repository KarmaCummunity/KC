# Event ride groups — delivery plan (2026-11-11)

Spec: [`docs/spec/requirements/24_ride_event_groups.md`](../../../../spec/requirements/24_ride_event_groups.md) (`FR-EVRIDE-*`) · ADR: [ADR-007](../../../../architecture/adr/ADR-007-event-group-audience.md) · Decision `D144` · Gap `G62` · Migrations `0750–0779`.

This plan turns the spec into releasable slices. One slice = one issue = one PR of ≤ ~600 changed lines (split further when larger), branch from `origin/dev`, base `dev`, opened-by label, `Mapped to spec`, tests first. Nothing starts before the PM approves the spec and answers the open items (or accepts their defaults).

## 1. Principles for delivery

- **Privacy before features.** The audience rule, the reader inventory test and the writer guards land (S1) before any group ride can exist; the flag stays off until they pass.
- **Vertical thin slices behind a flag**, each shippable to kc-dev, none visible in prod (`rides_event_groups_enabled`, off).
- **BE/FE lanes** (AGENTS §9): a slice names its BE part (migrations, RPCs, SQL tests, adapters) and FE part (screens, hooks). Contract changes (`@kc/domain`, `@kc/application`) go in their own `(contract)` commit first.
- **Budgets are tests**, not hopes: every performance budget of the spec has an automated check or a monitor before the pilot.
- **Reuse before build**: places, bookings, emergency call, karma, completion, FSM kernel, intent-restore store, `openExactTopicChannel`, `enqueue_notification`.

## 2. Release trains

| Train | Audience | Contents |
|---|---|---|
| **R1 — Closed pilot** | kc-dev, then a handful of invited organizers in prod | S0–S6 (core), cancel + member management, reports/admin hide, content filter, retention purge |
| **R2 — Launch quality** | everyone, flag on | Announcements, request answering, night-return tools, trust details, analytics, a11y/copy polish, public-launch hardening |
| **P2** | everyone | Round trip, matches, reminders, coverage, waitlist, printable summary |
| **P3** | — | Org-event link, group chat, trust options |

R1 → R2 is gated by the pilot's exit criteria (section 7).

## 3. Slices

Sizes: S ≤ 1 day · M 2–3 days · L ~1 week · XL > 1 week (split before starting). Dependencies in parentheses.

### S0 — Foundations (M)
- Merge the approved spec and ADR; claim the issue set and the range `0750–0779`; add `rides_event_groups_enabled` (`app_flags`, off).
- `@kc/domain`: `EVENT_RIDE_GROUP_LIMITS`, `validateRideEventGroupDraft`, ride windows, audience order, invite-code format + normalization, content-safety normalizer, status graphs `rideEventGroup` and `rideEventGroupMembership` (+ mirror in `fsm_state`/`fsm_edge`); unit tests.
- Test scaffolding: the **reader inventory** harness (a list of every function and policy that reads posts or listings, with expectations per audience and viewer kind) — initially asserting the current behaviour of rides so later slices only add rows.
- Exit: domain tests green; inventory harness runs in CI.

### S1 — Data model, audience, leak matrix (L, BE) (S0)
- Tables, columns, indexes of the spec's data model; RLS on every table; grants (`anon` none).
- The member clause in the three visibility predicates; structural exclusion in every general reader; skip-group-rides in the operator-case, anonymity, counter, subscription-alert, route-alert, embedding and bot paths; the visibility writers (RPC, view guard, share-to-feed, generic edit) refuse group rides.
- `create_event_group_ride` skeleton restricted to the flag + a dev group fixture (no UI).
- Exit: the inventory test passes for non-member, banned, removed, `anon`, follower, operator × three audiences × every reader; adversarial SQL tests for the writers; no performance regression on `list_rides_feed` (before/after plan).

### S2 — Create, edit, invite, join (L, BE+FE) (S1)
- RPCs: create, edit, rotate, freeze, preview/join (token and code), failed-attempt lock, join log; constant-shape `group_not_found`; idempotent `request_id`.
- Static landing route in `web-server` (`/rides/join/:token`: ≤ 10 KB, `noindex`, `no-store`, no-referrer, no DB call); manifests for the path (Team ID and SHA-256 are PM items — until then web + code fallback); `/rides/join/` in the restorable prefixes; **persisted** redirect intent; minimal sign-up path with the deferred profile wizard.
- Screens: hub entry, create (≤ 60 s), invite (share, QR, code, checklist), join preview, pending state.
- Exit: signed-out → install-less web → join works on web; funnel events emitted; LCP budget measured.

### S3 — Members, leave/remove/ban, succession, lifecycle (L, BE+FE) (S2)
- Approval flow (approve/decline/bulk), promote/demote, leave/remove/ban cascades (direct `post_handoffs` writes, new cancel reasons, neutral copy), `kicked` event, organizer transfer and deletion succession.
- Lifecycle: effective-state derivation in every RPC; chunked 10-minute sweep; nightly retention purge; ops-health rows.
- Exit: paired-transaction race tests for every case in the spec's concurrency list that touches members; sweep idempotency/catch-up tests.

### S4 — Group rides and booking guards (L, BE+FE) (S1, S2)
- `create_event_group_ride` complete (membership, state, ceiling, windows, limits, forced fields); group-aware edit; audience-change RPC; `seats_booked`; leg rule under the advisory lock incl. `reinstate_ride_booking`; non-member booking tag; supersede; new cancel reasons + notification mapping.
- Quick-post sheet (explicit leg, chips, collapsed options, inline warnings), ride detail booking, "I'm here".
- Exit: ≤ 3 taps / ≤ 10 s median on the device lab; race tests (two drivers, audience change vs booking, publish vs ceiling).

### S5 — Board, counters, realtime (L, BE+FE) (S4)
- `list_ride_event_group_board` (membership once, keyset, block anti-join), counters, partial indexes, `board_rev` coalesced ping, `SupabaseRideGroupRealtime` adapter (private topic, membership policy, polling fallback, blur-unsubscribe), hub card, all UX states, persisted cache with TTL (no PII persisted).
- Exit: board p95 budgets met on the seeded 500-member / 150-ride fixture; realtime policy tests (member, non-member, banned).

### S6 — Notification engine for groups (L, BE) (S2; parallel to S4/S5)
- Kinds end to end (domain union, route allowlist test, Hebrew server i18n, inbox world mapping, settings toggle); per-recipient dedupe keys; budget and quiet-hour exemptions at enqueue; set-based queued fan-out (chunks of 200); **batch dispatcher** (100 per call) with claimed retries; suppression of per-booking pushes for system cancels; backlog alert.
- Exit: k6 test with 500 virtual recipients — 95% delivered ≤ 60 s, zero duplicates; unit tests for budgets and exemptions.

### S7 — Cancel, move, announcements (L, BE+FE) (S3, S6)
- `cancelling` flip ≤ 100 ms + chunked worker (`skip locked`, resumable), one push per person, un-cancel; move handling (flags, specific pushes, 12 h driver window); announcements with templates (R2 if time is short).
- Exit: cascade ≤ 60 s for 500 bookings; resumability test (kill the worker mid-run).

### S8 — Moderation, admin, content safety, analytics (M–L, BE+FE) (S2–S4)
- Report targets and reasons, weighted hide, organizer-freeze semantics, admin list/open/hide/restore/remove with audit and reason prompts, creation bans; content filter in all text fields with the normalizer; analytics events and the admin card (R2).
- Exit: abuse tests (3 sock accounts cannot hide a group), admin access is audited.

### S9 — Hardening and pilot readiness (M) (S1–S8 for R1)
- E2E four-user journey, Maestro flow, a11y and Hebrew copy review (gender-neutral, memorial tone), offline/cached behaviour at a dead-signal venue, DST fixtures, **independent security review of the reader inventory and the join flow**, load test sign-off, runbook (`docs/agents/`/OPERATOR_RUNBOOK: freeze joins, kill switch, hide a group), dashboards and alerts.
- Exit: the checklist of section 7.

### R2 slices
- **S10 (M)** Request answering ("אפשר לקחת"), leaving-now live status, ride-home nudge, update-departure push, "still looking?" re-confirm, replacement suggestions (`FR-EVRIDE-034/035`).
- **S11 (M)** Trust details: driver photo and optional car details for confirmed passengers, contact consent, "invited by" (`FR-EVRIDE-038` R2 part).
- **S12 (S)** Analytics funnel and admin card polish (`FR-EVRIDE-022`).

## 4. Dependency graph

```
S0 → S1 → S2 → S3 ──────────────┐
          ├──→ S4 → S5 ─────────┼→ S9 (R1) → pilot → S10, S11, S12 (R2)
          └──→ S6 → S7 ─────────┤
                S8 (after S2–S4)┘
```
S6 can start as soon as S2 defines the kinds; S3 and S4 can run in parallel lanes after S2.

## 5. External dependencies and PM actions

| Need | Needed by | Fallback |
|---|---|---|
| Spec approval and the open items | S0 | Defaults in the spec |
| Link manifests (Apple Team ID, Android SHA-256) | S2 exit for app-opening links | PM handles them outside this plan; web landing + code entry meanwhile |
| Data-protection review of the optional gender field (`FR-EVRIDE-040`) | Before R1 exit | Field stays off until reviewed |
| Counsel: acknowledgement texts, retention periods, sober chip wording (L1, L3) | R2 | Draft texts behind the flag |
| Pilot events | S9 | Real events are plentiful; the pilot starts when the quality gates of section 7 pass (no calendar date) |

## 6. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| A reader exposes a `group_only` ride | Critical | ADR-007 layers, inventory test as a CI gate, independent review, flag off until green |
| Notification storm / duplicate pushes at launch | High | Per-recipient dedupe, batch dispatcher, claimed retries, k6 gate |
| Cancel cascade times out or half-completes | High | State flip + chunked resumable worker, atomic per ride |
| Invite link goes viral beyond the wedding | High | Spike freeze, approval switch, join log, bulk-remove |
| Landing too slow → funnel collapse | High | Static landing, LCP budget, web parity |
| Realtime connection quota | Medium | Coalesced ping, blur-unsubscribe, polling fallback, no presence |
| Visibility predicate cost in feeds | Medium | Gated clause after cheap branches; board reader checks membership once |
| Scam or commercial groups | Medium | Content filter, weighted hide, review of large new-account groups |
| Legal/privacy review slips | Medium | Behind the flag; retention values are config constants |
| Scope creep (group chat) | Medium | Phase gates in the spec |

## 7. Quality gates

**Per slice (definition of done):** AGENTS Part A checklist; tests at every layer touched; ADR-002 RPC checklist; types regenerated; spec status updated; migrations inside the claimed range with a fresh-stack run.

**Pilot entry (R1):** inventory test green and reviewed; security review findings closed; all budgets met in the load test; flag + per-feature kill switches verified; runbook rehearsed; dashboards live.

**R1 → R2 exit (pilot):** ≥ 3 real events, zero leak findings, zero critical incidents, link→join ≥ 50% on the instrumented funnel, median post time ≤ 10 s, no duplicate pushes, organizer feedback addressed.

## 8. Rollout and rollback

1. kc-dev with seeded fixtures (500 members, 150 rides) → load tests.
2. kc-prod, flag on for invited organizers only (allow-list), widening in steps.
3. **Kill switches:** the flag (hides everything and refuses RPCs), "joins off", "audience above group only off". Rollback is a flag flip; data stays, nothing is deleted.
4. Migrations are additive and backward-compatible (no destructive SQL).

## 9. Observability

Ops-health rows for each sweep; alerts: dispatch backlog > 200 rows older than 2 min, cascade lag, spike freezes, failed-attempt locks, inventory test failures, error rate of the group RPCs; funnel dashboard (link → sign-up → join, per step); realtime connection count; cost of `list_rides_feed` before/after.

## 10. First issues to open (after approval)

S0, S1, S2, S3, S4, S5, S6, S7, S8, S9 as sub-issues of the epic `G62`; R2 issues created at the pilot exit. Each carries its slice text above, the FR list it implements, the migration numbers it uses and its exit criteria.
