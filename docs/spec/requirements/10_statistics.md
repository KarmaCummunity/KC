# 2.10 Personal & Community Statistics

> **Status:** 🟡 FR-STATS-001..008 ✅ (platform statistics for admins and givings by world since 2026-11-03); FR-STATS-009 waits for ORG-P1. Personal stats screen (`/stats`), counters from `users`, community panel from `community_stats`, activity timeline from `user_personal_activity_log` + `rpc_my_activity_timeline` (migrations `0044_personal_activity_log`, `0045_stats_recompute_nightly`). Nightly `stats_recompute_personal_counters_nightly` + `stats_drift_events` + pg_cron job `stats_recompute_nightly` satisfy **FR-STATS-005** (operator: enable `pg_cron`, see `OPERATOR_RUNBOOK.md`). ⚠️ Audit 2026-05-16 (partial): FR-STATS-001 AC2 "reactive" focus-only gap **closed by FR-KARMA-009** — `useMeRealtime` (`_layout.tsx`) subscribes persistently to `postgres_changes UPDATE` on own `users` row and patches the React Query cache, so counters update live without a focus-refetch. Remaining open items tracked in TD-98: FR-STATS-006 AC2 now allows guests (the contradiction with FR-FEED-014 is closed); FR-STATS-003 AC1 caps at 30 but use case allows 50; section order on screen is community-first, spec is counters-first. See `docs/SSOT/archive/audit/2026-05-16/06_donations_stats_settings.md`.



Prefix: `FR-STATS-*`

---

## Scope

Two surfaces:

1. **Personal statistics** for the signed-in user (counters and a chronological activity timeline).
2. **Community statistics** — a small, lightweight at-a-glance section within the same screen.

Out of scope:

- Charts, heatmaps, category breakdowns, period comparisons, exports — explicitly excluded by `PRD_MVP/08_Out_of_Scope_and_Future.md` §8.2.5.
- Aggregated cohort dashboards for product analytics — those live in the analytics pipeline (see [`06_cross_cutting/01_analytics_and_events.md`](../../SSOT/archive/SRS/06_cross_cutting/01_analytics_and_events.md)) and are not user-facing.

---

## FR-STATS-001 — Personal stats screen

**Description.**
A screen reachable from Settings (and as an optional shortcut from My Profile) showing personal counters and a timeline.

**Source.**
- PRD: `03_Core_Features.md` §3.6, `05_Screen_UI_Mapping.md` §5.2.

**Acceptance Criteria.**
- AC1. Three large counter cards in a single row:
   - 🎁 **Items given** — `User.items_given_count`.
   - 🔍 **Items received** — `User.items_received_count`.
   - 📊 **Active posts** — `User.active_posts_count_internal`.
- AC2. The counters update reactively (`NFR-PERF-005`) when underlying events fire.
- AC3. Below the counters: a compact activity timeline (`FR-STATS-003`).
- AC4. Below the timeline: a community stats panel (`FR-STATS-004`).

**Related.** Screens: 5.2 · Domain: `Statistic`, `User`.

---

## FR-STATS-002 — Counter semantics

**Description.**
Each counter has precise increment/decrement rules.

**Source.**
- PRD: `03_Core_Features.md` §3.6.
- Constraints: `R-MVP-Items-4`.

**Acceptance Criteria.**
- AC1. **Items given** (`items_given_count`):
   - +1 when one of the user's posts transitions to `closed_delivered` **or** `deleted_no_recipient`.
   - −1 when a `closed_delivered` post is reopened (`FR-CLOSURE-005`) or when a recipient un-marks themselves (`FR-CLOSURE-007`).
   - Unaffected by `expired` and `removed_admin` transitions.
- AC2. **Items received** (`items_received_count`):
   - +1 when a `Recipient` row is created (post owner marked the user).
   - −1 when a `Recipient` row is deleted (reopen, un-mark, post removal).
- AC3. **Active posts** (`active_posts_count_internal`):
   - Equal to count of posts where `owner = user`, `status ∈ {open, closed_delivered, deleted_no_recipient}`, and `visibility <> 'OnlyMe'` (hidden posts are excluded; closed posts are included — same semantics as `FR-PROFILE-013` AC1).
   - The public-projection variant (`active_posts_count_public`, `FR-PROFILE-013`) is not surfaced on this screen.
- AC4. Counters never go below zero; an attempt is treated as a domain integrity error and triggers an alert (`NFR-RELI-005`).

**Related.** Domain: `Statistic`, `User`, `Post`, `Recipient`.

---

## FR-STATS-003 — Activity timeline

**Description.**
A chronological list of recent personal activity.

**Source.**
- PRD: `03_Core_Features.md` §3.6, `05_Screen_UI_Mapping.md` §5.2.

**Acceptance Criteria.**
- AC1. Up to 30 most recent entries; scrollable; one entry per row with icon, type label, post title (or recipient name), and relative timestamp.
- AC2. Entry kinds:
   - `post_created` — "You posted [title]".
   - `post_closed_delivered` — "You delivered [title]".
   - `post_closed_no_recipient` — "You closed [title] without marking a recipient".
   - `post_reopened` — "You reopened [title]".
   - `marked_as_recipient` — "[Owner] marked you as the recipient of [title]".
   - `unmarked_as_recipient` — "You removed your recipient mark from [title]".
   - `post_expired` — "[title] expired".
   - `post_removed_admin` — "[title] was removed by moderation".
