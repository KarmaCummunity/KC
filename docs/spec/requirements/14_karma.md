# Karma Points — FR-KARMA

> **Status:** ✅ Complete (migrations `0097–0100` applied on dev; Phase 0–3 shipped; SSOT updated 2026-06-08)
> **Domain file:** `docs/spec/requirements/14_karma.md`
> **Design doc:** `docs/SSOT/archive/superpowers/specs/2026-05-29-karma-points-design.md`
> **Implementation plan:** `docs/SSOT/archive/superpowers/plans/2026-05-29-karma-points.md`

---

## FR-KARMA-001 — Karma points column + denorm

**AC1.** Every `public.users` row carries a `karma_points integer NOT NULL DEFAULT 0 CHECK >= 0` column.
**AC2.** `karma_points` is server-authoritative — no client UPDATE grant; only `karma_grant_once` / `karma_apply` SECURITY DEFINER helpers may write it.
**AC3.** `karma_points` equals `sum(karma_ledger.points_delta)` for the user, floored at 0. The nightly `karma_recompute_nightly()` reconciles drift (pg_cron at 04:30, after stats at 04:15).
**AC4.** Existing users at migration time are backfilled via `event_type='backfill'` in `karma_ledger` (migration `0100`), seeded from `items_given_count * 20 + items_received_count * 15 + followers_count * 1 + 1` — one summary row per user, idempotent via the partial unique index.

---

## FR-KARMA-002 — Registration award

**AC1.** On user INSERT, `karma_on_user_insert()` AFTER INSERT trigger awards `+1` via `karma_grant_once` (event_type `'registration'`).
**AC2.** The award is idempotent — re-running for an existing user is a no-op.

---

## FR-KARMA-003 — Value bonus formula

**AC1.** The giver bonus at closure for a Give post's `estimated_value` is `round(min(estimated_value, 1000) / 50)`. Constants: `KARMA_VALUE_BONUS_DIVISOR = 50`, `KARMA_VALUE_BONUS_CAP_VALUE = 1000` (mirrored in `packages/domain/src/karma.ts` for the slider preview).
**AC2.** `estimated_value = null` → bonus = 0.

---

## FR-KARMA-004 — Estimated item value slider (Give posts)

**AC1.** `public.posts` gains an `estimated_value integer CHECK (null OR 0..1000)` column.
**AC2.** The Create Post form shows an `EstimatedValueSlider` (0..1000, step 50) only when post type = Give.
**AC3.** The value is persisted to `posts.estimated_value` at publish and included in the draft autosave.
**AC4.** Request posts always publish `estimated_value = null`.
**AC5.** When a Give post has `estimated_value > 0`, the feed post card shows a compact "שווי משוער ₪{value}" hint below the description (display-only; never on Request cards).

---

## FR-KARMA-005 — Post created / removed awards

**AC1.** On `posts` INSERT, `karma_on_post_change()` AFTER INSERT trigger awards `+5` via `karma_grant_once` (event_type `'post_created'`).
**AC2.** When a post transitions to `status = 'removed_admin'`, the trigger awards `-5` (event_type `'post_removed'`) to the owner.

---

## FR-KARMA-006 — Outreach award (soft daily cap)

**AC1.** First message a non-owner sends in a post-anchored chat awards `+1` to the sender via `karma_grant_once` (event_type `'outreach'`, `ref_id = anchor_post_id`). System messages (sender null) are ignored.
**AC2.** A soft daily cap of 10 `outreach` events per sender per calendar day prevents mass-DM farming (checked at trigger time).
**AC3.** The cap is enforced server-side; the client has no visibility into it.

---

## FR-KARMA-007 — Karma display (self only, privacy by default)

**AC1.** The signed-in user's karma total is displayed on their own profile (`MyProfileChrome`) and the stats screen as a `KarmaBadge` (number + "how to earn" explainer modal).
**AC2.** The badge shows a numeric total next to a "נקודות קארמה" label and an info icon. Tapping opens a modal listing the earn rules.
**AC3.** Karma is never shown on the stats or community panels in a ranking or comparative sense at MVP.

---

## FR-KARMA-008 — Karma visibility privacy gate

**AC1.** Karma is **self-only** at MVP. The badge is not rendered on another user's profile (`app/user/[handle]/index.tsx`) or in any public feed card.
**AC2.** A future "public flip" requires reciprocity/velocity anti-collusion caps (D-156) before it can be enabled. This is a hard precondition, not deferred polish.

---

## FR-KARMA-009 — Realtime live updates

**AC1.** `SupabaseUserRealtime.subscribeToStats` joins the member's own private Broadcast topic `user:<id>:stats` (event `stats_changed`, migration `0026`), which the server sends when a counter of `user_stats` changes (karma, followers, following, given, received, open posts). Status after the baseline cut-over: ✅ restored 2026-11-11 (it was lost at the cut-over while this section still read done).
**AC2.** On receiving an update, the hook patches the shared `['user-profile', userId]` React Query cache via `queryClient.setQueryData`. This updates the karma badge, profile counters, and stats strip in real time without a focus-refetch.
**AC3.** `useMeRealtime` is mounted in `_layout.tsx` inside `QueryClientProvider` so it is always active for authenticated users.
**AC4.** A dropped channel costs freshness only: every screen still reads the counters on mount.

---

## Mechanism notes (corrections vs. design doc)

These notes supersede the design doc (`docs/SSOT/archive/superpowers/specs/2026-05-29-karma-points-design.md`) where they conflict:

1. **Closure anchor:** karma is anchored to the `posts.status` transition into/out of `closed_delivered`, not recipients-row existence. A recipient row may precede the status flip or be deleted before it — anchoring to status gives the correct causal signal (mirrors `items_given_count` in `0006`).
2. **Reversal model:** awards are append-and-sum (not global unique). A partial unique index on `karma_ledger (user_id, event_type, ref_id) WHERE event_type IN (...)` dedupes only never-reversed "once" events (registration, post_created, outreach, backfill). Reversible events (follow, closure) net to zero via a second row with a negative delta and a `*_reverse` event_type — no unique-key race condition that would abort the host transaction.
3. **Realtime filter:** `user_id=eq.<userId>` (the PK column), not `id=eq.<userId>`. The design doc's `id=eq` reference is wrong.
4. **Outreach daily cap:** shipped in `0099` (10 events/sender/day), not deferred.
5. **Client live-update:** patches the `['user-profile', userId]` React Query cache via `setQueryData`, not a custom `meStore`. See FR-KARMA-009 AC2.

---

## Points schedule (authoritative — `supabase/migrations/0099_karma_triggers.sql`)

| Event | Delta | Notes |
|---|---|---|
| Registration | +1 | Once per user |
| Post created | +5 | Once per post |
| Post removed (admin) | -5 | Reversal of post_created |
| Follow gained | +1 | Reversible on unfollow |
| Outreach | +1 | Once per (sender, anchor_post); daily cap 10 |
| Closure — giver | +20 + value_bonus | Reversible on reopen |
| Closure — receiver | +15 | Reversible on reopen |

Value bonus = `round(min(estimated_value, 1000) / 50)` — max +20 at ₪1000.
