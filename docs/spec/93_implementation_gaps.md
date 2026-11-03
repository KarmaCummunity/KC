# 93 — Implementation gaps

Spec is clear; code does not match yet. These are **tasks, not contradictions**. Every gap = a task with code + spec section + automated test. A new row takes a `G` placeholder ID, numbered on merge (`CLAUDE.md` §4 "New registry IDs").

| # | Gap | Section |
|---|---|---|
| G1 | Unify listings → posts, ride_post_details, post_handoffs (D19) | 07.1 |
| G2 | 🟡 2026-10-30 — One world list in code: `GIVING_WORLD_SLUGS` (8) + `DOMAIN_SLUGS` (11) in `@kc/domain` (`worlds/givingWorlds.ts`). Remaining: `MARKETPLACE_WORLD_SLUGS` and the DB `world_slug` values still hold legacy slugs (G35) (D1) | 04 |
| G3 | ✅ 2026-10-30 — Anonymity changes both ways: the `listings` tighten-only trigger is dropped (migration `0451`, test `supabase/tests/0451_*`) (D16) | 07.13 |
| G4 | ✅ 2026-10-30 — Ratings readable only by their rater and super admins (migration `0446`, probe in `supabase/tests/`) (D24) | 07.7 |
| G5 | Org links without approval; two org entities (D9) | 08 |
| G6 | 'Marketplace listings' profile tab (D14) | 07.12 |
| G7 | Which DB TestFlight connects to (D8) | architecture |
| G8 | 🟡 2026-10-30 — Donation to KC via Grow (D20): redirect half shipped (`FR-DONATE-011`: one-time + standing-order hosted pages, server-configured channels, migration `0447`). Open: Grow merchant account + page URLs (launch plan A11), confirmation webhook, donation record, karma award (07.6) | 08 |
| G9 | Vague names in code | 94 |
| G10 | Trust engine (D24) | 07.14 |
| G11 | Expiry & reminders (D21) | 07.1 |
| G12 | Like & reply on comments (D25) | 07.9 |
| G13 | ID verification, blue check, provider choice (D23) | 07.14 |
| G14 | 🟡 2026-11-01 — Form per type without 'general' (D28): the create form offers items, rides, food, housing and time, each with its own field set (FR-POST-001 AC6, `listingFieldSpecs.ts`). Open: domain auto-suggest (S39), forms for knowledge / experiences / events | 07.2 |
| G15 | Recommendation engine & toggle (D27, D34) | 07.3 |
| G16 | Karma values config (D29) | 07.6 |
| G17 | 🟡 2026-10-30 — Notification preferences & emergency group (D26, D42). Done: per-type opt-out model `kinds` + "Match suggestions" toggle (FR-NOTIF-017, `0460`). Open: other per-type toggles, per-channel preferences, `emergency` group | 07.11 |
| G18 | Event post & registration (D31) | 08 |
| G19 | Volunteer hours (D32) | 07.10 |
| G20 | ✅ 2026-10-30 — Report & suspension thresholds: post 3 reports (14 d) → hidden for review; user 5 distinct reporters (30 d) → suspended; support stays reachable (D33, D61; migration `0452`) | 07.15 |
| G21 | Housing world (D30) | 05.6 |
| G22 | Wire the medical directory into the hub (D30) | 06 |
| G23 | World hub infra + WorldHubConfig (D36) | 04 |
| G24 | 🟡 2026-10-30 — 8 world slugs incl. `experiences` and the 11 domains exist in code; the Donations tab has a tile and a screen for every world and every domain (D62). Remaining: `domain_slug` on posts, challenges not a world (D45) | 04 |
| G25 | Emergency mode (D42) | 09 |
| G26 | Challenges layer (D43) | 10 |
| G27 | WhatsApp import & bridge (D38) | 13 |
| G28 | Job board (D41) | 06 |
| G29 | Polls & votes (D40) | 11 |
| G30 | Registrar data import & proper-management badge (S35) | 12 |
| G31 | Org verification levels, tags & filters (D53) | 08 |
| G32 | 🟡 2026-10-30 — Items and requests no longer expire; owners get relevance reminders (D59, S3; migration `0450`). Remaining: ride offer +30 min instead of 3 h after departure; event/ticket at their date; the reminder's "bump" action (G11) — evidence in [95](./95_reconciliation.md) | 07.1 |
| G33 | 🟡 2026-10-30 — DB done: `hidden_pending_review` status, auto-moderation hides, admin restore/remove/search handle it (migration `0452`). Remaining: app UI for the status and suspended-user browsing + support chat (client PR) (D33, D61) | 07.15 |
| G34 | 🟡 2026-10-30 — Listing handoffs now award the §7.6 values per world from one config (`karma_handoff_points`, migration `0453`, D63). Remaining: one closing system (posts closure vs listing handoffs, with G1) and the item bonus on handoffs (D12, D17) | 07.5, 07.6 |
| G35 | 🟡 2026-10-30 — The Donations hub no longer shows domains (`medical`, `animals`) as worlds (D62). Remaining: remove `app_design` and move the domain-type slugs out of `MARKETPLACE_WORLD_SLUGS` / DB `world_slug` with a data migration (D18, D45, D62) | 04 |
| G36 | ✅ 2026-10-30 — "Forgot password" flow (legacy FR-AUTH-008): `(auth)/forgot-password` + `auth/reset-password`; needs the hosted reset-email template (see 95) | auth |
| G37 | ✅ 2026-10-30 — Launch flags no longer hide worlds: every world tile is shown; a world whose flag is off opens as a portal (links + knowledge) instead of "coming soon" (D3, D60; `launchWorldMode`, `WorldPortalScreen`) | 04 |
| G38 | 🟡 2026-10-30 — Shared DB test harness (`supabase/tests/_harness`, `scripts/run-db-tests.sh`) + rides, items, time and food lifecycle flows (food: 2026-11-03, with the D21 / D28 expiry fix `0539`). Open: knowledge flow on the harness | architecture §5.1 |
| G39 | 🟡 2026-10-31 — Port contract tests: contract kit + `IPostRepository`, `ISavedPostsRepository`, `IChatRepository`, `IReportRepository` and the `IUserRepository` follow-graph and profile-editing (2026-11-03) suites run against the in-memory fakes (every `pnpm test`) and the Supabase adapters (local stack, `ci-backend`); remaining ports listed in BACKLOG `OPS-G39` (`D-204`) | architecture §5.1 |
| G40 | 🟡 2026-10-31 — Two-user E2E journey per active world: shared journey + fixtures for `items` and `food` (`tests/e2e/journeys/<world>.spec.ts`), run nightly, in the mobile P0 gate and in the release lane; `time` / `rides` follow their launch flags (`D-205`) | architecture §5.1 |
| G41 | ✅ 2026-10-31 — Edge Functions report errors to Sentry through one shared wrapper (`_shared/observability`, all 19 functions; `D-202`). Operator: set `EDGE_SENTRY_DSN` per environment | architecture §5.2 |
| G42 | 🟡 2026-10-30 — Health registry (`ops`, migration `0463`) + hourly monitor on dev + prod + GitHub-issue alerts (→ email) with auto-close (D68, D69). Open: WhatsApp channel once live, synthetic web check, WhatsApp outbound checks | architecture §5.2 |
| G43 | ✅ 2026-11-03 — Per-world flow funnel from handoff timestamps: `admin_world_flow_funnel(p_days)` (`0542`, super admin / moderator) follows the listings published in the window, per world and direction, through published → booked → confirmed → completed / cancelled, plus closed and median hours to booking / handover. Open: an admin screen to read it | architecture §5.2 |
| G44 | ✅ 2026-11-01 — One rides flow: cost-sharing caps and the emergency call live on the post-based flow (`0517`); the legacy `ride_listings` screens are retired — old ride links redirect to the ride's listing (`listings.legacy_ride_id`) or the rides hub, old "my rides" lists to my listings (`LegacyRideRedirect`). Leftover legacy layers are tracked in TD-244 (D70) | 05.3 |
| G45 | ✅ 2026-11-01 — Official places catalog (cities, streets, junctions & interchanges) and one place picker for origin, destination and ≤ 3 meeting points; the server refuses any other place (migrations `0512`/`0513`, tests `supabase/tests/0512_*`, `RidePlaceField`/`RideRouteFields` tests) (D71, D98) | 05.3 |
| G46 | ✅ 2026-11-01 — Every ride shows its route on the map (origin → meeting points → destination) and every place has "navigate" to Waze / Google Maps / Apple Maps; a street navigates by address (`RideRouteCard`, `RideRouteStops`, `RideRouteMap`, `rideNavigationUrl`) (D72) | 05.3 |
| G47 | ✅ 2026-11-01 — Driver sees every booking and approves or declines each; unapproved bookings expire; every booking change is a push to the other side (migration `0511`, tests `supabase/tests/0511_*`, `RideBookingActions.test.tsx`) (D73, D96) | 05.3, 07.11 |
| G48 | ✅ 2026-11-01 — Saved routes (official places, offers or requests, optional weekdays and hours, ≤ 10 per user) and alerts on new rides — origin or a pickup point and destination within the route radius; one alert per person per ride; ≤ 10 a day; held during quiet hours unless the ride leaves before they end (`0516`, tests `supabase/tests/0516_*`, `RideRouteFollow`) (D74, D95) | 05.3, 07.11 |
| G49 | ✅ 2026-11-01 — Rides quick publish (cross-platform date-time field, departure shortcuts, suggested estimated end, seats 3 within 1–8, remembered route, "publish again", offers close 30 min after their estimated end — `0514`) and the rides feed (offers + requests by departure, grouped today / tomorrow / later, departed hidden — `0515`, `RidesFeedList`) (D75, D97) | 05.3 |
| G50 | One world registry in code and DB per D100: `WORLD_SLUGS` with per-world sub-categories replaces `GIVING_WORLD_SLUGS` + `DOMAIN_SLUGS`; `transport` with `rides` sub-category; `experiences` / `environment` removed; data migration for legacy `world_slug` / `domain_slug` values; Donations tab shows the decided list; matching settings per new slug (KC#1473; absorbs the remaining parts of G2, G24, G35) | 04 |
| G51 | Primary world + additional worlds on one post (D101): `listing_worlds` table, "show also in" in the create / edit form, world feeds and the main-feed world filter include additional-world posts once, matching candidates per world (KC#1475) | 04, 07.2, 07.3 |
| G52 | ✅ 2026-11-02 — Recurring rides (#1413): `ride_series` + materializer + sweep (`0531`, test `supabase/tests/0531_*`), the create-form switch, recurrence on cards and the ride detail, "other dates" on an occurrence, "my recurring rides" with pause / reschedule / cancel (D103) | 05.3 |
| G53 | Video ("reels") on posts: listing media holds photos only (`listing_media`, `0333`); a delivered post may already add photos (D104, `0543`), video needs a media type, upload limits and a player | 07.1 |
| {{G:org-impact-stats}} | Organization impact statistics (FR-STATS-009): public impact on the organization profile and the managers' own flow funnel; needs the organization entity (ORG-P1) | 16 |
