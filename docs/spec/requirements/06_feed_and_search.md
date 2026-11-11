# 2.6 Feed, Search & Filters

> **Status:** ✅ Core Complete — Feed, filters, proximity sort, universal search shipped. ⚠️ Audit 2026-05-16: Home Feed `onEndReached` not wired → perpetual spinner past page 1 (TD-120 / POST-09); `SearchFilters` domain type lacks shared post-shape dimensions (TD-107 expansion of TD-136); FR-FEED-016 AC6 / FR-FEED-018 AC1 need clarification that shared dimensions live at the type level. See `docs/SSOT/archive/audit/2026-05-16/03_posts_closure_feed.md`.



Prefix: `FR-FEED-*`

---

## Scope

The Home Feed and its discovery affordances:

- Composition rules (which posts appear, in what order).
- Free-text search.
- Filter modal and persisted state across sessions.
- Sort options.
- Cold-start fallback (empty city → all-Israel).
- Guest preview behavior.

Non-goals (out of scope):

- Algorithmic personalization (explicitly excluded by `R-MVP-Profile-7`).
- "Friends-only" toggle (excluded by `R-MVP-Profile-8`).
- Post likes / comments / sharing (excluded — see `PRD_MVP/08_Out_of_Scope_and_Future.md`).

---

## FR-FEED-001 — Default feed composition

> ⚠️ **Superseded by the project book** — D27 — default sort is the recommendation engine ("no algorithm" no longer holds). Binding text: `docs/spec/07_cross_cutting_systems.md` §7.3. Evidence and status: `docs/spec/95_reconciliation.md` §2. The text below is kept as history (D35).

**Description.**
The Home Feed shows public posts that the viewer is allowed to see, sorted in reverse-chronological order.

**Source.**
- PRD: `03_Core_Features.md` §3.3.1.1, `05_Screen_UI_Mapping.md` §2.1.
- Constraints: `R-MVP-Profile-7`.

**Acceptance Criteria.**
- AC1. The query selects posts where:
   - `Post.status = open`, **and**
   - the viewer's visibility predicate from `FR-FOLLOW-012` permits read access. (`FR-MOD-009`'s bilateral-block filter is deferred per `EXEC-9`; the predicate still SELECTs from `is_blocked()`, which always returns `false` in MVP because `public.blocks` stays unpopulated, so the filter is a structural no-op.)
- AC2. Default ordering: `created_at DESC`.
- AC3. There is **no** algorithmic boost based on follow relationships, popularity, or category in MVP.
- AC4. Pagination: 20 posts per page; infinite scroll on mobile, "Load more" button on Web.
- AC5. *(D-206, 2026-10-31)* Native items and food listings are part of the feed through their mirror posts (`posts.listing_id`, migration `0466`; FR-POST-001 AC5). The feed card shows the listing's photo from the `listing-images` bucket and opens the listing detail.
   - *(PM, 2026-11-07)* The Home Feed shows posts only: the "Marketplace for you" listing strip is removed (the map button stays). Posts of every giving world stay in the feed, and the giving-world filter stays.

**Related.** Screens: 2.1 · Domain: `Post`, `FollowEdge`.

---

## FR-FEED-002 — Feed card composition

**Description.**
What each feed card displays.

**Source.**
- PRD: `03_Core_Features.md` §3.3.1.2, `05_Screen_UI_Mapping.md` §2.1.

**Acceptance Criteria.**
- AC1. Always shown: image OR category icon (for image-less Request posts), type badge `🎁`/`🔍`, title, 2-line truncated description with "Read more" affordance, owner row (avatar + name), location string per `Post.location_display_level`, relative timestamp.
- AC2. Conditional: `👥 Followers only` badge (when applicable to the viewer-owner pair), `🔒 Closed — delivered` badge (only when the user enabled "Include closed posts" filter).
- AC3. **Never shown in the feed**: posts at visibility `OnlyMe` (regardless of whether the viewer is the owner). Owner sees them under My Profile `⋮` → Hidden (`FR-PROFILE-001` AC4).
- AC4. Quick "💬 Send Message" icon visible on cards owned by other users (`FR-POST-018`).

