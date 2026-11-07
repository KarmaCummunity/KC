# Mobile Screen Design System Audit (Issue #1023)

> **Design Audit Report — Karma Community (`app/apps/mobile`)**  
> **Source of Truth:** [Spec 17 — Brand and Design System](../spec/17_brand_and_design_system.md) (Decisions D65, D66, D67, D87, D93, D99), `@kc/ui` design tokens, and the mobile UI kit (`app/apps/mobile/src/components/ui/`).  
> **Automated Guard & Baseline:** `app/apps/mobile/brand-guard.baseline.json` (frozen ratchet baseline, 177 files, 1,115 line/modal/icon findings) and `brandGuard.test.ts` / `brandGuardRules.ts`.  
> **Date:** November 2026  
> **Status:** Comprehensive Monorepo Audit Complete

---

## 1. Executive Summary & Audit Overview

This audit systematically evaluates every main screen and user journey of the Karma Community mobile application (`app/apps/mobile`) against the design system defined in **Spec 17** and implemented in **`@kc/ui`**. 

Karma Community follows a strict clean-architecture and token-driven design standard:
1. **Zero Hard-Coded Literals:** All visual properties (colors, typography size/weight/family, spacing, border radii, icon sizes, z-index layering, and elevations/shadows) must resolve to `@kc/ui` design tokens.
2. **Shared UI Kit Primitives:** Screens must never hand-roll raw primitive controls. Form fields use `TextField`; centered dialogs use `Modal`; bottom sheets use `BottomSheet`; filter tags use `Chip`; action calls use the kit buttons (`PrimaryButton`, `SecondaryButton`, `GhostButton`, `DangerButton`, `AlertButton`); multi-category filter sheets use `filterKit`.
3. **RTL Bidirectionality Invariant:** Hebrew is the primary MVP locale (RTL-first). Code must use logical sides (`marginStart`, `paddingEnd`, `borderTopStartRadius`, `rtlTextAlignStart`, `rowDirectionStart`) and never physical `left` or `right`. Directional icons must mirror via `MirroredIcon` or `useDirectionalBackIcon()`.
4. **Single Primary CTA per Screen (D99 §8.1):** Exactly one full-width primary button per screen to guide user focus through the listing or transaction lifecycle.

### Monorepo Audit KPIs

