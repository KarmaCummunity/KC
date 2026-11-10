# Shared Feed Component & Card Anatomy — Design Specification (Issue #1627)

**Status:** Approved for implementation  
**Date:** 2026-11-07  
**Platforms:** iOS, Android, Web  
**Epic context:** Unified in-app marketplace feeds for all worlds (#1624), Issue #1627  
**Related specs:** `docs/spec/05_giving_worlds.md`, `docs/spec/17_brand_and_design_system.md`, `docs/SSOT/spec/06_feed_and_search.md`

---

## 1. Goal and Boundaries

### 1.1 Goal
Unify the presentation and behavior of all listing/post feeds across Karma Community — including the Home Feed (`app/(tabs)/index.tsx`), each individual Giving World feed (`items`, `food`, `time`, `housing`, `knowledge`, `animals`), and the Rides Hub feed (`rides`).

Every feed in the application must share:
1. **One unified card anatomy (`ListingCard` / `KcCard`)** rendering images, world placeholder glyphs, badges, author info, titles, category chips, world-specific details (routes, dates, seats), and location/relative-time footers.
2. **Unified feed list states**: identical loading skeleton (`PostGridSkeleton`), error handling with retry CTA, pull-to-refresh (`KcRefreshControl`), empty states with creation/clear-filter CTAs, and tab bar scroll insets.
3. **No private feed implementations**: eliminate ad-hoc cards and diverging layouts so that testing, RTL/LTR mirroring, and translations behave identically across the app.

---

## 2. Card Anatomy

All feeds render through the shared card foundation (`KcCard` / `ListingCard`). The card layout adheres to the following structural hierarchy:

```
┌──────────────────────────────────────────────────┐
│ [Visual Header]                                  │
│  - Image (400px thumb, fallback to full) OR      │
│    World Glyph (40pt) on tone-tinted background   │
│  - Tone Badge: "הצעה" (Give) / "בקשה" (Request)  │
│  - Overflow Menu (top-end corner)                │
├──────────────────────────────────────────────────┤
│ [Publisher / Author Row]                         │
│  - Avatar (24pt) + Display Name                  │
├──────────────────────────────────────────────────┤
│ [Title & Chip Row]                               │
│  - Title (max 2 lines, clean text)               │
│  - World / Category Chip (end-aligned)           │
├──────────────────────────────────────────────────┤
│ [World-Specific Detail Rows] (if applicable)     │
│  - Route: From ──[mirrored arrow]──> To          │
│  - Details: [icon] time · [icon] seats / dates   │
├──────────────────────────────────────────────────┤
│ [Footer]                                         │
│  - Location: [pin icon] City / Distance (km)     │
│  - Relative Time: "לפני 5 דקות" / "5m ago"       │
└──────────────────────────────────────────────────┘
```

### 2.1 World Placeholder Icons
When a post or listing has no uploaded photograph, the card renders a prominent 40pt icon centered on a themed tint surface (`primarySurface` for Give, `secondary18` for Request):
- `items`: `gift-outline`
- `food`: `restaurant-outline`
- `rides`: `car-outline`
- `housing`: `home-outline`
- `knowledge`: `school-outline`
- `time`: `time-outline`
- `animals`: `paw-outline`
- `money`: `cash-outline`
- Fallback: `pricetag-outline`

### 2.2 Directional and Locale Mirroring (RTL / LTR)
- **Route arrows**: rendered via `MirroredIcon` to point start-to-end according to the layout direction (right-to-left in Hebrew, left-to-right in English).
- **Text alignment**: all headings, titles, publisher names, and detail rows align to the reading start side (`flex-start`).
- **Dates and relative time**: formatted using the active i18next language (`resolveDateFnsLocale(i18n.language)`), preventing mixed Hebrew/English strings.

---

## 3. Feed List Component States

Every world feed and the main feed standardizes on the following states:

| State | Behavior & Visual Presentation | Component Hook |
|---|---|---|
| **Loading** | 2-column grid skeleton (`PostGridSkeleton`) mirroring the card anatomy (image box, author dot, title lines, footer). No bare blank spaces or unstyled spinners. | `<PostGridSkeleton columns={2} />` |
| **Loaded (Data)** | 2-column grid (`KcFlashList` or `SectionList` for day groupings) with `kcGridCell` cells and standard padding. | `<ListingCard />` in grid cell |
| **Pull-to-Refresh** | Native `KcRefreshControl` respecting light/dark theme colors. | `<KcRefreshControl refreshing={...} onRefresh={...} />` |
| **Pagination** | Infinite scrolling with `onEndReachedThreshold={LIST_END_THRESHOLD}` (0.4) and loading indicator at the list end. | `usePrefetchNextPage` |
| **Empty (No content)** | Contextual illustration/icon + headline + description + CTA button to create a post in that world. | `EmptyState` + `PrimaryButton` |
| **Empty (Filters)** | "No results matching your filters" + CTA button to clear filters. | `EmptyState` + `onClearFilters` |
| **Error (Network/RPC)**| Offline cloud icon + "Failed to load" + `Retry` primary button. | `EmptyState` + `onRetry` |

---

## 4. Implementation Plan

1. **Card consistency**:
   - Add missing `animals: 'paw-outline'` to `WORLD_ICON` in `ListingCard.tsx`.
   - Update `formatRideTime` and `PostCardGrid` to format dates dynamically according to `resolveDateFnsLocale(i18n.language)`.
2. **Skeleton & loading unification**:
   - Update `WorldMarketplaceHub` to render `PostGridSkeleton` when `feed.isLoading` is true.
   - Update `RidesFeedList` to render `PostGridSkeleton` when `feed.isLoading` is true.
3. **i18n & RTL/LTR QA check (Issue #1629)**:
   - Audit all locale strings in `he` and `en` across feeds, cards, rides, and create forms.
   - Verify that all chevrons and direction icons use `MirroredIcon` or directional navigation.
   - Run full regression test suite (`pnpm test`, `pnpm typecheck`, `pnpm lint:arch`, `pnpm lint:i18n`).