- AC3. Tapping an entry deep-links to the relevant surface (post detail or recipient view) when the resource still exists.
- AC4. The timeline is read-only.

**Related.** Domain: `ActivityEntry`, `Post`, `Recipient`.

---

## FR-STATS-004 — Community stats panel

**Description.**
Three lightweight community-level numbers shown beneath the personal section.

**Source.**
- PRD: `03_Core_Features.md` §3.6 ("מדדי קהילה").

**Acceptance Criteria.**
- AC1. Numbers:
   - **Registered users** — total count of `User` rows in `active` status.
   - **Active posts** — total count of `open` `Public` posts.
   - **Items delivered (all-time)** — total count of `closed_delivered` posts.
- AC2. Numbers refresh every 60 seconds via a single cached read endpoint (`FR-FEED-014` shares the cache for the active-posts number).
- AC3. The panel is **flat** — no charts, no breakdowns, no time-series in MVP.
- AC4. Empty cluster (e.g., < 50 users system-wide) shows the panel anyway with low numbers; copy is unchanged.

**Related.** Domain: `CommunityStats`.

---

## FR-STATS-005 — Recompute / drift detection

**Description.**
Counters maintained as denormalized columns must match a from-events ground truth.

**Source.**
- (Internal: data integrity for KPI #1 — North Star metric.)

**Acceptance Criteria.**
- AC1. A nightly job (`bg-job-stats-recompute`) scans every user with activity in the last 7 days and recomputes the three personal counters from events.
- AC2. Mismatches log a warning, emit a `stats_drift_detected` event, and reconcile the denormalized column to the recomputed value.
- AC3. Rate of drift events is monitored; >0.1% per night triggers an SRE alert (`NFR-RELI-005`).

**Related.** Domain: `Statistic`, `bg-job-stats-recompute`.

---

## FR-STATS-006 — Privacy of statistics

**Description.**
Personal statistics are visible only to the user themselves.

**Source.**
- PRD: `03_Core_Features.md` §3.6 (implicit — under Settings → My Stats).

**Acceptance Criteria.**
- AC1. The personal stats screen requires authentication and never exposes data about other users (counters of other users are exposed only as the public counters on `Other Profile`, with the public/internal split per `FR-PROFILE-013`).
- AC2. Community stats (`FR-STATS-004`) are readable by anyone, guests included, because the public About page shows them; they are counts only and never include identifying information. D152

---

## FR-STATS-007 — Platform statistics (admins)

**Description.**
The team sees the whole platform's statistics in the admin portal (D106).

**Acceptance Criteria.**
- AC1. Admin portal → "Statistics" (`/admin/stats`), for the roles with `stats.view_platform` (super admin, moderator); the server re-checks the roles.
- AC2. A window of 7 / 30 / 90 days. On top, the north-star total: givings closed in the window (`docs/spec/16_kpis.md`).
- AC3. One card per world and direction: published, booked, confirmed, handed over, cancelled, closed, and median hours to the first booking and to the first handover, from `admin_world_flow_funnel` (`0542`, G43; migration `0018` after the baseline cut-over, money has no handoff stages). Handoff stages read "not tracked" for worlds without giving handoffs.
- AC4. Shows counts only; no member is identified.

## FR-STATS-008 — My givings by world

**Description.**
A member's statistics screen also breaks their givings down by world (D106).

**Acceptance Criteria.**
- AC1. Below the personal counters (`FR-STATS-001`): one row per world in which the member has activity, with **given** (handoffs on their listings that were handed over), **received** (handoffs they received that were handed over) and **closed** (their own listings closed).
- AC2. Owner only (`FR-STATS-006` AC1): `my_world_givings` (`0547`; migration `0018` after the baseline cut-over) reads the session user and takes no user id.
- AC3. With no activity yet, a short hint explains that handed-over givings will appear here.

## FR-STATS-009 — Organization impact

**Description.**
An organization's profile shows its public impact numbers; its team sees the fuller set (D106).

**Acceptance Criteria.**
- AC1. Public, on the organization profile: givings closed, people helped (distinct recipients), volunteer hours approved, and active listings, all-time and the last 30 days.
- AC2. The organization's managers additionally see their own flow funnel (as `FR-STATS-007` AC3, scoped to the organization's listings).
- AC3. Built on the organization entity (BACKLOG `ORG-P1`); tracked as G54 until then.

## FR-STATS-010 — Public financial transparency

**Description.**
When the organization chooses to publish them, its finances appear live on the statistics screen and in the About "numbers" card (`FR-FIN-022`, D111).

**Acceptance Criteria.**
- AC1. `OrgTransparencySection` renders directly below the community panel on `/stats`; it renders nothing unless a super admin switched at least one block on and that block has data.
- AC2. Blocks (each independently switchable): income / expense / balance totals, number of donations, share of expenses spent on programs, expense breakdown by category, 12-month income-and-expense trend.
- AC3. Aggregates only: no donor, counterparty, entry or account is ever shown.
- AC4. Visible to guests too (anonymous RPC), same as the About card.


---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.6. |
| 0.3 | 2026-11-03 | `FR-STATS-010` public financial transparency on the statistics screen (`FR-FIN-022`). |
| 0.2 | 2026-11-03 | D106 — `FR-STATS-007` platform statistics for admins (`/admin/stats`, flow funnel `0542`), `FR-STATS-008` my givings by world (`0547`), `FR-STATS-009` organization impact (pending `ORG-P1`). |