**Related.** Screens: 2.1.

---

## FR-FEED-003 — Home Feed free-text search (filter sheet)

**Status.** ✅ Active (2026-05-26) — revived on the Home Feed filter sheet;
Universal Search (`FR-FEED-016`) remains the cross-entity discovery surface.

**Description.**
Free-text post matching inside the Home Feed filter/sort bottom sheet
(`FR-FEED-004`). Composes AND with post-shape filters; does not replace the
Search tab.

**Source.**
- Design: `docs/SSOT/archive/superpowers/specs/2026-05-26-home-feed-filter-search-and-compact-sheet-design.md`.

**Acceptance Criteria.**
- AC1. A search field at the top of `PostFilterSheet` filters posts by
   `title`, `description`, and `category` using case-insensitive substring
   match (`ilike`), same semantics as Universal Search posts (`FR-FEED-016`).
- AC2. **300 ms debounce** after typing stops; queries shorter than **2**
   trimmed characters do not apply (feed uses shape filters only; badge does
   not count search).
- AC3. Results respect the same visibility predicate as `FR-FEED-001` (via
   existing feed query paths).
- AC4. `searchQuery` persists in `filterStore` with other feed filters
   (`FR-FEED-005`).
- AC5. Active filter badge (`FR-FEED-004`) counts active text search as **+1**
   when AC2 applies.

---

## FR-FEED-004 — Filter modal — **REWORKED (P1.2)**

**Description.**
A bottom-sheet modal with combinable filters opened from an `options-outline`
icon in the TopBar. The icon is rendered only while the Home Feed tab is
active and disappears on tab switch. A red badge on the icon shows the count
of active filters when >0; the old in-feed "X filters active" chip
(`FR-FEED-013`) is removed.

**Source.**
- Design spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-p1-2-feed-discovery-and-filters-design.md`.
- Decisions: P1.2 Q1–Q8 (2026-05-11).

**Acceptance Criteria.**
- AC1. Filter set:
   - **Search** (top of sheet): free-text field per `FR-FEED-003`.
   - **Sort**: `Newest first` (default) / `Oldest first` / `By proximity` / `For you`. When
     `By proximity` is selected, a city picker resolves the center of the
     ranking; default is the viewer's registered city.
   - **Type**: `All` / `Givers only` / `Requesters only`.
   - **Giving world**: single-select giving world (`All` chip, plus items, rides, food, housing, time, money, knowledge, medical, animals, environment, creative, app design).
   - **World subcategory**: multi-select row displayed when a giving world is selected, loaded dynamically from that world's active child categories. Tapping `All` selects all subcategories; changing or clearing the giving world clears any selected subcategories.
   - **Item condition**: multi-select; rendered only when `Type = Givers only` and the selected world is items (or `All` / none)
     (`New` / `LikeNew` / `Good` / `Fair` / `Damaged`).
   - **Location**: city picker + radius slider (`5 / 10 / 25 / 50 / 100` km).
     When set, the feed includes only posts whose city is within the radius
     of the chosen center city. Defaults to no spatial filter.
   - **Status**: 3-mode — `Open only` (default) / `Closed only` / `All`.
   - **Source**: `All` / `Only people I follow` (`FR-FEED-020`).
- AC2. Filters compose with AND semantics. Sort is independent of filters.
- AC3. Changes **auto-commit** to the persisted store on every control change
   (chips immediately; search text after `FR-FEED-003` debounce). There is
   **no** Apply button. "Clear all" (the sheet footer action) resets and
   immediately commits the cleared state. Sheet `maxHeight` is ~55–60%
   (compact density pass; the kit `BottomSheet` `maxHeight`, spec 17 §4.1).
- AC4. The same filter vocabulary (post-shape) is available on the Universal
   Search tab via the shared design (`FR-FEED-018`). The Search tab keeps its
   additional dimensions (`resultType`, `donationCategory`, etc.) in its own
   state.

**Related.** Screens: 2.2 · `FR-FEED-013` (deprecated) · `FR-FEED-018`.
**Shared filter kit (#1457).** Implemented on top of `@kc/mobile`'s shared `filterKit` (`FilterSearchBar`, `FilterButton`, `FilterChipRow`, `FilterSection`, `SortSection`, `FilterSheetFrame`). Full component and surface inventory in spec 17 §4.1.2.

---

## FR-FEED-005 — Persisted filter state — **EXTENDED (P1.2)**

**Description.**
The user's current filters — including `searchQuery` (`FR-FEED-003`) — are
persisted across sessions.

**Source.**
- PRD: `03_Core_Features.md` §3.3.1.3.
- Constraints: `R-MVP-Privacy-8`.

**Acceptance Criteria.**
- AC1. Filter state persists in local storage (AsyncStorage on native,
   localStorage on web) on every change, keyed per signed-in user.
- AC2. On launch, the feed restores the persisted state; the active-count
   badge on the TopBar filter icon reflects this state (the in-feed chip
   from the prior contract is removed — see `FR-FEED-013` deprecated).
- AC3. Tapping "Clear all" inside the filter sheet resets state and persists
   the cleared state.
- AC4. The persistence key includes a schema version; legacy state from prior
   versions is dropped on first read and replaced by defaults (includes
   `searchQuery` from v4 onward).

**Related.** Domain: `FeedFilter` value object · `FR-FEED-004` ·
`FR-FEED-013` (deprecated).

---

## FR-FEED-006 — Sort: by proximity — **REWORKED (P1.2)**

**Description.**
The "By proximity" sort option ranks posts by great-circle distance between
the chosen center city and each post's city, in ascending order. This
replaces the prior string-equality-with-recency approach (which lumped
all non-viewer-city posts together by date).

**Source.**
- Design spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-p1-2-feed-discovery-and-filters-design.md`.
- Decisions: P1.2 Q2, Q4 (2026-05-11) and `EXEC-8` in the C decisions log.