| KPI Metric | Baseline Count | Target State | Notes |
|---|---|---|---|
| **Total Scanned Files with Findings** | **177 files** | 0 files | Frozen in `brand-guard.baseline.json`; ratchet only allows downward movement |
| **Total Hard-Coded Finding Count** | **1,115 findings** | 0 findings | Sum of all line rules, raw modal imports, and icon literals |
| **Raw `TextInput` Controls** | **31 occurrences** in 22 files | 0 | Must migrate to kit `TextField` (except chat composer with allow-marker) |
| **Raw React Native `Modal`s** | **6 occurrences** in 5 files | 0 | Must migrate to kit `Modal` or `BottomSheet` |
| **Ad-Hoc Chip Styles (`chip: { ... }`)** | **17 occurrences** in 17 files | 0 | Must migrate to kit `Chip` (`filter`, `tag`, or `removable`) |
| **Hand-Rolled CTAs (`backgroundColor: colors.primary`)** | **67 occurrences** in 67 files | 0 | Outside UI kit; must use `PrimaryButton` / `SecondaryButton` / `DangerButton` |
| **Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`)** | **42 occurrences** in 25 files | 0 | Breaks RTL mirroring in Hebrew UI; must use logical start/end |
| **Unmirrored Directional Icons** | **28 occurrences** in 26 files | 0 | Directional chevrons/arrows must wrap in kit `MirroredIcon` |
| **Color Literals (hex / rgba literals)** | **40 occurrences** | 0 | Must use `useTheme()` / `makeUseStyles()` semantic tokens |
| **Spacing Literals (margin / padding / gap numbers)** | **271 occurrences** | 0 | Must use `spacing.*` (4pt scale) |
| **Radius Literals (`borderRadius` numbers)** | **140 occurrences** | 0 | Must use `radius.*` (xs 4, sm 8, md 12, lg 16, xl 24, full) |
| **Typography Literals (`fontSize` / `fontWeight` numbers)** | **328 occurrences** (142 font size, 186 weight) | 0 | Must use `typography.*` presets and weight modifiers |
| **Icon Size Literals (`<Ionicons size={N}>`)** | **101 occurrences** | 0 | Must use `iconSize.*` tokens (xs 14, sm 16, md 18, lg 20, xl 22, 2xl 24) |
| **Shadow & Layer Literals (`elevation`, `shadowOpacity`, `zIndex`)** | **109 occurrences** (100 shadows, 9 z-index) | 0 | Must use `shadow.*` and `zIndex.*` presets |

---

## 2. Design System Foundations & Kit Standards

The audit measures compliance against the core tokens and components in `@kc/ui` and `src/components/ui/`:

### 2.1 Design Tokens Contract

```
packages/ui/src/theme/
├── colors.ts        → lightColors & darkColors (primary #C2410C, secondary #203050, surface, background #FFFBF7)
├── typography.ts    → Rubik font scale: h1-h4, bodyLarge, body, bodySmall, button, label, caption; modifiers medium-extraBold
├── spacing.ts       → 4-based scale (xs 4, sm 8, md 12, lg 16, xl 24, 2xl 32, 3xl 40, 4xl 48); radius (xs-xl, full); shadow presets
├── iconSize.ts      → xs 14, sm 16, md 18, lg 20, xl 22, 2xl 24
├── zIndex.ts        → base 0, raised 1, overlay 2, floating 20, toast 9999
└── breakpoints.ts   → mobile <768, tablet 768-1023, desktop 1024-1439, wide >=1440
```

### 2.2 Standard UI Kit Components

| Need | UI Kit Control | Location | Standard Behavior & Invariants |
|---|---|---|---|
| **Form Input** | `TextField` | `src/components/ui/TextField.tsx` | Labeled input with helper, validation error, start/end icons, multiline auto-expand, RTL alignment. Replaces raw `<TextInput>`. |
| **Centered Dialog** | `Modal` | `src/components/ui/Modal.tsx` | Centered modal on `surfaceRaised`, `radius.xl`, `shadow.modal`, backdrop dismiss, escape dismiss, VoiceOver title announcement. |
| **Bottom Sheet** | `BottomSheet` | `src/components/ui/BottomSheet.tsx` | Grab handle, docked to screen bottom, safe area aware, scrollable body with pinned action footer. Replaces raw `<Modal>`. |
| **Tags & Badges** | `Chip` | `src/components/ui/Chip.tsx` | Variants: `filter` (selection checkbox), `tag` (read-only tone-tinted status), `removable` (with trailing ✕); sizes `md` (36pt) and `sm` (28pt). Minimum 44pt tap target. |
| **Buttons & CTAs** | `PrimaryButton`, `SecondaryButton`, `GhostButton`, `DangerButton`, `AlertButton` | `src/components/ui/Buttons.tsx` | Sizes: `lg` (56pt), `md` (48pt), `sm` (36pt). Destructive actions use `DangerButton` (`colors.error`). Emergency alarm uses `AlertButton` (Spec 17 §8.1). Single primary button per screen. |
| **Filter & Search** | `filterKit` | `src/components/filterKit/` | Standardized `FilterSearchBar`, `FilterButton`, `FilterChipRow`, `FilterSection`, `SortSection`, and `FilterSheetFrame`. |
| **Icon Mirroring** | `MirroredIcon`, `useDirectionalBackIcon` | `src/components/ui/MirroredIcon.tsx` | Directional icons automatically flip 180° in RTL layouts. iOS uses chevron-back, Android/web uses arrow-back. |

---

## 3. Screen-by-Screen Audit Catalog

Each screen of the application is mapped from the Expo Router file structure (`app/**`), associated sub-components and style files, store screenshot visual references, kit component adoption status, and exact brand-guard baseline findings.

### Cluster 1 — Feed & Post Flow

> The core social engagement loop of Karma Community: exploring community requests and offers, publishing new needs/gifts, editing posts, viewing post details, and completing handoffs/closures.

#### 1.1 Home Feed (Community Feed)

- **Route Path:** `app/(tabs)/index.tsx`
- **Store Screenshot Reference:** [View Visual Screenshot](../store/screenshots/iphone-6.5/01-feed.png)

  ![Home Feed (Community Feed)](../store/screenshots/iphone-6.5/01-feed.png)

##### Design System Kit Adoption Status
- **`TextField`:** N/A (Feed uses SearchFilterSheet)
- **`Modal` / `BottomSheet`:** Compliant (`PostMenuSheet` migrated to `BottomSheet`)
- **`Chip`:** Compliant (Feed filter sections use kit `Chip`, `sm`)
- **Buttons & CTAs:** Partially Compliant (EmptyState & FirstPostNudge use kit buttons; SurveyPromptBanner has hand-rolled CTA)
- **`filterKit`:** Compliant (`components/PostFilterSheet/*` fully on `filterKit`)
- **`MirroredIcon`:** Deviations present (`KcCard.tsx` and `KcRowCard.tsx` use unmirrored chevron icons)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **81** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 3 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 2 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 4 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 21 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 29 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 8 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 16 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/FeedEmptyState.tsx` — Total Findings: **2** (`fontWeightLiteral`: 1, `iconSizeLiteral`: 1)
- `src/components/NewPostsBanner.tsx` — Total Findings: **6** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 1, `shadowLiteral`: 4, `iconSizeLiteral`: 1)
- `src/components/PostCardGrid.styles.ts` — Total Findings: **38** (`colorLiteral`: 4, `fontSizeLiteral`: 12, `fontWeightLiteral`: 5, `spacingLiteral`: 13, `shadowLiteral`: 4)
- `src/components/cards/KcCard.tsx` — Total Findings: **5** (`iconSizeLiteral`: 4, `unmirroredDirectionalIcon`: 1)
- `src/components/cards/KcCard.styles.ts` — Total Findings: **7** (`fontSizeLiteral`: 3, `fontWeightLiteral`: 1, `spacingLiteral`: 3)
- `src/components/cards/KcRowCard.tsx` — Total Findings: **3** (`iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 1)
- `src/components/cards/KcRowCard.styles.ts` — Total Findings: **7** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 3, `spacingLiteral`: 3)
- `src/components/skeletons/PostGridSkeleton.tsx` — Total Findings: **1** (`spacingLiteral`: 1)
- `src/components/survey/SurveyPromptBanner.tsx` — Total Findings: **3** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 2, `spacingLiteral`: 1)
- `src/components/warmPromptCardStyles.ts` — Total Findings: **9** | Hand-rolled CTAs: **1** (`radiusLiteral`: 1, `shadowLiteral`: 8)

---

#### 1.2 Guest Feed (Signed-Out Public Preview)

- **Route Path:** `app/(guest)/feed.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant (`GuestJoinModal` migrated to kit `BottomSheet`)
- **`Chip`:** N/A
- **Buttons & CTAs:** Deviations present (Hand-rolled CTA buttons in `src/screens/guest/feed.styles.ts`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **1** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/screens/guest/feed.styles.ts` — Total Findings: **1** | Hand-rolled CTAs: **2** (`spacingLiteral`: 1)

---

#### 1.3 Post Detail

- **Route Path:** `app/post/[id].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`PostEngagementSection.tsx` has raw `TextInput` comment input)
- **`Modal` / `BottomSheet`:** Deviations present (`PostImageViewerModal.tsx` uses raw React Native `Modal` for image preview)
- **`Chip`:** Deviations present (`PostDetailHeader.tsx` defines ad-hoc `chip` style; status badge uses `pill` pattern)
- **Buttons & CTAs:** Deviations present (Hand-rolled primary CTAs in `postDetailScreen.styles.ts`, `PostEngagementSection.tsx`, `ExpiredRepublishView.tsx`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`PublisherCard.tsx`, `RecipientCallout.tsx`, `PostDetailScrollContent.tsx` use unmirrored directionals)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **98** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 1 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 6 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 3 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 12 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 16 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 5 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 25 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 14 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 20 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/screens/post/postDetailScreen.styles.ts` — Total Findings: **39** | Hand-rolled CTAs: **2** (`colorLiteral`: 6, `fontSizeLiteral`: 3, `fontWeightLiteral`: 7, `spacingLiteral`: 5, `zIndexLiteral`: 2, `shadowLiteral`: 16)
- `src/screens/post/PostDetailScrollContent.tsx` — Total Findings: **7** (`iconSizeLiteral`: 6, `unmirroredDirectionalIcon`: 1)
- `src/components/cards/PostDetailHeader.tsx` — Total Findings: **4** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `spacingLiteral`: 1, `adHocChip`: 1)
- `src/components/post-detail/PostEngagementSection.tsx` — Total Findings: **3** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 2, `rawTextInput`: 1)
- `src/components/post-detail/PublisherCard.tsx` — Total Findings: **1** (`unmirroredDirectionalIcon`: 1)
- `src/components/post-detail/RecipientCallout.tsx` — Total Findings: **8** (`colorLiteral`: 1, `fontWeightLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 1, `iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 1)
- `src/components/post-detail/RecipientUnmarkBar.tsx` — Total Findings: **1** (`fontWeightLiteral`: 1)
- `src/components/PostImageViewerModal.tsx` — Total Findings: **10** (`colorLiteral`: 3, `fontWeightLiteral`: 1, `radiusLiteral`: 1, `spacingLiteral`: 1, `zIndexLiteral`: 2, `rawModal`: 1, `iconSizeLiteral`: 1)
- `src/components/PostImageCarousel.tsx` — Total Findings: **8** (`colorLiteral`: 2, `fontWeightLiteral`: 1, `radiusLiteral`: 2, `spacingLiteral`: 2, `iconSizeLiteral`: 1)
- `src/components/post/VisibilityChooser.tsx` — Total Findings: **4** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 2, `radiusLiteral`: 1)
- `src/components/post/ExpiredRepublishView.tsx` — Total Findings: **2** | Hand-rolled CTAs: **1** (`iconSizeLiteral`: 2)
- `src/components/post/CounterpartyIdentityCard.tsx` — Total Findings: **2** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1)
- `src/components/post/PostMenuButton.tsx` — Total Findings: **3** (`spacingLiteral`: 2, `iconSizeLiteral`: 1)
- `src/components/post/PostMenuExposureBlock.tsx` — Total Findings: **1** (`fontSizeLiteral`: 1)
- `src/components/post/PostShareButton.tsx` — Total Findings: **5** (`spacingLiteral`: 4, `iconSizeLiteral`: 1)
- `src/components/post-detail/PostDetailStatusBadge.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 1.4 Create Post (Post Creation Flow)

- **Route Path:** `app/create.tsx` (root stack, opens over the current screen)
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (Form fields migrated to kit `TextField`)
- **`Modal` / `BottomSheet`:** Compliant (City selection delegates to `SearchablePicker`; photo picker uses `PhotoSourceSheet`)
- **`Chip`:** Compliant (Category selection uses kit chips)
- **Buttons & CTAs:** Deviations present (Hand-rolled CTA in `create.styles.ts` submit bar)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **4** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 1 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 2 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 1 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/CreatePostForm/CreatePostFormScrollContent.tsx` — Total Findings: **1** (`physicalSide`: 1)
- `src/components/CreatePostForm/CreatePostExposureSection.tsx` — Total Findings: **1** (`iconSizeLiteral`: 1)
- `src/components/CreatePostForm/EstimatedValueSlider.tsx` — Total Findings: **1** (`spacingLiteral`: 1)
- `src/components/CreatePostForm/LocationDisplayLevelChooser.tsx` — Total Findings: **1** (`spacingLiteral`: 1)
- `src/screens/tabs/create.styles.ts` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 1.5 Edit Post

- **Route Path:** `app/edit-post/[id].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Severe Deviation (`EditPostFormScrollContent.tsx` contains 4 raw `TextInput`s instead of kit `TextField`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`editPostScreen.styles.ts` defines ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (4 hand-rolled CTAs in `editPostScreen.styles.ts`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **16** | 0 |
| Raw `TextInput` | 4 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 4 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 6 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 2 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 1 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/edit-post/[id].tsx` — Total Findings: **1** (`iconSizeLiteral`: 1)
- `src/screens/edit-post/editPostScreen.styles.ts` — Total Findings: **6** | Hand-rolled CTAs: **4** (`radiusLiteral`: 2, `spacingLiteral`: 1, `physicalSide`: 2, `adHocChip`: 1)
- `src/components/post/EditPostFormScrollContent.tsx` — Total Findings: **8** (`physicalSide`: 4, `rawTextInput`: 4)
- `src/components/post/EditPostExposureSection.tsx` — Total Findings: **1** (`fontSizeLiteral`: 1)

---

#### 1.6 Post Closure & Reopen Flow

- **Route Path:** `src/components/closure/ClosureSheet.tsx (Invoked from Post Detail)`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`ClosureRecipientPanes.tsx` uses raw `TextInput` for custom recipient entry)
- **`Modal` / `BottomSheet`:** Compliant (`ClosureSheet` migrated to `BottomSheet`, `ClosureExplainerSheet` and `ReopenConfirmModal` migrated to kit `Modal`)
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 1 migrated `OwnerActionsBar` to kit `PrimaryButton` / `SecondaryButton`; selection indicators kept raw)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **31** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 1 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 14 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 6 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 9 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/closure/ClosureRecipientPanes.tsx` — Total Findings: **19** (`fontSizeLiteral`: 2, `fontWeightLiteral`: 2, `radiusLiteral`: 3, `spacingLiteral`: 10, `physicalSide`: 1, `rawTextInput`: 1)
- `src/components/closure/RecipientPickerRow.tsx` — Total Findings: **12** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 3, `fontWeightLiteral`: 2, `radiusLiteral`: 3, `spacingLiteral`: 4)
- `src/components/closure/ClosureExplainerSheet.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

### Cluster 2 — Universal Search

> Multi-domain universal search across posts, goods, rides, nonprofits, volunteer shifts, and user profiles, complete with filter bottom sheets and recent query history.

#### 2.1 Universal Search Screen & Filter Sheet

- **Route Path:** `app/(tabs)/search.tsx`
- **Store Screenshot Reference:** [View Visual Screenshot](../store/screenshots/iphone-6.5/05-search.png)

  ![Universal Search Screen & Filter Sheet](../store/screenshots/iphone-6.5/05-search.png)

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (`FilterSearchBar` used for query input)
- **`Modal` / `BottomSheet`:** Compliant (`SearchFilterSheet` migrated to kit `BottomSheet`)
- **`Chip`:** Compliant (`SearchChip` thin adapter over kit `Chip`)
- **Buttons & CTAs:** Compliant (`PrimaryButton` for filter apply, `GhostButton` for clear)
- **`filterKit`:** Fully Compliant (Search input, filter button, filter sheet frame, sort sections standardized on `filterKit`)
- **`MirroredIcon`:** Deviations present (`SearchRecentSection.tsx` and `UserResultCard.tsx` use unmirrored directional chevrons)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **32** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 2 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 8 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 2 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 7 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 13 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/search/SearchRecentSection.tsx` — Total Findings: **3** (`iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 1)
- `src/components/search/UserResultCard.tsx` — Total Findings: **4** (`iconSizeLiteral`: 3, `unmirroredDirectionalIcon`: 1)
- `src/components/search/LinkResultCard.tsx` — Total Findings: **2** (`iconSizeLiteral`: 2)
- `src/components/search/SearchResultSections.tsx` — Total Findings: **4** (`iconSizeLiteral`: 4)
- `src/components/search/SearchSocialSections.tsx` — Total Findings: **1** (`iconSizeLiteral`: 1)
- `src/components/search/searchResultCard.styles.ts` — Total Findings: **17** (`fontSizeLiteral`: 4, `fontWeightLiteral`: 3, `radiusLiteral`: 2, `spacingLiteral`: 8)
- `src/components/aside/RecentSearchesAside.tsx` — Total Findings: **1** (`iconSizeLiteral`: 1)

---

### Cluster 3 — Giving Hub & Marketplace (Goods / Items)

> The six Giving Worlds navigation hub, general marketplace feed, listing details, interactive geographic map, and listing management.

#### 3.1 Donations Hub (Giving Worlds Root)

- **Route Path:** `app/(tabs)/donations/index.tsx`
- **Store Screenshot Reference:** [View Visual Screenshot](../store/screenshots/iphone-6.5/02-donations.png)

  ![Donations Hub (Giving Worlds Root)](../store/screenshots/iphone-6.5/02-donations.png)

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`app/(tabs)/donations/index.tsx` and `DonationTile.tsx` have unmirrored arrow / chevron icons)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **5** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 2 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 1 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/(tabs)/donations/index.tsx` — Total Findings: **1** (`unmirroredDirectionalIcon`: 1)
- `src/components/DonationTile.tsx` — Total Findings: **4** (`fontSizeLiteral`: 1, `spacingLiteral`: 1, `iconSizeLiteral`: 1, `unmirroredDirectionalIcon`: 1)

---

#### 3.2 Marketplace Goods Feed

- **Route Path:** `app/(tabs)/donations/marketplace/index.tsx`
- **Store Screenshot Reference:** [View Visual Screenshot](../store/screenshots/iphone-6.5/03-marketplace.png)

  ![Marketplace Goods Feed](../store/screenshots/iphone-6.5/03-marketplace.png)

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`listingChipStyles.ts` defines ad-hoc `chip` style; `BrowseRefineChips` migrated to kit `Chip`)
- **Buttons & CTAs:** Compliant
- **`filterKit`:** Compliant (`WorldFeedControls` and `BrowseRefineChips` use `filterKit`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **1** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/marketplace/listingChipStyles.ts` — Total Findings: **1** (`adHocChip`: 1)

---

#### 3.3 Marketplace Listing Detail

- **Route Path:** `app/(tabs)/donations/marketplace/[listingId].tsx & app/listing/[listingId].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant (`ReportListingModal` migrated to `report/ReportSheet`)
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 2 migrated `ListingDetailActions` and handoff actions to `PrimaryButton` and `SecondaryButton`; single primary enforced per D99)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 3.4 Marketplace Map

- **Route Path:** `app/(tabs)/donations/marketplace/map.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`MapExplorer.styles.ts` has ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (2 hand-rolled CTAs in `MapExplorer.styles.ts`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **48** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 2 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 3 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 16 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 10 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 4 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 12 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/map/MapExplorer.styles.ts` — Total Findings: **48** | Hand-rolled CTAs: **2** (`colorLiteral`: 3, `fontWeightLiteral`: 4, `radiusLiteral`: 10, `spacingLiteral`: 16, `physicalSide`: 2, `shadowLiteral`: 12, `adHocChip`: 1)

---

#### 3.5 Marketplace My Listings & Listing Edit

- **Route Path:** `app/(tabs)/donations/marketplace/my-listings.tsx & my-listings/edit/[listingId].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (Edit listing migrated to kit `TextField`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 2 migrated `lg` save to kit `PrimaryButton`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 3.6 Giving World Feeds (Food, Housing, Items, Knowledge, Experiences, Category, Domain)

- **Route Path:** `app/(tabs)/donations/{items,food,housing,knowledge,experiences,category,domain}/**`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** Compliant (`WorldFeedControls` adopted)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **3** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/giving/worldHubStyles.ts` — Total Findings: **3** (`fontWeightLiteral`: 1, `radiusLiteral`: 1, `spacingLiteral`: 1)

---

### Cluster 4 — Money & Nonprofits (Giving Money)

> Directory of verified philanthropic organizations, nonprofit profiles, transparent financial breakdown, donation checkout flows, standing orders, and receipt generation.

#### 4.1 Verified Nonprofits Directory

- **Route Path:** `app/(tabs)/donations/money/index.tsx`
- **Store Screenshot Reference:** [View Visual Screenshot](../store/screenshots/iphone-6.5/04-nonprofits.png)

  ![Verified Nonprofits Directory](../store/screenshots/iphone-6.5/04-nonprofits.png)

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant (`AddDonationLinkModal` migrated to kit `BottomSheet`)
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 2 & 3 migrated actions; CampaignProgressBar is a progress track)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **15** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 3 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 3 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 6 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 4 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/money/CampaignProgressBar.tsx` — Total Findings: **3** | Hand-rolled CTAs: **1** (`radiusLiteral`: 2, `spacingLiteral`: 1)
- `src/components/money/ExternalDonationNotice.tsx` — Total Findings: **1** | Hand-rolled CTAs: **1** (`radiusLiteral`: 1)
- `src/components/money/SupportKcCard.tsx` — Total Findings: **1** (`iconSizeLiteral`: 1)
- `src/components/money/SupportKcDisclosure.tsx` — Total Findings: **2** (`fontWeightLiteral`: 1, `iconSizeLiteral`: 1)
- `src/components/money/VerifiedNonprofitsSection.tsx` — Total Findings: **4** (`fontWeightLiteral`: 1, `radiusLiteral`: 2, `spacingLiteral`: 1)
- `src/components/DonationLinkRow.tsx` — Total Findings: **4** (`radiusLiteral`: 1, `spacingLiteral`: 1, `iconSizeLiteral`: 2)
- `src/components/DonationLinksList.styles.ts` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 4.2 Nonprofit Detail Screen

- **Route Path:** `app/(tabs)/donations/money/nonprofit/[slug].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 2 migrated 'donate now' `PrimaryButton` and 'monthly gift' `SecondaryButton`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 4.3 Donation Checkout & Standing Order Form

- **Route Path:** `app/(tabs)/donations/money/donate/[orgId].tsx & standing-order/[orgId].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (`AmountCheckoutForm` uses kit `TextField`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant (Preset donation amounts use kit `Chip`)
- **Buttons & CTAs:** Compliant (`lg` `PrimaryButton` checkout submit)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 4.4 Donation History & Standing Orders List

- **Route Path:** `app/(tabs)/donations/money/history.tsx & standing-orders.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **3** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/(tabs)/donations/money/history.tsx` — Total Findings: **1** (`spacingLiteral`: 1)
- `app/(tabs)/donations/money/standing-orders.tsx` — Total Findings: **2** (`fontWeightLiteral`: 1, `radiusLiteral`: 1)

---

#### 4.5 Donation Tax Receipt Screen

- **Route Path:** `app/(tabs)/donations/money/receipt/[paymentId].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **2** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/(tabs)/donations/money/receipt/[paymentId].tsx` — Total Findings: **2** (`fontWeightLiteral`: 1, `radiusLiteral`: 1)

---

### Cluster 5 — Time & Volunteering (Giving Time)

> Volunteering opportunities directory, shift sign-up and management, organizer event creation dashboard, and volunteer roster verification.

#### 5.1 Volunteering Hub & Opportunity Detail

- **Route Path:** `app/(tabs)/donations/time/index.tsx & opportunity/[opportunityId].tsx & support.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 2 migrated cards to `md` kit buttons and publish to `lg` `PrimaryButton`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 5.2 My Volunteer Shifts & Volunteers Roster

- **Route Path:** `app/(tabs)/donations/time/my-shifts.tsx & shift/[shiftId]/volunteers.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **3** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/(tabs)/donations/time/my-shifts.tsx` — Total Findings: **1** (`fontWeightLiteral`: 1)
- `app/(tabs)/donations/time/shift/[shiftId]/volunteers.tsx` — Total Findings: **2** (`radiusLiteral`: 1, `spacingLiteral`: 1)

---

#### 5.3 Time Organizer Dashboard & Opportunity Creator

- **Route Path:** `app/(tabs)/donations/time/organizer/index.tsx & create.tsx & [opportunityId].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 2 migrated shift links to `GhostButton` and close action to `DangerButton` per D94)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 5.4 Time Handoffs

- **Route Path:** `app/(tabs)/donations/time/handoffs.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

### Cluster 6 — Rides (Giving Transportation)

> Carpooling and mutual-aid rides matching, driver/passenger booking flow, live tracking of active journeys, emergency alerts, rating and handoffs.

#### 6.1 Rides Feed, Search & Series

- **Route Path:** `app/(tabs)/donations/rides/index.tsx & series.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (`RidePlaceField` with `SearchablePicker`)
- **`Modal` / `BottomSheet`:** Compliant (`RideFilterSheet` migrated to `BottomSheet`)
- **`Chip`:** Compliant (`RideFilterSheet` uses `sm` kit `Chip`)
- **Buttons & CTAs:** Compliant (`RideRouteFollow.tsx` uses primary color for route track indicator)
- **`filterKit`:** Compliant (`RideFilterSheet` standardized on `filterKit`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/giving/RideRouteFollow.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 6.2 Ride Detail, Active Tracking & Rating

- **Route Path:** `app/(tabs)/donations/rides/[id]/index.tsx & active.tsx & rate.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (`HandoffRatingForm` on kit `TextField`)
- **`Modal` / `BottomSheet`:** Compliant (`DriverDeclarationSheet` and `RideTransportLinksSheet` on `BottomSheet`)
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 2 migrated booking buttons; emergency call migrated to kit `AlertButton` per D99/§8.1)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 6.3 My Rides, Requests & Ride Handoffs

- **Route Path:** `app/(tabs)/donations/rides/my-rides.tsx & my-requests.tsx & handoffs.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (`marketplace/HandoffActionButton` adopted)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

### Cluster 7 — Chat & Messaging

> Direct real-time 1:1 messaging between giver and receiver, system moderation bubbles, contextual post cards, and reaction chips.

#### 7.1 Chat Inbox

- **Route Path:** `app/chat/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (`FilterSearchBar` used for conversation search)
- **`Modal` / `BottomSheet`:** Compliant (`HideChatConfirmModal` migrated to kit `Modal`)
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant
- **`filterKit`:** Compliant (`FilterSearchBar` adopted)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **9** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 2 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 2 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 3 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 1 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/chat/InboxChatRow.tsx` — Total Findings: **7** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 1, `physicalSide`: 1, `iconSizeLiteral`: 1)
- `src/components/skeletons/InboxListSkeleton.tsx` — Total Findings: **2** (`spacingLiteral`: 1, `physicalSide`: 1)

---

#### 7.2 Chat Conversation Screen

- **Route Path:** `app/chat/[id].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Exempt (`ChatInputBar` has `brand-guard-allow: non-form chat composer` per Spec 17 §4)
- **`Modal` / `BottomSheet`:** Compliant (`ChatActionMenu` migrated to `ActionMenuSheet`; `ReportChatModal` on `ReportSheet`)
- **`Chip`:** Special Case (`ChatReactionChips.tsx` kept raw ad-hoc chip pending chat redesign per Spec 17 §4.1.1)
- **Buttons & CTAs:** Deviations present (`chatScreenStyles.ts` and `AnchoredPostCard.tsx` have hand-rolled CTA buttons)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`targetPreviewCard.tsx` uses unmirrored directional chevron)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **78** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 3 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 2 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 1 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 33 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 8 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 27 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 4 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 2 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/chat/[id].tsx` — Total Findings: **1** (`physicalSide`: 1)
- `src/screens/chat/chatScreenStyles.ts` — Total Findings: **3** | Hand-rolled CTAs: **1** (`radiusLiteral`: 2, `physicalSide`: 1)
- `src/components/chat/chatConversationHeader.styles.ts` — Total Findings: **2** (`zIndexLiteral`: 1, `shadowLiteral`: 1)
- `src/components/chat/ChatReactionChips.tsx` — Total Findings: **3** (`radiusLiteral`: 1, `spacingLiteral`: 1, `adHocChip`: 1)
- `src/components/chat/AnchoredPostCard.tsx` — Total Findings: **4** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `spacingLiteral`: 1, `iconSizeLiteral`: 1)
- `src/components/chat/system/AutoRemovedBubble.tsx` — Total Findings: **13** (`fontSizeLiteral`: 3, `fontWeightLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 7)
- `src/components/chat/system/DonationLinkReportedBubble.tsx` — Total Findings: **15** (`fontSizeLiteral`: 2, `fontWeightLiteral`: 3, `radiusLiteral`: 2, `spacingLiteral`: 7, `iconSizeLiteral`: 1)
- `src/components/chat/system/ModActionTakenBubble.tsx` — Total Findings: **1** (`spacingLiteral`: 1)
- `src/components/chat/system/ReportReceivedBubble.tsx` — Total Findings: **20** (`fontSizeLiteral`: 5, `fontWeightLiteral`: 4, `radiusLiteral`: 1, `spacingLiteral`: 10)
- `src/components/chat/system/SupportIssueBubble.tsx` — Total Findings: **4** (`fontWeightLiteral`: 2, `spacingLiteral`: 1, `iconSizeLiteral`: 1)
- `src/components/chat/system/targetPreviewCard.tsx` — Total Findings: **12** (`fontSizeLiteral`: 2, `fontWeightLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 5, `iconSizeLiteral`: 1, `unmirroredDirectionalIcon`: 1)
- `src/components/MessageBubble.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

### Cluster 8 — Auth & Onboarding

> User authentication (unified email magic link and password form), email verification, password reset callbacks, and 4-step progressive onboarding tour.

#### 8.1 Welcome & Auth Forms (Sign-In / Sign-Up / Forgot Password)

- **Route Path:** `app/(auth)/{index,sign-in,sign-up,forgot-password}.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`AnimatedAuthInput.tsx` uses custom raw `TextInput` with floating label animation)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant (CTAs 1 unified `AuthFormScreen` with `lg` `PrimaryButton` and centered ghost links)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`AuthMiniAboutTeaser.tsx` has unmirrored arrow-forward glyph)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **41** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 1 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 8 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 4 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 9 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 2 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 15 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/auth/welcomeScreen.styles.ts` — Total Findings: **23** (`colorLiteral`: 7, `fontSizeLiteral`: 3, `fontWeightLiteral`: 2, `radiusLiteral`: 3, `shadowLiteral`: 8)
- `src/components/auth/AnimatedAuthInput.tsx` — Total Findings: **4** (`shadowLiteral`: 3, `rawTextInput`: 1)
- `src/components/auth/AuthMiniAboutTeaser.tsx` — Total Findings: **14** (`colorLiteral`: 1, `fontSizeLiteral`: 1, `fontWeightLiteral`: 3, `radiusLiteral`: 1, `spacingLiteral`: 1, `shadowLiteral`: 4, `iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 1)

---

#### 8.2 Auth Status, Password Reset & Verification Callback

- **Route Path:** `app/auth/{verify,callback,reset-password}.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant (CTAs 1 shared `AuthStatusScreen` with `md` `PrimaryButton` and `VerificationPendingPanel` with kit secondary/ghost)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 8.3 Onboarding Flow (Intro, Basic Info, Photo, Tour)

- **Route Path:** `app/(onboarding)/{about-intro,basic-info,photo,tour}.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (Basic info step migrated 3 inputs to kit `TextField`)
- **`Modal` / `BottomSheet`:** Compliant (`OnboardingSoftGateModal` migrated to kit `Modal`)
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant (CTAs 1 migrated step actions to `lg` `PrimaryButton` with trailing arrow; photo button to `md` `SecondaryButton`; camera badge kept)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **1** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/animations/TourSlidePager.tsx` — Total Findings: **1** (`radiusLiteral`: 1)
- `app/(onboarding)/photo.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)
- `src/components/animations/OnboardingProgressBar.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

### Cluster 9 — Profile & Social

> User identity and reputation: my profile dashboard, filtered tabs (saved, hidden, closed, removed posts), public user profiles, social graph (followers/following), profile editing, and karma/impact analytics.

#### 9.1 My Profile Screen

- **Route Path:** `app/(tabs)/profile/index.tsx`
- **Store Screenshot Reference:** [View Visual Screenshot](../store/screenshots/iphone-6.5/06-profile.png)

  ![My Profile Screen](../store/screenshots/iphone-6.5/06-profile.png)

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Deviations present (`DeleteAccountSuccessOverlay.tsx` uses raw React Native `Modal`; `MyProfileOverflowMenu` migrated to `ActionMenuSheet`; `KarmaBadge` on kit `Modal`)
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`MyProfileChrome.tsx` has unmirrored chevron)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **13** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 1 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 1 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 3 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 4 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 1 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/profile/MyProfileChrome.tsx` — Total Findings: **5** (`zIndexLiteral`: 1, `iconSizeLiteral`: 3, `unmirroredDirectionalIcon`: 1)
- `src/components/profile/ProfileHeader.tsx` — Total Findings: **2** (`spacingLiteral`: 1, `iconSizeLiteral`: 1)
- `src/components/profile/ProfileStatsRow.tsx` — Total Findings: **1** (`spacingLiteral`: 1)
- `src/components/profile/ProfileClosedPostsGrid.tsx` — Total Findings: **3** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `radiusLiteral`: 1)
- `src/components/profile/otherProfileShells.tsx` — Total Findings: **1** (`spacingLiteral`: 1)
- `src/components/DeleteAccountSuccessOverlay.tsx` — Total Findings: **1** (`rawModal`: 1)

---

#### 9.2 Profile Filtered Views (Saved, Hidden, Closed, Removed)

- **Route Path:** `app/(tabs)/profile/{saved,hidden,closed,removed}.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **4** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 2 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 2 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/(tabs)/profile/saved.tsx` — Total Findings: **2** (`radiusLiteral`: 1, `iconSizeLiteral`: 1)
- `app/(tabs)/profile/hidden.tsx` — Total Findings: **2** (`radiusLiteral`: 1, `iconSizeLiteral`: 1)

---

#### 9.3 Public User Profile

- **Route Path:** `app/user/[handle]/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant (`ProfileOverflowMenu` on `ActionMenuSheet`, `BanUserModal` on `ReasonNoteSheet`, `ReportUserModal` on `ReportSheet`)
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **3** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 2 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/user/[handle]/index.tsx` — Total Findings: **3** (`spacingLiteral`: 1, `iconSizeLiteral`: 2)

---

#### 9.4 Followers, Following & Follow Suggestions

- **Route Path:** `app/user/[handle]/{followers,following}.tsx & app/follow/suggestions.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (`FilterSearchBar` adopted for follower/following search)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Deviations present (`FollowButton.tsx` has hand-rolled CTA button styling with `colors.primary`)
- **`filterKit`:** Compliant (`FilterSearchBar` adopted in followers and following)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **4** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 2 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/follow/suggestions.tsx` — Total Findings: **2** (`radiusLiteral`: 2)
- `src/components/profile/FollowButton.tsx` — Total Findings: **2** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 1, `spacingLiteral`: 1)

---

#### 9.5 Edit Profile Screen

- **Route Path:** `app/edit-profile.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Severe Deviation (`app/edit-profile.tsx` has 3 raw `TextInput`s and `EditProfileAddressBlock.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Deviations present (`edit-profile.styles.ts` has hand-rolled CTA button with `colors.primary`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **10** | 0 |
| Raw `TextInput` | 4 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 4 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 1 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/edit-profile.tsx` — Total Findings: **6** (`physicalSide`: 3, `rawTextInput`: 3)
- `src/screens/edit-profile.styles.ts` — Total Findings: **1** | Hand-rolled CTAs: **1** (`physicalSide`: 1)
- `src/components/EditProfileAddressBlock.tsx` — Total Findings: **1** (`rawTextInput`: 1)
- `src/components/EditProfileAvatar.tsx` — Total Findings: **2** (`colorLiteral`: 1, `radiusLiteral`: 1)

---

#### 9.6 Karma History & Personal Impact Stats

- **Route Path:** `app/karma-history.tsx & app/stats.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`app/karma-history.tsx` and `app/stats.tsx` use unmirrored chevron icons)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **15** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 2 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 4 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 3 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 5 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/karma-history.tsx` — Total Findings: **10** (`fontWeightLiteral`: 3, `spacingLiteral`: 3, `iconSizeLiteral`: 3, `unmirroredDirectionalIcon`: 1)
- `app/stats.tsx` — Total Findings: **3** (`spacingLiteral`: 1, `iconSizeLiteral`: 1, `unmirroredDirectionalIcon`: 1)
- `src/components/stats/ActivityTimelineList.tsx` — Total Findings: **2** (`radiusLiteral`: 1, `iconSizeLiteral`: 1)

---

### Cluster 10 — Settings & Legal

> App configuration (theme/appearance, feed defaults, push notifications, translation language, WhatsApp integration, bug reporting, survey responses, audit log, and legal consent).

#### 10.1 Settings Menu (Root)

- **Route Path:** `app/settings.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant (`DeleteAccountConfirmModal` and `EnablePushModal` migrated to kit `Modal`)
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`SettingsAboutCard.tsx` and `SettingsScreenRow.tsx` use unmirrored chevron icons)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **5** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 2 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 2 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/SettingsAboutCard.tsx` — Total Findings: **4** (`fontWeightLiteral`: 1, `iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 1)
- `src/components/SettingsScreenRow.tsx` — Total Findings: **1** (`unmirroredDirectionalIcon`: 1)

---

#### 10.2 Appearance Settings

- **Route Path:** `app/settings/appearance.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant (`appearanceParts.tsx` uses `colors.primary` for radio selection indicator)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **9** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 2 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 4 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 1 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/appearance.tsx` — Total Findings: **1** (`radiusLiteral`: 1)
- `src/components/settings/appearanceParts.tsx` — Total Findings: **8** | Hand-rolled CTAs: **2** (`fontWeightLiteral`: 2, `radiusLiteral`: 3, `spacingLiteral`: 2, `iconSizeLiteral`: 1)

---

#### 10.3 Feed Preferences Screen

- **Route Path:** `app/settings/feed.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`feed.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`feed.tsx` defines ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (`feed.tsx` has hand-rolled CTA button with `colors.primary`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **8** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 2 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/feed.tsx` — Total Findings: **8** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 1, `rawTextInput`: 1, `adHocChip`: 1, `iconSizeLiteral`: 2)

---

#### 10.4 Notification Preferences Screen

- **Route Path:** `app/settings/notifications.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`QuietHoursSection.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **5** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 3 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/NotificationToggleRow.tsx` — Total Findings: **4** (`fontSizeLiteral`: 2, `fontWeightLiteral`: 1, `spacingLiteral`: 1)
- `src/components/settings/QuietHoursSection.tsx` — Total Findings: **1** (`rawTextInput`: 1)

---

#### 10.5 Language & Translation Settings

- **Route Path:** `app/settings/language.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant (`translationLanguageParts.tsx` uses `colors.primary` for selected radio item)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **5** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 3 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/language.tsx` — Total Findings: **1** (`radiusLiteral`: 1)
- `src/components/settings/translationLanguageParts.tsx` — Total Findings: **4** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 1, `radiusLiteral`: 2, `spacingLiteral`: 1)

---

#### 10.6 WhatsApp Integration Settings

- **Route Path:** `app/settings/whatsapp.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Deviations present (`whatsapp.tsx` has hand-rolled CTA button)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **2** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 2 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/whatsapp.tsx` — Total Findings: **2** | Hand-rolled CTAs: **1** (`radiusLiteral`: 2)

---

#### 10.7 Feedback & Bug Reporting Screens

- **Route Path:** `app/settings/{feedback,report-issue}.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`feedback.tsx` and `report-issue.tsx` each have 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`report-issue.tsx` defines ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (`feedback.tsx` has hand-rolled CTA button)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **12** | 0 |
| Raw `TextInput` | 2 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 6 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 1 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/feedback.tsx` — Total Findings: **6** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 1, `rawTextInput`: 1)
- `app/settings/report-issue.tsx` — Total Findings: **6** (`fontWeightLiteral`: 3, `rawTextInput`: 1, `adHocChip`: 1, `iconSizeLiteral`: 1)

---

#### 10.8 In-App Surveys & Feedback

- **Route Path:** `app/settings/{surveys,survey/[slug],survey-demo}.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`survey-demo.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant (`SurveyThankYouModal` on kit `Modal`)
- **`Chip`:** Deviations present (`surveys.tsx` defines ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (`SurveyFloatingNav.tsx` and `SurveyRatingRow.tsx` have hand-rolled CTAs)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`app/settings/surveys.tsx` has 2 unmirrored icons, `SurveyFloatingNav.tsx` has 2 unmirrored icons)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **32** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 4 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 2 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 12 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 6 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 5 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/surveys.tsx` — Total Findings: **12** (`fontWeightLiteral`: 3, `spacingLiteral`: 2, `adHocChip`: 1, `iconSizeLiteral`: 4, `unmirroredDirectionalIcon`: 2)
- `app/settings/survey-demo.tsx` — Total Findings: **8** (`fontSizeLiteral`: 3, `fontWeightLiteral`: 3, `radiusLiteral`: 1, `rawTextInput`: 1)
- `src/components/survey/SurveyFloatingNav.tsx` — Total Findings: **11** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 2, `zIndexLiteral`: 1, `shadowLiteral`: 4, `iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 2)
- `src/components/survey/SurveyRatingRow.tsx` — Total Findings: **1** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 1)

---

#### 10.9 Audit Log Screen

- **Route Path:** `app/settings/audit.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`audit.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **7** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 2 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 3 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/audit.tsx` — Total Findings: **7** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `fontFamilyLiteral`: 1, `radiusLiteral`: 2, `spacingLiteral`: 1, `rawTextInput`: 1)

---

#### 10.10 Follow Requests Screen

- **Route Path:** `app/settings/follow-requests.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Deviations present (`follow-requests.tsx` has hand-rolled CTA button)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **1** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/settings/follow-requests.tsx` — Total Findings: **1** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 1)

---

#### 10.11 Legal Terms, Privacy Policy & Consent Gate

- **Route Path:** `app/legal/{terms,privacy}.tsx & src/components/legal/LegalConsentGate.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Severe Deviation (`LegalConsentGate.tsx` has 2 raw React Native `Modal`s; kept pending consent gate decoupling)
- **`Chip`:** N/A
- **Buttons & CTAs:** Deviations present (`LegalConsentGate.tsx` has 2 hand-rolled CTA buttons with `colors.primary`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **18** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 2 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 5 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 10 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 1 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/legal/LegalConsentGate.tsx` — Total Findings: **9** | Hand-rolled CTAs: **2** (`radiusLiteral`: 5, `physicalSide`: 2, `rawModal`: 2)
- `src/components/legal/LegalMarkdownStyles.ts` — Total Findings: **3** (`fontWeightLiteral`: 1, `radiusLiteral`: 1, `physicalSide`: 1)
- `src/components/legal/legalMarkdownRules.tsx` — Total Findings: **3** (`radiusLiteral`: 1, `physicalSide`: 2)
- `src/components/legal/LegalConsentCard.tsx` — Total Findings: **2** (`radiusLiteral`: 2)
- `src/components/legal/LegalDocumentReader.tsx` — Total Findings: **1** (`radiusLiteral`: 1)

---

### Cluster 11 — Admin Surfaces

> Internal operations and management: user administration, task management, report and content moderation, CRM, financial ledger, volunteer timesheets, and system emergency switches.

#### 11.1 Admin Hub & Navigation

- **Route Path:** `app/(admin)/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`AdminFormField.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (`AdminNav.tsx` uses `colors.primary` for active tab indicator; header uses `AdminScreenHeader` kit button)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **7** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 1 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 2 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/AdminFormField.tsx` — Total Findings: **7** (`fontSizeLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 2, `physicalSide`: 1, `rawTextInput`: 1)
- `src/components/admin/AdminNav.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 11.2 Admins & Role Management

- **Route Path:** `app/(admin)/admins/index.tsx & [userId].tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`UserLookupField.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant (`ChangeRoleModal`, `GrantRoleModal`, `ManagerPickerModal` on kit `Modal`)
- **`Chip`:** Deviations present (`OrgSwitcher.tsx` and `LayerPersonChip.tsx` define ad-hoc `chip` style)
- **Buttons & CTAs:** Compliant (CTAs 4 migrated `(admin)/admins` and sections to `sm` kit buttons; OrgSwitcher uses primary for selected tab)
- **`filterKit`:** Compliant (`ChoiceChips` uses kit chips)
- **`MirroredIcon`:** Deviations present (`AdminPersonCard.tsx` has unmirrored chevron)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **4** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 2 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 1 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/admins/AdminPersonCard.tsx` — Total Findings: **1** (`unmirroredDirectionalIcon`: 1)
- `src/components/admin/admins/OrgSwitcher.tsx` — Total Findings: **1** | Hand-rolled CTAs: **1** (`adHocChip`: 1)
- `src/components/admin/admins/UserLookupField.tsx` — Total Findings: **1** (`rawTextInput`: 1)
- `src/components/admin/admins/layers/LayerPersonChip.tsx` — Total Findings: **1** (`adHocChip`: 1)
- `app/(admin)/admins/index.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 11.3 Admin Tasks & Task Creation/Detail

- **Route Path:** `app/(admin)/tasks/index.tsx & new.tsx & [taskId]/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Severe Deviation (`app/(admin)/tasks/new.tsx` has 3 raw `TextInput`s; `[taskId]/index.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`AssigneePicker.tsx` and `TaskCategoryPicker.tsx` define ad-hoc `chip` style; task status chips migrated)
- **Buttons & CTAs:** Deviations present (Hand-rolled CTAs in `tasks/new.tsx`, `tasks/[taskId]/index.tsx`, `AssigneePicker.tsx`, `TaskDueRangeFilter.tsx`)
- **`filterKit`:** Compliant (`TaskAssigneeFilter` and task search on `filterKit`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **94** | 0 |
| Raw `TextInput` | 4 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 2 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 7 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 2 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 1 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 41 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 10 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 34 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/(admin)/tasks/new.tsx` — Total Findings: **39** | Hand-rolled CTAs: **2** (`fontSizeLiteral`: 9, `fontWeightLiteral`: 5, `radiusLiteral`: 4, `spacingLiteral`: 17, `physicalSide`: 1, `rawTextInput`: 3)
- `app/(admin)/tasks/[taskId]/index.tsx` — Total Findings: **40** | Hand-rolled CTAs: **1** (`colorLiteral`: 1, `fontSizeLiteral`: 10, `fontWeightLiteral`: 6, `radiusLiteral`: 4, `spacingLiteral`: 17, `physicalSide`: 1, `rawTextInput`: 1)
- `src/components/admin/tasks/AssigneePicker.tsx` — Total Findings: **8** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `radiusLiteral`: 1, `spacingLiteral`: 4, `adHocChip`: 1)
- `src/components/admin/tasks/TaskCategoryPicker.tsx` — Total Findings: **7** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `radiusLiteral`: 1, `spacingLiteral`: 3, `adHocChip`: 1)
- `src/components/admin/tasks/TaskActivityTimeline.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)
- `src/components/admin/tasks/TaskDueRangeFilter.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 11.4 Reports & Moderation Cases

- **Route Path:** `app/(admin)/reports/index.tsx & [caseId]/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 4 migrated `CaseTargetCard` to `sm` `PrimaryButton`)
- **`filterKit`:** Compliant (`ReportFilters` on `filterKit`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **8** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 1 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 4 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/reports/CaseActions.tsx` — Total Findings: **8** (`colorLiteral`: 1, `fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `radiusLiteral`: 1, `spacingLiteral`: 4)

---

#### 11.5 Content Moderation (Posts & Users)

- **Route Path:** `app/(admin)/posts/index.tsx & app/(admin)/users/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`PostSearchRow.tsx` and `UserSearchRow.tsx` define ad-hoc `chip` style)
- **Buttons & CTAs:** Compliant
- **`filterKit`:** Compliant (Search rows standardized on `filterKit`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **2** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 2 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/content/PostSearchRow.tsx` — Total Findings: **1** (`adHocChip`: 1)
- `src/components/admin/content/UserSearchRow.tsx` — Total Findings: **1** (`adHocChip`: 1)

---

#### 11.6 Admin CRM & Contact Forms

- **Route Path:** `app/(admin)/crm/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`ContactFormModal.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Deviations present (`ContactFormModal.tsx` has 2 hand-rolled CTAs; `(admin)/crm/index.tsx` has 1 hand-rolled CTA; `ContactCard` migrated)
- **`filterKit`:** Compliant (`app/(admin)/crm/index.tsx` search & status on `filterKit`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **35** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 3 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 3 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 1 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 13 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 6 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 11 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/crm/ContactFormModal.tsx` — Total Findings: **35** | Hand-rolled CTAs: **2** (`colorLiteral`: 1, `fontSizeLiteral`: 7, `fontWeightLiteral`: 4, `radiusLiteral`: 6, `spacingLiteral`: 13, `physicalSide`: 3, `rawTextInput`: 1)
- `app/(admin)/crm/index.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 11.7 Admin Money & Financial Logging

- **Route Path:** `app/(admin)/money/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`FinanceEntryCard.tsx` defines ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (`FinanceEntryFormModal.tsx` has 1 hand-rolled CTA; screen header uses kit `PrimaryButton`)
- **`filterKit`:** Compliant
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **34** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 2 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 1 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 13 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 5 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 12 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/money/FinanceEntryCard.tsx` — Total Findings: **18** (`fontSizeLiteral`: 5, `fontWeightLiteral`: 2, `radiusLiteral`: 2, `spacingLiteral`: 8, `adHocChip`: 1)
- `src/components/admin/money/FinanceEntryFormModal.tsx` — Total Findings: **16** | Hand-rolled CTAs: **1** (`colorLiteral`: 1, `fontSizeLiteral`: 3, `fontWeightLiteral`: 2, `radiusLiteral`: 3, `spacingLiteral`: 5, `physicalSide`: 2)

---

#### 11.8 Admin Time Tracking & Timesheets

- **Route Path:** `app/(admin)/time/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`TimesheetFormModal.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Deviations present (`TimesheetFormModal.tsx` has 1 hand-rolled CTA; `TimesheetEntryCard` migrated to `sm` kit buttons)
- **`filterKit`:** Compliant
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **29** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 3 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 1 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 10 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 5 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 9 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/time/TimesheetFormModal.tsx` — Total Findings: **29** | Hand-rolled CTAs: **1** (`colorLiteral`: 1, `fontSizeLiteral`: 6, `fontWeightLiteral`: 3, `radiusLiteral`: 5, `spacingLiteral`: 10, `physicalSide`: 3, `rawTextInput`: 1)

---

#### 11.9 Admin Organization Approvals

- **Route Path:** `app/(admin)/org-approvals/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`org-approvals/index.tsx` has 1 raw `TextInput`)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Deviations present (`org-approvals/index.tsx` defines ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (`org-approvals/index.tsx` has 2 hand-rolled CTAs)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **63** | 0 |
| Raw `TextInput` | 1 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 2 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 31 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 6 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 24 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/(admin)/org-approvals/index.tsx` — Total Findings: **63** | Hand-rolled CTAs: **2** (`fontSizeLiteral`: 15, `fontWeightLiteral`: 9, `radiusLiteral`: 6, `spacingLiteral`: 31, `rawTextInput`: 1, `adHocChip`: 1)

---

#### 11.10 Admin Matching Operations

- **Route Path:** `app/(admin)/matching/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

#### 11.11 Admin Audit Trail

- **Route Path:** `app/(admin)/audit/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Deviations present (`(admin)/audit/index.tsx` has 1 hand-rolled CTA)
- **`filterKit`:** Compliant (Audit search and action filters on `filterKit`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **9** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 3 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 6 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/content/AuditLogRow.tsx` — Total Findings: **9** (`fontSizeLiteral`: 4, `fontWeightLiteral`: 1, `fontFamilyLiteral`: 1, `spacingLiteral`: 3)
- `app/(admin)/audit/index.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 11.12 Admin Surveys & Analytics

- **Route Path:** `app/(admin)/surveys/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (`PmfReportCard` and `QuestionStatCard` use `colors.primary` for chart bars)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`SurveyOverviewCard.tsx` and `SurveyResultsView.tsx` use unmirrored chevrons)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **2** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 3 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 2 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/admin/surveys/SurveyOverviewCard.tsx` — Total Findings: **1** (`unmirroredDirectionalIcon`: 1)
- `src/components/admin/surveys/SurveyResultsView.tsx` — Total Findings: **1** (`unmirroredDirectionalIcon`: 1)
- `src/components/admin/surveys/PmfReportCard.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)
- `src/components/admin/surveys/QuestionStatCard.tsx` — Total Findings: **0** | Hand-rolled CTAs: **2** (No literal findings)

---

#### 11.13 Admin WhatsApp Emergency Kill-Switch

- **Route Path:** `app/(admin)/whatsapp/index.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (CTAs 4 migrated kill switch: `sm` `PrimaryButton` enable, `DangerButton` disable per D94)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

*This screen is fully token-clean with zero frozen baseline findings and zero hand-rolled CTAs.*

---

### Cluster 12 — Public Landing, Standalone & Shared Components

> Brand landing and storytelling pages, public academic research surveys, notification inbox, account blocking, shared modal components, and app shell chrome.

#### 12.1 About Karma Community Landing Page

- **Route Path:** `app/about.tsx & app/about-site.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant
- **`Modal` / `BottomSheet`:** Deviations present (`AboutNavDrawer.tsx` uses raw React Native `Modal` for slide-over drawer)
- **`Chip`:** Deviations present (`AboutValuesGrid.tsx` defines ad-hoc `chip` style)
- **Buttons & CTAs:** Deviations present (CTAs 2 migrated contact buttons; hero banner, embed, and scope toggle use primary color)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`AboutContactLinks.tsx`, `AboutNavDrawer.tsx`, `AboutSocialLinks.tsx` use unmirrored directionals)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **106** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 1 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 1 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 7 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 5 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 3 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 5 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 3 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 5 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 38 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 17 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 28 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/features/about-landing/AboutAudienceSection.tsx` — Total Findings: **13** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 1, `radiusLiteral`: 2, `shadowLiteral`: 8, `iconSizeLiteral`: 2)
- `src/features/about-landing/AboutContactLinks.tsx` — Total Findings: **1** (`unmirroredDirectionalIcon`: 1)
- `src/features/about-landing/AboutContributionsGrid.tsx` — Total Findings: **6** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 2, `radiusLiteral`: 1, `spacingLiteral`: 1, `iconSizeLiteral`: 1)
- `src/features/about-landing/AboutHero.tsx` — Total Findings: **8** | Hand-rolled CTAs: **1** (`colorLiteral`: 5, `fontWeightLiteral`: 1, `radiusLiteral`: 2)
- `src/features/about-landing/AboutInstagramEmbed.tsx` — Total Findings: **1** | Hand-rolled CTAs: **1** (`iconSizeLiteral`: 1)
- `src/features/about-landing/AboutInstagramEmbed.web.tsx` — Total Findings: **4** | Hand-rolled CTAs: **1** (`physicalSide`: 3, `iconSizeLiteral`: 1)
- `src/features/about-landing/AboutLogoEvolutionSection.tsx` — Total Findings: **5** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 3, `iconSizeLiteral`: 1)
- `src/features/about-landing/AboutNavDrawer.tsx` — Total Findings: **7** (`physicalSide`: 2, `rawModal`: 1, `iconSizeLiteral`: 3, `unmirroredDirectionalIcon`: 1)
- `src/features/about-landing/AboutScopeToggle.tsx` — Total Findings: **9** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 1, `shadowLiteral`: 8)
- `src/features/about-landing/AboutSocialLinks.tsx` — Total Findings: **4** (`fontWeightLiteral`: 1, `iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 1)
- `src/features/about-landing/AboutValuesGrid.tsx` — Total Findings: **7** (`fontWeightLiteral`: 1, `shadowLiteral`: 4, `adHocChip`: 1, `iconSizeLiteral`: 1)
- `src/features/about-landing/AboutFaqAccordion.tsx` — Total Findings: **2** (`fontWeightLiteral`: 1, `iconSizeLiteral`: 1)
- `src/features/about-landing/AboutGovernanceSection.tsx` — Total Findings: **3** (`fontWeightLiteral`: 3)
- `src/features/about-landing/AboutMissionTeamSection.tsx` — Total Findings: **7** (`fontWeightLiteral`: 4, `spacingLiteral`: 1, `iconSizeLiteral`: 2)
- `src/features/about-landing/AboutMoneySection.tsx` — Total Findings: **4** (`fontWeightLiteral`: 4)
- `src/features/about-landing/AboutRoadmapTimeline.tsx` — Total Findings: **9** (`fontSizeLiteral`: 2, `fontWeightLiteral`: 5, `spacingLiteral`: 1, `iconSizeLiteral`: 1)
- `src/features/about-landing/AboutScopedSection.tsx` — Total Findings: **2** (`fontWeightLiteral`: 2)
- `src/features/about-landing/AboutSectionBlocksBottom.tsx` — Total Findings: **4** (`shadowLiteral`: 4)
- `src/features/about-landing/AboutSectionBlocksTop.tsx` — Total Findings: **5** (`fontWeightLiteral`: 1, `shadowLiteral`: 4)
- `src/features/about-landing/AboutVisionSection.tsx` — Total Findings: **5** (`fontWeightLiteral`: 4, `iconSizeLiteral`: 1)

---

#### 12.2 Public Research Survey

- **Route Path:** `app/research/[slug].tsx & [slug].web.tsx & thanks.tsx & thanks.web.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`ResearchQuestionPanel.tsx` has 3 raw `TextInput`s for survey response inputs)
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Deviations present (`thanks.web.tsx`, `ResearchGuestInviteBanner.tsx`, `ResearchEndShareCard.tsx` have hand-rolled CTAs)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Deviations present (`thanks.web.tsx` and `ResearchGuestInviteBanner.tsx` have unmirrored arrow / chevron glyphs)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **46** | 0 |
| Raw `TextInput` | 3 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 4 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 2 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 2 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 17 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 16 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 6 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/research/[slug].web.tsx` — Total Findings: **2** (`fontWeightLiteral`: 1, `radiusLiteral`: 1)
- `app/research/thanks.web.tsx` — Total Findings: **10** | Hand-rolled CTAs: **2** (`fontWeightLiteral`: 2, `radiusLiteral`: 5, `iconSizeLiteral`: 2, `unmirroredDirectionalIcon`: 1)
- `src/screens/research/ResearchQuestionPanel.tsx` — Total Findings: **13** (`fontSizeLiteral`: 4, `fontWeightLiteral`: 3, `radiusLiteral`: 3, `rawTextInput`: 3)
- `src/screens/research/ResearchRunner.tsx` — Total Findings: **3** (`fontWeightLiteral`: 1, `radiusLiteral`: 2)
- `src/screens/research/SurveyIntroBlock.tsx` — Total Findings: **6** (`fontWeightLiteral`: 1, `radiusLiteral`: 2, `spacingLiteral`: 2, `iconSizeLiteral`: 1)
- `src/components/research/ResearchEndShareCard.tsx` — Total Findings: **6** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 2, `radiusLiteral`: 2, `iconSizeLiteral`: 2)
- `src/components/research/ResearchGuestInviteBanner.tsx` — Total Findings: **6** | Hand-rolled CTAs: **1** (`fontWeightLiteral`: 2, `radiusLiteral`: 2, `iconSizeLiteral`: 1, `unmirroredDirectionalIcon`: 1)

---

#### 12.3 Notifications Inbox Screen

- **Route Path:** `app/notifications/inbox.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant (`NotificationInboxRow.tsx` uses primary color for unread indicator dot)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **0** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 1 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 0 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/notifications/NotificationInboxRow.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 12.4 Standalone Utility (Pro, Account Blocked, Shell Preview)

- **Route Path:** `app/pro.tsx & app/account-blocked.tsx & app/dev/shell-preview.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **9** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 2 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 1 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 6 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `app/pro.tsx` — Total Findings: **4** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `spacingLiteral`: 2)
- `app/dev/shell-preview.tsx` — Total Findings: **5** (`fontSizeLiteral`: 2, `fontWeightLiteral`: 2, `radiusLiteral`: 1)

---

#### 12.5 Shared Modal Picker Component (SearchablePicker)

- **Route Path:** `src/components/SearchablePicker/SearchablePicker.tsx`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Deviations present (`SearchablePicker.tsx` has 2 raw `TextInput`s with auto-focus)
- **`Modal` / `BottomSheet`:** Severe Deviation (`SearchablePicker.tsx` has 1 raw React Native `Modal`; kept raw per Spec 17 §4.1.1 until kit has fixed-height sheet mode)
- **`Chip`:** Compliant
- **Buttons & CTAs:** Compliant
- **`filterKit`:** Deviations present (Custom search filter implemented instead of `FilterSearchBar`)
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **8** | 0 |
| Raw `TextInput` | 2 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 1 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 3 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 0 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 0 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/SearchablePicker/SearchablePicker.tsx` — Total Findings: **4** (`physicalSide`: 1, `rawTextInput`: 2, `rawModal`: 1)
- `src/components/SearchablePicker/searchablePickerStyles.ts` — Total Findings: **4** (`fontWeightLiteral`: 2, `physicalSide`: 2)

---

#### 12.6 App Shell & Global Chrome

- **Route Path:** `src/components/shell/* & Navigation Chrome`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** N/A
- **`Modal` / `BottomSheet`:** Compliant
- **`Chip`:** N/A
- **Buttons & CTAs:** Compliant (`TabBar` create button and badges use `colors.primary`)
- **`filterKit`:** N/A
- **`MirroredIcon`:** Compliant

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **27** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 3 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 2 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 6 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 2 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 7 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 4 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 6 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/ChatBadge.tsx` — Total Findings: **6** | Hand-rolled CTAs: **1** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `radiusLiteral`: 1, `spacingLiteral`: 2, `iconSizeLiteral`: 1)
- `src/components/DevBanner.tsx` — Total Findings: **7** (`colorLiteral`: 2, `fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `spacingLiteral`: 2, `zIndexLiteral`: 1)
- `src/components/EphemeralToast.tsx` — Total Findings: **6** (`fontWeightLiteral`: 1, `zIndexLiteral`: 1, `shadowLiteral`: 4)
- `src/components/WebRefreshButton.tsx` — Total Findings: **1** (`iconSizeLiteral`: 1)
- `src/components/shell/NavigationRail.tsx` — Total Findings: **5** (`fontSizeLiteral`: 1, `fontWeightLiteral`: 1, `radiusLiteral`: 1, `spacingLiteral`: 1, `iconSizeLiteral`: 1)
- `src/navigation/nativeHeaderIconOnly.tsx` — Total Findings: **2** (`spacingLiteral`: 1, `iconSizeLiteral`: 1)
- `src/components/TabBar.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)
- `src/components/TopBar.tsx` — Total Findings: **0** | Hand-rolled CTAs: **1** (No literal findings)

---

#### 12.7 Mobile UI Kit Core Components (Baseline Exceptions)

- **Route Path:** `src/components/ui/*`
- **Store Screenshot Reference:** *No dedicated store capture (internal / secondary surface)*

##### Design System Kit Adoption Status
- **`TextField`:** Compliant (Kit baseline)
- **`Modal` / `BottomSheet`:** Compliant (Kit baseline)
- **`Chip`:** Compliant (Kit baseline)
- **Buttons & CTAs:** Compliant (Kit baseline)
- **`filterKit`:** Compliant (Kit baseline)
- **`MirroredIcon`:** Compliant (Kit baseline)

##### Deviations & Baseline Findings Summary

| Category | Finding Count | Target / Standard |
|---|---|---|
| **Total Hard-Coded Literals** | **7** | 0 |
| Raw `TextInput` | 0 | 0 (Use kit `TextField`) |
| Raw React Native `Modal` | 0 | 0 (Use kit `Modal` or `BottomSheet`) |
| Ad-Hoc Chips (`chip: { ... }`) | 0 | 0 (Use kit `Chip`) |
| Hand-Rolled CTAs (`backgroundColor: colors.primary`) | 0 | 0 (Use kit `Buttons`) |
| Physical Sides (`marginLeft/Right`, `textAlign: 'left'/'right'`) | 0 | 0 (Use logical start/end) |
| Unmirrored Directional Icons | 0 | 0 (Use kit `MirroredIcon`) |
| Hard-Coded Colors (`colorLiteral`) | 0 | 0 (Use `colors.*` tokens) |
| Hard-Coded Spacing (`spacingLiteral`) | 1 | 0 (Use `spacing.*` tokens) |
| Hard-Coded Radius (`radiusLiteral`) | 0 | 0 (Use `radius.*` tokens) |
| Hard-Coded Typography (`fontSize`, `fontWeight`, `fontFamily`) | 2 | 0 (Use `typography.*` tokens) |
| Icon Size Literals (`iconSizeLiteral`) | 0 | 0 (Use `iconSize.*` tokens) |
| Layer & Shadow Literals (`zIndex`, `shadow`) | 4 | 0 (Use `zIndex.*` & `shadow.*` tokens) |

##### Per-File Finding Breakdown

- `src/components/ui/Card.tsx` — Total Findings: **4** (`shadowLiteral`: 4)
- `src/components/ui/FormFieldLabel.tsx` — Total Findings: **2** (`fontSizeLiteral`: 1, `spacingLiteral`: 1)
- `src/components/ui/SectionHeading.tsx` — Total Findings: **1** (`fontSizeLiteral`: 1)

---

## 4. Cross-Cutting Design Debt & Systemic Patterns

### 4.1 RTL Mirroring & Bidirectionality Violations (`physicalSide` & `unmirroredDirectionalIcon`)

Hebrew is the primary operating language of Karma Community. Physical layout sides directly degrade user experience by preventing bidirectional flipping:
1. **Physical Sides (42 findings across 25 files):**
   - `marginLeft` / `marginRight` and `paddingLeft` / `paddingRight` prevent proper natural spacing when switching between RTL and LTR. High-concentration areas: `EditPostFormScrollContent.tsx` (4), `edit-profile.tsx` (3), `ContactFormModal.tsx` (3), `TimesheetFormModal.tsx` (3), `FinanceEntryFormModal.tsx` (2), `SearchablePicker/searchablePickerStyles.ts` (2), `LegalConsentGate.tsx` (2), `AboutNavDrawer.tsx` (2), `AboutInstagramEmbed.web.tsx` (3).
   - `textAlign: 'left'` and `textAlign: 'right'` force text against natural reading order. Must be replaced with `rtlTextAlignStart` and `rtlTextAlignEnd` from `src/lib/rtlLayout.ts`.
2. **Unmirrored Directional Icons (28 findings across 26 files):**
   - Directional chevron and arrow navigation glyphs point backward in RTL unless rendered via `MirroredIcon`.
   - Surfaces with unmirrored navigation icons include: `Donations Hub` (`app/(tabs)/donations/index.tsx`, `DonationTile.tsx`), `Universal Search` (`SearchRecentSection.tsx`, `UserResultCard.tsx`), `Post Detail` (`PublisherCard.tsx`, `RecipientCallout.tsx`, `PostDetailScrollContent.tsx`), `Profile` (`MyProfileChrome.tsx`), `Karma History & Stats` (`karma-history.tsx`, `stats.tsx`), `Settings` (`SettingsAboutCard.tsx`, `SettingsScreenRow.tsx`, `surveys.tsx`, `SurveyFloatingNav.tsx`), `Admin Admins` (`AdminPersonCard.tsx`), and `About` (`AboutContactLinks.tsx`, `AboutNavDrawer.tsx`, `AboutSocialLinks.tsx`).

### 4.2 Raw Primitives Bypassing the UI Kit

1. **Raw `TextInput` Primitives (31 findings across 22 files):**
   - Form fields that render raw `<TextInput>` miss standard floating labels, consistent error messaging, 44pt minimum touch target heights, and accessible contrast colors.
   - Major clusters:
     - **Post Editing:** `src/components/post/EditPostFormScrollContent.tsx` (4 inputs)
     - **Profile Editing:** `app/edit-profile.tsx` (3 inputs) + `EditProfileAddressBlock.tsx` (1 input)
     - **Admin Forms:** `app/(admin)/tasks/new.tsx` (3 inputs), `[taskId]/index.tsx` (1), `org-approvals/index.tsx` (1), `ContactFormModal.tsx` (1), `TimesheetFormModal.tsx` (1), `AdminFormField.tsx` (1), `UserLookupField.tsx` (1)
     - **Public Research:** `src/screens/research/ResearchQuestionPanel.tsx` (3 inputs)
     - **Settings:** `app/settings/audit.tsx` (1), `feed.tsx` (1), `feedback.tsx` (1), `report-issue.tsx` (1), `survey-demo.tsx` (1), `QuietHoursSection.tsx` (1)
     - **SearchablePicker:** `src/components/SearchablePicker/SearchablePicker.tsx` (2 inputs)
     - **Closure:** `src/components/closure/ClosureRecipientPanes.tsx` (1 input)
     - **Post Detail:** `src/components/post-detail/PostEngagementSection.tsx` (1 comment input)
2. **Raw React Native `Modal` Primitives (6 findings across 5 files):**
   - Raw React Native `<Modal>` components lack standard surface background elevation, corner radius XL (24pt), standard backdrop dimming (`colors.overlay`), safe area padding, and web escape key/focus trap handlers.
   - Specific occurrences:
     - `src/components/legal/LegalConsentGate.tsx` (2 modals: page sheet + full-screen consent; waiting on gate decoupling)
     - `src/components/SearchablePicker/SearchablePicker.tsx` (1 modal: fixed-height 70% picker; needs fixed-height sheet mode in `BottomSheet`)
     - `src/components/PostImageViewerModal.tsx` (1 modal: full-screen image preview lightbox)
     - `src/components/DeleteAccountSuccessOverlay.tsx` (1 modal: account deletion confirmation overlay)
     - `src/features/about-landing/AboutNavDrawer.tsx` (1 modal: mobile web navigation drawer)
3. **Ad-Hoc Chip Implementations (17 findings across 17 files):**
   - Hand-rolled styles named `chip: { ... }` bypass `@kc/ui`'s AA color contrast floor and standard 28pt / 36pt heights.
   - Found in: Admin surfaces (8 files: `org-approvals`, `OrgSwitcher`, `LayerPersonChip`, `PostSearchRow`, `UserSearchRow`, `FinanceEntryCard`, `AssigneePicker`, `TaskCategoryPicker`), Settings (3 files: `feed`, `report-issue`, `surveys`), Post flow (`PostDetailHeader`, `editPostScreen.styles.ts`), Marketplace (`listingChipStyles.ts`), Map (`MapExplorer.styles.ts`), Chat (`ChatReactionChips.tsx`), and About (`AboutValuesGrid.tsx`).

### 4.3 Hand-Rolled CTAs & Brand Orange Inconsistencies

Spec 17 mandates that brand orange (`colors.primary` `#C2410C`) is reserved for intentional primary calls to action, while vivid orange (`#F97316`) is purely decorative. Hand-rolling buttons with inline `backgroundColor: colors.primary` leads to missing loading spinners, unannounced disabled states, missing haptic feedback, and inconsistent touch targets.
- **67 hand-rolled CTA instances** remain outside the UI kit.
- Major remaining groups:
  - **Admin Modals & Views (18 instances):** `ContactFormModal` (2), `FinanceEntryFormModal` (1), `TimesheetFormModal` (1), `AssigneePicker` (1), `TaskDueRangeFilter` (1), `admins/index.tsx` (1), `audit/index.tsx` (1), `crm/index.tsx` (1), `org-approvals/index.tsx` (2), `tasks/new.tsx` (2), `tasks/[taskId]/index.tsx` (1).
  - **Post Flow & Detail (7 instances):** `editPostScreen.styles.ts` (4), `postDetailScreen.styles.ts` (2), `ExpiredRepublishView.tsx` (1).
  - **Map Explorer (2 instances):** `MapExplorer.styles.ts` (2).
  - **Profile & Edit Profile (2 instances):** `edit-profile.styles.ts` (1), `FollowButton.tsx` (1).
  - **Settings & Feedback (4 instances):** `feed.tsx` (1), `feedback.tsx` (1), `follow-requests.tsx` (1), `whatsapp.tsx` (1).
  - **Public Research & Web (4 instances):** `thanks.web.tsx` (2), `ResearchGuestInviteBanner.tsx` (1), `ResearchEndShareCard.tsx` (1).
  - **About Landing (5 instances):** `AboutHero.tsx` (1), `AboutInstagramEmbed.tsx` (1), `AboutInstagramEmbed.web.tsx` (1), `AboutLogoEvolutionSection.tsx` (1), `AboutScopeToggle.tsx` (1).

---

## 5. Prioritized Follow-Up Issues Grouped by Screen (Titles Only)

The following proposed follow-up issues are prioritized by risk, user impact, and architectural alignment.
- **Priority 1 (P1): Critical RTL Invariants & Overlay Bypasses** (Layout-breaking physical sides, raw React Native modals, unmirrored directional icons).
- **Priority 2 (P2): Core UI Kit Control Alignment** (Migrating raw `TextInput` to `TextField`, ad-hoc chips to `Chip`, and hand-rolled CTAs to kit `Buttons`).
- **Priority 3 (P3): Deep Token Scale Hygiene** (Eliminating frozen hard-coded color, spacing, radius, typography, and icon size literals).

### Priority 1: Critical RTL & Overlay Issues

1. **Post Detail:** `[Design System] Post Detail: Migrate PublisherCard, RecipientCallout, and PostDetailScrollContent to MirroredIcon`
2. **Post Detail:** `[Design System] Post Detail: Standardize PostImageViewerModal lightbox overlay on kit design tokens`
3. **Edit Post:** `[Design System] Edit Post: Replace physical marginLeft/Right and textAlign with rtlLayout helpers in EditPostFormScrollContent`
4. **Edit Profile:** `[Design System] Edit Profile: Remove physical layout sides in edit-profile.tsx and edit-profile.styles.ts`
5. **Universal Search:** `[Design System] Universal Search: Wrap directional navigation chevrons in MirroredIcon in SearchRecentSection and UserResultCard`
6. **Donations Hub:** `[Design System] Donations Hub: Replace unmirrored back and forward chevrons with MirroredIcon in Donations screen and DonationTile`
7. **Karma History & Stats:** `[Design System] Karma History & Stats: Adopt MirroredIcon for directional chevrons in karma-history and stats screens`
8. **Settings Menu:** `[Design System] Settings: Mirror navigation chevrons in SettingsScreenRow and SettingsAboutCard using MirroredIcon`
9. **Settings Surveys:** `[Design System] Surveys: Eliminate physical sides and adopt MirroredIcon in surveys screen and SurveyFloatingNav`
10. **Legal & Consent:** `[Design System] Legal: Decouple LegalConsentGate modal stack and replace raw Modal with BottomSheet`
11. **Legal & Consent:** `[Design System] Legal: Replace physical side rules in LegalMarkdownStyles and legalMarkdownRules with logical properties`
12. **Admin Tasks:** `[Design System] Admin Tasks: Eliminate physical sides in tasks/new.tsx and tasks/[taskId]/index.tsx`
13. **Admin CRM & Time:** `[Design System] Admin CRM & Time: Replace physical margins and padding with logical sides in ContactFormModal and TimesheetFormModal`
14. **Admin Money:** `[Design System] Admin Money: Replace physical margins with logical spacing in FinanceEntryFormModal`
15. **Shared Components:** `[Design System] SearchablePicker: Support bounded height in BottomSheet to eliminate raw Modal from SearchablePicker`
16. **Shared Components:** `[Design System] SearchablePicker: Replace physical padding in SearchablePicker with logical start/end properties`
17. **About Landing:** `[Design System] About: Adopt MirroredIcon in AboutContactLinks, AboutNavDrawer, and AboutSocialLinks`
18. **About Landing:** `[Design System] About: Standardize AboutNavDrawer drawer overlay on UI kit sheet tokens`

### Priority 2: Core UI Kit Standardization

19. **Edit Post:** `[Design System] Edit Post: Migrate 4 raw TextInputs to kit TextField in EditPostFormScrollContent`
20. **Edit Post:** `[Design System] Edit Post: Replace ad-hoc chip and hand-rolled CTAs in editPostScreen.styles.ts with kit Chip and Buttons`
21. **Post Detail:** `[Design System] Post Detail: Replace raw comment TextInput with kit TextField in PostEngagementSection`
22. **Post Detail:** `[Design System] Post Detail: Migrate PostDetailHeader chip style to kit Chip tag`
23. **Post Detail:** `[Design System] Post Detail: Standardize hand-rolled CTAs on kit PrimaryButton and SecondaryButton in postDetailScreen.styles.ts`
24. **Edit Profile:** `[Design System] Edit Profile: Migrate 4 raw TextInputs to kit TextField in edit-profile.tsx and EditProfileAddressBlock`
25. **Edit Profile:** `[Design System] Edit Profile: Replace hand-rolled submit CTA with kit PrimaryButton in edit-profile.styles.ts`
26. **Marketplace Goods:** `[Design System] Marketplace: Migrate listingChipStyles.ts to kit Chip`
27. **Marketplace Map:** `[Design System] Marketplace Map: Replace ad-hoc chip and hand-rolled CTAs in MapExplorer.styles.ts with kit Chip and Buttons`
28. **Chat Conversation:** `[Design System] Chat: Standardize chat action CTAs on kit Buttons in chatScreenStyles.ts and AnchoredPostCard`
29. **Auth Form:** `[Design System] Auth: Standardize AnimatedAuthInput on kit TextField foundation`
30. **Followers & Following:** `[Design System] Social: Migrate FollowButton hand-rolled button styles to kit SecondaryButton / PrimaryButton`
31. **Settings Feed:** `[Design System] Settings Feed: Migrate raw TextInput and ad-hoc chip to kit TextField and Chip`
32. **Settings Feedback:** `[Design System] Feedback: Replace raw TextInput and hand-rolled CTA in feedback.tsx with kit TextField and PrimaryButton`
33. **Settings Report Issue:** `[Design System] Report Issue: Migrate raw TextInput and ad-hoc chip to kit TextField and Chip in report-issue.tsx`
34. **Settings Audit:** `[Design System] Settings Audit: Migrate filter search raw TextInput to filterKit FilterSearchBar in audit.tsx`
35. **Admin Tasks:** `[Design System] Admin Tasks: Migrate 4 raw TextInputs to kit TextField in tasks/new.tsx and tasks/[taskId]/index.tsx`
36. **Admin Tasks:** `[Design System] Admin Tasks: Replace ad-hoc chip styles in AssigneePicker and TaskCategoryPicker with kit Chip`
37. **Admin Tasks:** `[Design System] Admin Tasks: Standardize task action CTAs on kit Buttons in tasks/new.tsx and tasks/[taskId]/index.tsx`
38. **Admin Org Approvals:** `[Design System] Admin Org Approvals: Migrate raw TextInput, ad-hoc chip, and CTAs to kit components in org-approvals/index.tsx`
39. **Admin CRM:** `[Design System] Admin CRM: Migrate ContactFormModal raw TextInput and CTAs to kit TextField and Buttons`
40. **Admin Money:** `[Design System] Admin Money: Migrate FinanceEntryCard ad-hoc chip and FinanceEntryFormModal CTA to kit Chip and Buttons`
41. **Admin Time:** `[Design System] Admin Time: Migrate TimesheetFormModal raw TextInput and CTA to kit TextField and Buttons`
42. **Admin Moderation:** `[Design System] Admin Content: Migrate PostSearchRow and UserSearchRow ad-hoc chips to kit Chip`
43. **Public Research:** `[Design System] Research: Migrate 3 survey response raw TextInputs to kit TextField in ResearchQuestionPanel`
44. **Public Research:** `[Design System] Research: Standardize research completion CTAs on kit PrimaryButton in thanks.web.tsx and ResearchEndShareCard`
45. **Shared Components:** `[Design System] SearchablePicker: Migrate search input to filterKit FilterSearchBar`

### Priority 3: Deep Token Hygiene

46. **Home Feed:** `[Design System] Home Feed: Clean up 81 hard-coded typography, spacing, color, and shadow literals in feed card styles`
47. **Universal Search:** `[Design System] Universal Search: Clean up 32 hard-coded icon size, spacing, radius, and typography literals across search cards`
48. **Nonprofits Directory:** `[Design System] Nonprofits: Eliminate 15 frozen radius, spacing, and icon size literals in money hero and card components`
49. **Post Detail:** `[Design System] Post Detail: Clean up 98 frozen color, font size, weight, spacing, and shadow literals across post detail components`
50. **Chat Conversation:** `[Design System] Chat: Clean up 78 hard-coded spacing, typography, and radius literals in chat message bubbles and styles`
51. **Auth Forms:** `[Design System] Auth: Clean up 41 hard-coded shadow, color, typography, and radius literals in welcomeScreen.styles.ts`
52. **Admin Tasks:** `[Design System] Admin Tasks: Tokenize 94 hard-coded font size, weight, spacing, and radius literals across admin task views`
53. **Admin CRM:** `[Design System] Admin CRM: Tokenize 35 hard-coded spacing, typography, and radius literals in crm/index.tsx and ContactFormModal`
54. **Admin Money & Time:** `[Design System] Admin Money & Time: Tokenize 63 hard-coded spacing, radius, and typography literals in financial and timesheet logs`
55. **Admin Org Approvals:** `[Design System] Admin Org Approvals: Tokenize 63 hard-coded spacing, typography, and radius literals in org-approvals/index.tsx`
56. **About Landing:** `[Design System] About: Tokenize 106 hard-coded font weight, shadow, icon size, and color literals in about-landing features`
57. **Public Research:** `[Design System] Research: Tokenize 46 hard-coded radius, typography, and icon size literals in public research screens`
58. **App Shell:** `[Design System] App Shell: Tokenize 27 frozen literals in TabBar, TopBar, DevBanner, and NavigationRail chrome`
59. **Mobile UI Kit:** `[Design System] UI Kit: Clean up 7 frozen shadow and typography literals in Card, FormFieldLabel, and SectionHeading`

---

## 6. Audit Methodology & Verification

This audit was executed using automated static analysis and clean-architecture traceability:
- **Baseline Extraction:** Direct JSON parse of `app/apps/mobile/brand-guard.baseline.json` (177 tracked files, 1,115 findings).
- **Rule Verification:** Evaluated against the 14 brand-guard rule patterns in `app/apps/mobile/src/__tests__/brandGuardRules.ts` and `brandGuard.test.ts`.
- **Screen Traceability:** All route entrypoints in `app/apps/mobile/app/` were mapped to their imported feature modules and style definitions in `src/`.
- **Pre-Push Gate Certification:** Monorepo architecture, link check, registry check, and linter certified clean via `pnpm lint` from `app/` (Turbo 10/10 tasks successful).