**Acceptance Criteria.**
- AC1. Posts are ranked by `distance_km` ascending (Haversine between the
   `cities.lat/lon` of the center city and the post's city centroid). Tie-
   break by `created_at DESC` so newer posts surface first within the same
   city.
- AC2. **Center city resolution**: if `FeedFilter.proximitySortCity` is set,
   that city is the ranking center. Otherwise the viewer's registered city
   (`User.city`) is used. If neither is set, sort silently falls back to
   `Newest first` (preserves the original AC3).
- AC3. The `cities_geo` lookup (`FR-FEED-019`) is the single source of truth
   for coordinates. Cities whose lat/lon is NULL produce a `NULL`
   `distance_km` and are placed at the tail of the result set.
- AC4. The distance value is propagated through `PostWithOwner.distanceKm`
   for UI display when relevant.
- AC5. The prior MVP prohibition on geocoding (legacy AC2) is **lifted**
   under this rework; `cities_geo` is a static, server-seeded lookup, not
   a runtime geocoding service.

**Related.** Domain: `User.city`, `Post.city`, `cities_geo`, `haversine_km`.

---

## FR-FEED-007 — Cold-start fallback — **DEPRECATED (P1.2)**

**Status.** ⚠️ Deprecated by P1.2 design decision (2026-05-11).

**Rationale.** The reworked proximity sort (`FR-FEED-006`) already surfaces
the nearest available posts and continues seamlessly into farther cities
when local supply is thin. A dedicated fallback banner with a sticky chip
introduced UI complexity without observable user value, and inline
mid-feed banners were rejected as a UX anti-pattern in the brainstorming
phase.

If supply imbalances later prove to confuse users, a softer treatment can
be reintroduced as a separate FR; until then, the proximity sort fully
covers the original goal.

---

## FR-FEED-008 — Empty feed (warm) — **EXTENDED (P1.2)**

**Description.**
When the feed query returns zero posts after applying all filters, a warm
empty state is shown with adaptive copy and CTAs.

**Source.**
- Decisions: `D-15`.
- P1.2 design (2026-05-11).

**Acceptance Criteria.**
- AC1. Copy depends on whether filters are active:
   - *Filters active*: "אין פוסטים שתואמים לפילטרים שלך — נסה לנקות את
     הפילטרים או להיות הראשון לשתף."
   - *No filters*: "אין עדיין פוסטים בקהילה — תהיה הראשון לשתף משהו."
- AC2. CTAs adapt:
   - "נקה פילטרים" rendered only when at least one filter is active
     (`FilterState.activeCount > 0`); triggers `FR-FEED-005`'s clear-all.
   - "שתף פוסט" always rendered; opens `/post/create` (`FR-POST-001`).
- AC3. The empty state additionally surfaces the community counter
   (`FR-FEED-014`) as "{N} פוסטים פעילים בקהילה כרגע" when N > 0 — a soft
   reminder that the lack of results is filter-driven rather than empty
   supply.
- AC4. The empty state is fully accessible (label, focusable buttons) per
   `NFR-A11Y-002`.

**Related.** Domain: `FilterState` (local), `FR-FEED-005`, `FR-FEED-014`.

---

## FR-FEED-009 — Realtime feed freshness

**Description.**
A new public post created elsewhere appears in the feed without manual refresh, within the freshness budget.

**Source.**
- PRD: (implied; UX expectation for an active community).

**Acceptance Criteria.**
- AC1. New posts visible to the viewer surface within `NFR-PERF-005` (≤2s end-to-end at p95).
- AC2. The newly arrived post(s) are not silently injected into the user's scroll position; instead, a "↑ N new posts" banner appears at the top until the user taps it or scrolls to the top.
- AC3. The realtime channel disconnects when the screen is backgrounded for >60 seconds and reconnects on foreground; on reconnect, a single REST query reconciles missed posts.

**Related.** Domain: `Feed`, `RealtimeChannel`.

---

## FR-FEED-010 — Pull-to-refresh (mobile) and refresh button (Web)

**Description.**
Manual refresh affordances coexist with realtime updates.

**Source.**
- PRD: (UX baseline for mobile).

**Acceptance Criteria.**
- AC1. Mobile: standard pull-to-refresh gesture re-queries the feed.
- AC2. Web: a refresh button is provided next to the search bar; keyboard shortcut `R` (configurable in `06_cross_cutting/03_i18n_rtl.md`) triggers it.
- AC3. Refresh resets the pagination cursor to the top.

**Related.** Domain: `Feed`.

---

## FR-FEED-011 — Search & filters within other contexts

**Description.**
The Followers / Following lists (`FR-PROFILE-009`) and the Inbox (`FR-CHAT-001`) carry their own search bars; they are scoped and do **not** share state with the feed.

**Source.**
- PRD: `05_Screen_UI_Mapping.md` §3.4, §4.1.

**Acceptance Criteria.**
- AC1. Each list's search is isolated.
- AC2. There is no global search in MVP.

---

## FR-FEED-012 — Guest feed preview

**Description.**
The guest feed (1.7) is a constrained sub-set of the public feed.

**Source.**
- PRD: `03_Core_Features.md` §3.3.1.4.
- Constraints: `R-MVP-Core-2`.

**Acceptance Criteria.**
- AC1. Returns the 3 most recent **`Public`-visibility** posts across all of Israel.
- AC2. Quick-message, profile navigation, post detail, and filters are all blocked; tap targets surface the sign-up overlay (`FR-AUTH-014`).
- AC3. Realtime updates are disabled for guests; a guest sees a static snapshot until they sign up.

**Related.** Screens: 1.7.

---

## FR-FEED-013 — Active-filters chip — **DEPRECATED (P1.2)**

**Status.** ⚠️ Deprecated by P1.2 design decision (Q7, 2026-05-11).

**Rationale.** The same affordance now lives as a red count badge on the
TopBar filter icon (`FR-FEED-004`). Surfacing it in two places at once was
redundant and crowded the feed. The user discovers active filters through
the badge; the filter sheet itself displays which fields are set when
opened.

The original AC contract is preserved in the TopBar badge:
- visibility: shown when `activeCount > 0` (AC1 equivalent)
- discoverability: tapping opens the filter sheet (AC2 equivalent)
- count: rendered numerically up to 9, then `9+` (AC3 equivalent;
  "Clear all" moves inside the filter sheet, in its footer — spec 17 §4.1).

---

## FR-FEED-014 — Active-community counter — **EXTENDED (P1.2)**

**Description.**
A live "{N} פוסטים פעילים בקהילה" counter that surfaces in three places:
the guest banner (replacing the prior hardcoded "50+" string), the warm
empty state of the signed-in feed, and any future onboarding/marketing
surface that wants to highlight community activity.

**Source.**
- PRD: `03_Core_Features.md` §3.3.1.4.
- P1.2 design (2026-05-11).

**Acceptance Criteria.**
- AC1. Counter is computed as the number of `open` `Public`-visibility posts
   system-wide, sourced from the `community_stats` view in migration 0006.
- AC2. Client-side, the counter is fetched on mount of any consuming
   component and refreshed every 60 seconds via TanStack Query's
   `refetchInterval`.
- AC3. The number is displayed only as a non-negative integer (the use case
   `GetActivePostsCountUseCase` clamps to `Math.max(0, trunc(value))`).
- AC4. Edge-cached endpoint (originally specified) is deferred to P2.x; the
   direct view read is sufficient for MVP traffic. A TD is opened for the
   edge layer when scale demands it.

**Related.** Domain: `CommunityStats` · `community_stats` view · use case
`GetActivePostsCountUseCase`.

---

## FR-FEED-016 — Universal Search tab — **SUPERSEDED (P1.2)**

**Description.**
The dedicated Search tab (`🔍`) in the bottom bar mounts a Universal Search
screen that performs free-text matching across three result domains
simultaneously: posts, users, and donation links. This supersedes the
placeholder-only contract of the prior FR (the engine was originally
deferred to `FR-FEED-017+`; it shipped earlier than planned and now lives
under this FR ID).

**Source.**
- Earlier design: `docs/SSOT/archive/superpowers/specs/2026-05-09-donations-and-search-tabs-design.md`.
- Decisions: `D-16`, and P1.2 Q1 (2026-05-11) which retroactively documents
  the shipped engine.

**Acceptance Criteria.**
- AC1. The Search tab mounts at `/(tabs)/search`.
- AC2. A single text input runs the search across **posts**, **users**, and
   **donation links** with a 300 ms debounce; queries shorter than 2
   characters do not execute (a coaching empty state is rendered).
- AC3. Result sections are independently expandable from a 5-result preview
   to a 50-result list.
- AC4. The search remains visibility-aware: it respects the same
   `is_post_visible_to` predicate as the Home Feed. (User-blocking is
   deferred per `EXEC-9`; the predicate still references `is_blocked()` but
   that always returns `false` in MVP.)
- AC5. Recent searches are persisted to local storage (up to 10 entries) and
   are clearable from the UI.
- AC6. The Universal Search tab carries its own filter sheet that exposes,
   in addition to its own dimensions (`resultType`, `donationCategory`,
   `minFollowers`, `sortBy`), the same **post-shape** filter dimensions
   surfaced on the Home Feed (`FR-FEED-018`). The two state stores remain
   distinct but the filter vocabulary is shared.
- AC7. The screen is fully accessible per `NFR-A11Y-002`.

**Related.** Screens: 2.5 · `FR-FEED-004`, `FR-FEED-018`.

---

## FR-FEED-015 — First-post nudge card — **REWORKED (P1.2)**

**Description.**
A dismissible card at the top of the Home Feed prompts users who have not
yet created a post. The card exposes three actions with distinct lifecycles
so it can drive action without alienating users who aren't ready.

**Source.**
- Decisions: `D-9`.
- P1.2 design (2026-05-11), Q6.

**Acceptance Criteria.**
- AC1. Eligibility: the card renders when **all** of the following hold:
   - viewer is signed in,
   - `User.firstPostNudgeDismissed === false` (DB flag),
   - the session-level `firstPostNudgeDismissedThisSession` flag is false,
   - the viewer has zero open posts (`IPostRepository.countOpenByUser`).
- AC2. Copy: *"יש לך מוצר לתת? או משהו לבקש? שתף את הפוסט הראשון שלך עכשיו."*
- AC3. Three actions, in visual priority order:
   - **Primary CTA — "שתף מוצר"**: navigates to `/post/create`. Creating a
     first post implicitly hides the card via AC1's `countOpenByUser`
     check.
   - **Secondary — "תזכיר לי אחר כך"**: sets the in-memory
     `firstPostNudgeDismissedThisSession` flag. The card disappears for
     this session and returns on the next cold start.
   - **Tertiary link — "אל תציג לי שוב"**: invokes
     `DismissFirstPostNudgeUseCase` which sets
     `users.first_post_nudge_dismissed = true`. The card never appears
     again for this user.
- AC4. Accessibility: each action is a focusable button with an explicit
   accessible label.

**Related.** Domain: `User.firstPostNudgeDismissed` · use case
`DismissFirstPostNudgeUseCase` · `IPostRepository.countOpenByUser`.

---

## FR-FEED-018 — Shared post-filter vocabulary — **NEW (P1.2)**

**Description.**
The Home Feed and the Universal Search tab share a common vocabulary of
post-shape filter dimensions so users move between the two surfaces with
predictable controls.

**Source.**
- Design spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-p1-2-feed-discovery-and-filters-design.md`.

**Acceptance Criteria.**
- AC1. Shared dimensions: `type`, `categories[]`, `itemConditions[]`,
   `locationFilter {centerCity, radiusKm}`, `statusFilter` (3-mode),
   `sortOrder` (newest/oldest/distance), `proximitySortCity`.
- AC2. Implementation: each surface owns its own state store (Home Feed →
   `filterStore`; Search tab → `searchStore`) but the field names, value
   sets, and UI primitives are identical.
- AC3. The Universal Search tab additionally exposes search-only fields
   (`resultType`, `donationCategory`, `minFollowers`, search-mode
   `sortBy`). Those do not propagate to the Home Feed.

**Related.** `FR-FEED-004` · `FR-FEED-016`.

---

## FR-FEED-019 — Cities-geo lookup — **NEW (P1.2)**

**Description.**
A static reference table holding latitude / longitude for every canonical
Israeli city in `public.cities`, plus a pure-SQL `haversine_km` helper. This
is the single source of truth for any distance computation in the system.

**Source.**
- Design spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-p1-2-feed-discovery-and-filters-design.md`.
- Migration: `supabase/migrations/0021_cities_geo.sql`.

**Acceptance Criteria.**
- AC1. `public.cities` is extended with nullable `lat double precision` and
   `lon double precision` columns (sanity-bounded for Israel: lat ∈ [29.0,
   34.0], lon ∈ [34.0, 36.5]).
- AC2. The 20 canonical settlements seeded in migration 0001 are populated
   with coordinates in migration 0021.
- AC3. A pure-SQL function `public.haversine_km(lat1, lon1, lat2, lon2)`
   returns great-circle distance in kilometres; it is `immutable` and
   `parallel safe`. Returns `NULL` when any input is `NULL`.
- AC4. The companion `public.feed_ranked_ids` RPC (migration 0022) consumes
   this lookup to deliver `FR-FEED-006`'s ranking and the radius branch of
   `FR-FEED-004`'s location filter.
- AC5. Adding new cities in the future requires also populating lat/lon
   alongside the row; otherwise the post inherits a `NULL distance_km`
   and degrades to the tail of distance-sorted feeds.

**Related.** `FR-FEED-006`, `FR-FEED-004`.

---

## FR-FEED-020 — Main feed of every category + a feed per giving world

**Description.**
The main feed shows open posts of **every** create category (items, rides, food, housing, time), and the screen of each active giving world holds that world's own feed and search (the "+" tab opens the create form on it) (product book `docs/spec/07` §7.3, D5, D36; PM, 2026-11-01).

**Source.** PM request 2026-11-01 (create-form cleanup); `docs/spec/07_cross_cutting_systems.md` §7.3; `D-206` (feed mirror).

**Acceptance Criteria.**
- AC1. ✅ A published open listing of rides, housing or time appears in the main feed like items and food do today (`worlds.feed_mirror`, migration `0466`), and opening it from the feed opens the listing detail; Back returns to the feed in one step. Shipped in `0522`: `feed_mirror` on for every create category; the mirror records `posts.listing_world_slug`, so the feed card shows the world chip and icon (rides / food / housing / time) instead of "Other" (`feedCardCategory`); the mirror keeps the listing's privacy (housing and time default to followers-only, `worlds.default_anonymity_level`); launch flags never hide listings from the main feed (D60). `feed_visible_posts` re-created so the signed-in feed returns `listing_id` and the world. Tests: `supabase/tests/0522_feed_mirror_every_world.sql`, `feedCardCategory.test.ts`, `PostCardGrid.world.test.tsx`; Maestro `06-feed-open-post` covers feed → listing → Back → feed.
- AC2. ✅ Each active world screen (items, rides, food, housing, time) shows: search within the world and the world's feed of open offers and requests (subcategory + distance refinements where the world has them, `BrowseRefineChips`), plus the world's own sub-screens (my handoffs, my rides, shifts…). Done for items, food and rides (2026-11-01): `WorldHubHeader` (intro + the world's own sub-screens: my handoffs, my listings), `WorldMarketplaceHub` for items / food (search within the world, all / offers / requests chips, `BrowseRefineChips`, keyset paging, empty state with clear) and the rides feed with its route search. Housing and time (2026-11-02): `/donations/housing` and the time world screen run on the same hub; the time screen keeps the organisations' volunteering opportunities (three-row preview that expands in place) and its shifts / organizer / contact screens. Tests also: `housingTimeWorldScreens.test.tsx`, `TimeOpportunitiesSection.test.tsx`. Tests: `worldFeed.test.ts`, `WorldMarketplaceHub.test.tsx`, `useUnifiedCreateCategory.test.tsx`, Maestro `14-world-feed`.
- AC3. ✅ A world whose launch flag is off stays a portal (D60) and shows no feed. `WorldLaunchGate` on every world screen; tested for housing and time. The time world is active (`0523`); housing stays a portal until TD-245 (verification pre-check on the create form) ships.
- AC4. ✅ *(2026-11-03, `D107`)* **No request / offer buttons on a world screen.** The "+" tab opens the one create form on the world being viewed (`createCategoryForPath`), in the direction (give / request) last used in that category (`FR-POST-001` AC6). The world's links sit **under** the feed (on the rides screen under the rides feed), so the feed is the first content on every active world screen; what is shown there is AC7. Tests: `WorldMarketplaceHub.test.tsx`, `RidesFeedList.test.tsx`, `createCategories.test.ts`.
- AC5. ✅ *(2026-11-07, `#1627`)* **Unified feed component & card anatomy.** Every giving world feed and the main feed standardize on `KcCard` / `ListingCard` with unified visual layout, `PostGridSkeleton` (2-column placeholder grid) while loading, shared `EmptyState` with actionable create/clear CTAs, and `KcRefreshControl`. Design spec: `docs/superpowers/specs/2026-11-07-shared-feed-design.md`. Tests: `WorldMarketplaceHub.test.tsx`, `RidesFeedList.test.tsx`, `ListingCard.test.tsx`.
- AC6. ✅ *(2026-11-07, `#1629`)* **RTL/LTR and Hebrew/English date and locale parity.** Relative time (`timeAgo`) and ride departure formatting use `resolveDateFnsLocale` dynamically mapped to the active language (`he` / `en-US`), eliminating mixed-language strings across feeds and cards. World icons mirror start-aligned typography. Tests: `resolveDateFnsLocale.test.ts`, `ListingCard.test.tsx`, `PostCardGrid.world.test.tsx`.
- AC7. ✅ *(2026-11-11, `D149`)* **Links and knowledge of a world.** The feed of every world with a feed (items, food, rides, time, knowledge, housing, animals, challenges) ends with a short list of up to three of the world's approved community links (`FR-DONATE-007`) and a button, "לכל הקישורים והידע", to the world's **links and knowledge** screen (`/donations/<world>/links`, also in the world's title menu as "קישורים וידע"). That screen shows the full community list (when the world has one; the items world has none), then the world's curated content: the organizations it works through (`external_bodies`; a row opens the organization's site when it has one), related worlds (`world_links`; a row opens that world) and the world's knowledge topics (`knowledge_topics`, a root with its children). A section with no row is not shown; a world with no list and nothing curated shows an empty state; a failed read offers a retry. A link-only world (medical, democracy, employment) and the portal of a world whose launch flag is off (D60) show the same curated sections under their list (`WorldCuratedContent`). Tables, access and seed: migration `0024_world_content.sql`, `supabase/seed/content`. Tests: `worldContent.test.ts`, `SupabaseWorldContentRepository.test.ts`, `WorldDedicatedLinksScreen.test.tsx`, `WorldLinksPreview.test.tsx`, `WorldContentSections.test.tsx`, `WorldCuratedContent.test.tsx`, pgTAP `087_world_content.sql`, Playwright `world-links.spec.ts`.

**Related.** `FR-POST-001` AC6, `FR-DONATE-001` AC6, `FR-RIDE-*`, backlog `FEED-WORLDS`, issues `#1627`, `#1629`.

---

## FR-FEED-021 — The feed on a map

**Description.**
The map button in the top bar of the main feed and of every giving world's feed opens a map of **the same posts that feed shows, with its current filter** (PM, 2026-11-07).

**Acceptance Criteria.**
- AC1. ✅ The map runs the feed's own query (`GetFeedUseCase`, same filter and order, up to 300 posts) and places every post that has a position. The route carries the opening feed's filter (`filter` param, `encodeMapFilter`); a bare `world` param narrows to that world; no param = the whole main feed.
- AC2. ✅ A post's position is its own point (`posts.geo`), else its city's centre (`cities.lat / lon`, `FR-FEED-019`), rounded to 3 decimals (~100 m) (`postMapPoint`).
- AC3. ✅ Pins cluster by viewport; a pin or a stacked cluster opens a preview sheet of post cards; the list mode lists the posts in view; a card opens the post. Near me and the map / list toggle stay.
- AC4. ✅ The map's header has the filter button: it opens the same filter sheet (`FR-FEED-004`) on the opening feed's value; a change re-runs the map's query at once. A world's map keeps the world locked. The map's filter is its own: it does not change the feed's saved filter (`FR-FEED-005`).

**Related.** `FR-FEED-001`, `FR-FEED-004`, `FR-FEED-020`. Tests: `postMapPoint.test.ts`, `postMap.test.ts`, `WorldMarketplaceHub.test.tsx`.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.3.1–§3.3.2 and Decisions D-8, D-9, D-15. |
| 0.2 | 2026-05-09 | Added `FR-FEED-016` (Search hub placeholder) per `D-16`. |
| 0.3 | 2026-05-11 | P1.2 sweep: deprecated `FR-FEED-003, 007, 013`; reworked `FR-FEED-004, 006, 015`; extended `FR-FEED-005, 008, 014`; superseded `FR-FEED-016` (now Universal Search engine); added `FR-FEED-018` (shared filter vocabulary) and `FR-FEED-019` (cities-geo lookup). |
| 0.4 | 2026-11-01 | Added `FR-FEED-020` (main feed of every create category + a feed, search and request / offer entry per giving world) — planned. |
| 0.5 | 2026-11-01 | `FR-FEED-020` AC1 done: rides, housing and time listings mirror into the main feed with their world on the card (`0522`). |
| 0.6 | 2026-11-01 | `FR-FEED-020` AC2 for items, food and rides: request / offer, search, direction filter, refinements, sub-screens. |
| 0.7 | 2026-11-02 | `FR-FEED-020` AC2 / AC3 done: housing and time world screens; the time world is active. |
| 0.8 | 2026-11-07 | `FR-FEED-020` AC5 & AC6 (#1627, #1629): unified feed loading skeleton, card anatomy, and date locale parity across all feeds. |
| 0.9 | 2026-11-07 | Home Feed: the "Marketplace for you" listing strip is removed (`FR-FEED-001` AC5). Added `FR-FEED-021`: the map shows the opening feed's posts with its filter. |
| 0.10 | 2026-11-11 | `FR-FEED-020` AC7: every world feed ends with a short list of links and a button to the world's links and knowledge screen (`D149`, migration `0024`). |
