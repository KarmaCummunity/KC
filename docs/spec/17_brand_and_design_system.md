# 17 — Brand and design system

> Decisions **D65, D66, D67, D87, D93** (2026-10-30). This file is the brand book for agents and designers — visual (§1–§6) and verbal (§7). The values themselves live in code; this file says what they mean, who owns them, and how a change travels.

## 1. Brand identity (D65)

| Item | Value |
|---|---|
| Full name (EN) | **Karma Community** |
| Full name (HE) | **קהילת קארמה** |
| Short name / nickname | **KC** — used in UI chrome, store listing prefix (`KC - קהילת קארמה`), and internal docs |
| Code constant | `brand` in `app/packages/ui/src/theme/brand.ts` |
| Bundle id / package | `org.karmacommunity.app` (`app/apps/mobile/app.json`) |

**KC, the platform vs. KC, the organization (D67).** "KC" names the platform. KC is also an organization that operates *inside* the platform almost like any other organization (D37). Platform chrome (app name, splash, store listing, navigation) speaks as the platform; content published by the KC organization (posts, org page, donations to KC) is styled like any other organization's content, with no extra visual privilege.

**Hidden meaning (D67, refined by D93).** The initials also stand for "קיבוץ קפיטליסטי" ("capitalist kibbutz"). It is an easter egg: it never appears in product surfaces — UI copy, store listings, marketing visuals or the logo — **except the About screen and its FAQ**, where it may appear subtly (PM 2026-10-30).

Rules:
- Never introduce another product name in KC surfaces.
- In Hebrew copy write "קהילת קארמה" or "KC"; do not transliterate "Karma Community" into Hebrew letters.

## 2. Logo

- Master asset: `app/apps/mobile/assets/logo.png` (K + heart + globe). Store icons, splash and favicon are derived from it (`assets/icon.png`, `adaptive-icon*.png`, `splash*.png`, `favicon.png` — the 256px favicon is what `app.json` `web.favicon` points at). `docs/logo_without_background.png` is the transparent export of the same master for print and marketing; it ships in no app surface.
- Backdrop: the splash, the Android adaptive icon and the web page / PWA manifest sit on the light `background` token (`#FFFBF7`), not on white, so the logo lands on the same cream the app opens with. Config files cannot import tokens, so `brandGuard.test.ts` pins the `app.json` copies and `scripts/generate-web-manifest.mjs` reads `kc.tokens.json`.
- History: `assets/logo-evolution/` (read-only archive).
- Logo colours: dark navy `#203050` (the K and the globe ring), warm orange/peach gradient (heart), teal `#95D1CF` (globe sea). The navy is the app's `secondary` (D66).
- Do not recolour, stretch, add effects, or place the full-colour logo on a busy or orange background. Use the monochrome adaptive icon on coloured backgrounds.
- The current `logo.png` is the **official master** (D66). Other variants in the Claude Design project (`new_logo`, `new_logo_black`, `pink_logo`) are drafts and are not used in the product.

## 3. Sources of truth and sync flow

```
packages/ui/src/theme/*.ts   ← the ONLY place token values are edited
        │  (vitest file snapshot)
        ▼
packages/ui/tokens/kc.tokens.json   ← generated, W3C design-tokens format
        │
        ├──► Figma: "KC Design System" file — variables (Light/Dark modes), text styles
        └──► Claude Design: "Design System" project — tokens + component previews
```

- **Figma file:** "KC Design System — Karma Community" (`https://www.figma.com/design/Gxu8WNeNlU7rkxeS87lzcj`). Variables: `Color / Light` and `Color / Dark` (same variable names in both — the Figma starter plan allows one mode per collection; merge into one collection with two modes if the plan is upgraded), `Spacing`, `Radius`. Text styles `KC/*`, effect styles `KC/shadow/*`, and a `Foundations` specimen page. Text styles use **Rubik**, the brand font (a Google font, so every Figma user sees it).
- **Code wins.** A value changed in Figma or Claude Design is a *proposal*: it lands only when the matching `theme/*.ts` change is merged, and the JSON + Figma + Claude Design are then refreshed from code.
- `kc.tokens.json` is never hand-edited. Regenerate with `pnpm --filter @kc/ui test -- -u` after changing a token, and commit both files in the same PR.

## 4. Foundations (summary — values in code)

| Foundation | File | Notes |
|---|---|---|
| Colour | `theme/colors.ts` | Two palettes (light, warm-dark) with one shape, `ColorPalette`. Brand primary = warm orange (generosity) — light-mode `#C2410C` so text and icons meet AA; the vivid `#F97316` stays for decoration (ambient blobs, illustrations). Secondary = logo navy (D66). |
| Font | `theme/fonts.ts` | Brand font **Rubik** (Hebrew + Latin, rounded and warm like the logo; SIL OFL) in weights 400/500/600/700/800 (D66). Loaded by `apps/mobile/src/lib/useBrandFonts.ts` before the splash hides; falls back to the system font if loading fails. |
| Typography | `theme/typography.ts` | Scale h1–h4, bodyLarge/body/bodySmall, button, label, caption. Hebrew RTL first. |
| Spacing | `theme/spacing.ts` | 4-based scale `xs…4xl`; shell layout sizes in `shellDimensions`. |
| Radius / elevation | `theme/spacing.ts` | `radius` xs 4 · sm 8 · md 12 · lg 16 · xl 24 · full (D67 — matches the values screens already used most); `shadow.card`, `shadow.modal` (neutral) and `shadow.glow` — the brand-coloured lift under primary calls to action (offset 0/4, opacity 0.3, blur 8, elevation 4; spread it and set `shadowColor: colors.primary`) (D87). |
| Icon size | `theme/iconSize.ts` | `iconSize` xs 14 · sm 16 · md 18 · lg 20 · xl 22 · 2xl 24 (D87 — the six sizes screens already used most, ~85% of literal Ionicons sizes). |
| Layers | `theme/zIndex.ts` | `zIndex` base 0 · raised 1 · overlay 2 · floating 20 · toast 9999 (D87 — the values already in use, so stacking does not change). |
| Weight | `theme/typography.ts` | Weight modifiers `typography.medium / semiBold / bold / extraBold` (500–800), one per loaded Rubik face, spread over a size preset. |
| Decoration orange | `theme/colors.ts` | `primaryVivid` `#F97316` — the same in both palettes; decoration only (no text, no meaning). Config files that cannot import tokens (`app.json` web `themeColor`, notification `color`, `app/+html.tsx`) are pinned to it by `brandGuard.test.ts`. |
| Avatar colours | `theme/colors.ts` | `avatarPalette` — 8 theme-independent backgrounds with white initials, each ≥ 4.5:1. |
| Breakpoints | `theme/breakpoints.ts` | Responsive shell (mobile → desktop web). |

Usage rules for app code (`app/apps/mobile/**`):
1. Colours come from `useTheme()` / `makeUseStyles()` only — no hex or `rgb()` literals.
2. Font sizes come from `typography.*` presets — no raw `fontSize: <number>`.
3. Font weights come from the `typography` presets and weight modifiers — no raw `fontWeight`.
4. No `fontFamily` literals outside `packages/ui`. Text renders through `Text` / `TextInput` from `@kc/ui` (ESLint blocks importing them from `react-native`); they pick the brand face from `fontWeight`, so **changing the brand font is a change to `theme/fonts.ts` + the loader map only**. If the faces fail to load, `BrandFontProvider` falls back to the system font with its real weights.
5. Corner radii come from `radius.*` — no raw `borderRadius: <number>` (`0` is allowed).
6. Margin, padding and gap come from `spacing.*` (`0` is allowed). Layout sizes (widths, heights, rail and content widths) are not spacing; shell sizes live in `shellDimensions`.
7. Use logical sides so layouts mirror between Hebrew (RTL) and English (LTR): `Start` / `End` properties and the `lib/rtlLayout.ts` helpers (`rtlTextAlignStart` / `rtlTextAlignEnd`, `rowDirectionStart`, `layoutWritingDirectionStyle()`; `rtlTextAlignStart.ts` and `webRtlStyle.ts` only re-export from it) — never `textAlign: 'left' | 'right'` (as a style key or a `TextInput` prop), `marginLeft`, `paddingRight`, `borderLeft*` or `borderTopLeftRadius`.
8. Icon sizes come from `iconSize.*` — no numeric `size={N}` on `Ionicons` (§4.2).
9. Stacking order comes from `zIndex.*` — no raw `zIndex: <number>` (`0` is allowed).
10. Shadows come from the `shadow.*` presets — no raw `shadowOpacity`, `shadowRadius`, `shadowOffset` or `elevation` numbers (`0`, which switches a shadow off, is allowed).
11. Form fields use the kit `TextField` (`apps/mobile/src/components/ui/TextField.tsx`) instead of a raw `<TextInput`; a non-form input (chat composer, search bar) carries the allow-marker with its reason. Dialogs and sheets use the kit `Modal` / `BottomSheet` instead of React Native's own `Modal` (counted only where `Modal` is imported from `react-native`, so the kit `<Modal` never counts). Chips use the kit `Chip` instead of a hand-rolled `chip` style. The UI kit folder (`apps/mobile/src/components/ui/`) is where these wrappers live, so these three rules do not apply there.
12. A justified exception (e.g. a third-party brand mark that must keep its own colour, or a circle whose radius is half its size) carries an end-of-line comment `brand-guard-allow: <reason>` and is reviewed in the PR.

### 4.1 Components

Screens are composed from shared components, not restyled per screen. Use these before writing new styles:

| Need | Component | Where |
|---|---|---|
| Text / text input (primitives) | `Text`, `TextInput` | `@kc/ui` |
| Form field (label, helper, error, icon, multiline) | `TextField` | `apps/mobile/src/components/ui/TextField.tsx` |
| Toggle | `PlatformSwitch` | `@kc/ui` |
| Loading placeholder | `Skeleton` | `@kc/ui` |
| Desktop side column | `AsidePanel`, `useAside` | `@kc/ui` |
| Screen frame | `Screen` | `apps/mobile/src/components/ui/` |
| Buttons | `PrimaryButton`, `SecondaryButton`, `GhostButton`, `DangerButton`, `AlertButton` | `apps/mobile/src/components/ui/Buttons.tsx` |
| Chip (filter, status tag, applied value) | `Chip` | `apps/mobile/src/components/ui/Chip.tsx` |
| Centred dialog | `Modal` | `apps/mobile/src/components/ui/Modal.tsx` |
| Bottom sheet (menus, pickers, short forms) | `BottomSheet` | `apps/mobile/src/components/ui/BottomSheet.tsx` |
| Card | `Card` | `apps/mobile/src/components/ui/` |
| Section title, field label, icon tile, image, date/time field | `SectionHeading`, `FormFieldLabel`, `IconTile`, `KCImage`, `DateTimeField` | `apps/mobile/src/components/ui/` |
| Avatar | `AvatarInitials` | `apps/mobile/src/components/` |

Not built yet (GitHub epic #1061 / #1021): empty state and screen header. Until each exists, new code reuses the closest existing implementation instead of adding another one.

Rules for the kit controls (all on tokens; every interactive control keeps a **44pt touch target**, `MIN_TAP_TARGET`, extending a smaller visual size with `hitSlop`):

| Component | Variants | Sizes | States and behaviour |
|---|---|---|---|
| Buttons (#1286) | `PrimaryButton` (solid `primary`), `SecondaryButton` (surface, border, `shadow.card` lift in light), `GhostButton` (text only), `DangerButton` (solid `error`, `textInverse` label — **only** for destructive actions: delete, block, remove; D94), `AlertButton` (surface with an `error` outline and `error` label — an alarm such as the ride emergency call, neither a primary nor destructive; §8.1 call 7) | `size`: `lg` 56pt (default, the full-width CTA), `md` 48pt (cards, dialogs), `sm` 36pt (compact, admin §4.3) | `disabled` and `loading` block presses and fade the button; `loading` keeps the button's width, shows a spinner and is announced as busy. Optional trailing Ionicons glyph (pinned to the edge on `lg`, beside the label on `md` / `sm`). One primary button per screen (§8.1 call 6); a destructive confirm uses `DangerButton` in its place. |
| `Chip` (#1285) | `filter` (default: outlined, solid `primary` when `selected`; a checkbox for assistive tech), `tag` (read-only status tinted by `tone`: neutral · brand · info · success · warning · error, plus the unfilled `muted` — a `borderStrong` outline with `textSecondary` text for an inactive value; squarer `radius.sm` corners), `removable` (applied value in the brand tint with a trailing ✕; the whole chip removes it, named by `removeAccessibilityLabel`) | `md` 36pt, `sm` 28pt (compact; every chip in a filter sheet — feed, search, rides — is `sm`) | `selected`, `disabled`; interactive chips are pills at least 44pt wide. Tag text is `textPrimary` on the semantic `*Light` fills (`primary` on `primarySurface` for brand, `textSecondary` for muted), so status never depends on a low-contrast tinted text; every tone is AA in both palettes (tested). Values of one tag group (e.g. a task's status) each get their own look — a different tone, or an icon where the group outgrows the tones. |
| `Modal` (#1284) | Centred dialog: `surfaceRaised`, `radius.xl`, `shadow.modal` (outlined in dark mode), max 440pt wide | — | Header = title on the reading-start side + ✕ (named "close", 44pt) on the end side; optional `footer` for actions, stacked vertically with the main action first (`md` buttons; a destructive one is a `DangerButton`). |
| `BottomSheet` (#1284) | Bottom-docked sheet: top corners `radius.xl`, grab handle, scrolling body (`scrollable={false}` for a body with its own list), pinned `footer`; max 640pt wide on tablets / desktop web; `maxHeight` caps a compact sheet that keeps the screen behind it in view (the feed filter, FR-FEED-004) | — | Pads above the home indicator, lifts with the keyboard on iOS, slides up (instant under reduced motion). Secondary sheet actions (e.g. "Clear all") sit in the `footer` under the primary one, not in the header: a filter sheet's footer is the primary "apply" with the ghost "clear all" below it. |

Both overlays dim the screen with `colors.overlay`, stay inside the safe area, and dismiss on backdrop tap, the ✕, Android back and web Escape; `dismissible={false}` makes them blocking (no ✕, all four ignored). On open, VoiceOver / TalkBack focus moves to the title (iOS keeps it inside the surface); on web the dialog element is named by the title and focus is trapped inside. They register with the app's open-modal count, so the legal consent gate waits for them.

#### 4.1.1 Migration list (phase 2 of #1284 / #1285 / #1286)

Screens move onto the kit one area per PR, after the PM approves the look; tracked by `TD-243`. The brand guard keeps each count from growing. Counts as of 2026-10-31; ✅ marks a migrated item (sheets slice, 2026-11-01).

**React Native `Modal` → kit (38 files, 40 uses; guard rule `rawModal`; 6 files, 8 uses left).**
- Sheet components → `BottomSheet` (9): ✅ `PostFilterSheet/index`, ✅ `SearchFilterSheet`, ✅ `PhotoSourceSheet`, ✅ `closure/ClosureSheet`, ✅ `post/PostMenuSheet`, ✅ `features/rides/sheets/{DriverDeclarationSheet, RideFilterSheet, RideTransportLinksSheet}`. Kept raw for now: `SearchablePicker/SearchablePicker` — a fixed-height (70%) picker whose virtualized list needs a bounded parent and whose search field auto-focuses; the content-sized `BottomSheet` cannot give the list a height yet. Move it once the kit has a fixed-height sheet mode.
- Other bottom-docked menus and forms → `BottomSheet` (12): ✅ **11 migrated** (menus and forms slice, 2026-11-01): the menus ✅ `ChatActionMenu`, ✅ `DonationLinkRowMenu`, ✅ `profile/{MyProfileOverflowMenu, ProfileOverflowMenu}` are kit `ActionMenuSheet`s of `SheetActionRow`s (a destructive row is tinted `error`; cancel is a ghost button in the footer); ✅ `GuestJoinModal` and ✅ `AddDonationLinkModal` (kit `TextField`s) put the main action first in the footer; the report flows ✅ `ReportChatModal`, ✅ `post/ReportPostModal`, ✅ `marketplace/ReportListingModal`, ✅ `profile/ReportUserModal` share `report/ReportSheet`, and ✅ `profile/BanUserModal` uses its body `report/ReasonNoteSheet` with a `DangerButton` confirm (D94). ⏳ Left: `legal/LegalConsentGate` (its page sheet), together with the `LegalConsentScreen` exit confirm below.
- Centred dialogs → `Modal` (14): ✅ **13 migrated** (2026-11-01, actions on the kit buttons in `md`: a destructive confirm is a `DangerButton`, D94): `DeleteAccountConfirmModal`, `EnablePushModal`, `HideChatConfirmModal`, `NotifyModal`, `OnboardingSoftGateModal`, `admin/admins/{ChangeRoleModal, GrantRoleModal, ManagerPickerModal}`, `closure/{ClosureExplainerSheet, ReopenConfirmModal}` (the explainer is centred despite its name), `post/ConfirmActionModal`, `profile/KarmaBadge`, `survey/SurveyThankYouModal`. ⏳ **Left: `legal/LegalConsentScreen` (exit confirm).** The kit `Modal` registers with the app's open-modal count, and `LegalConsentGate` defers (unmounts its full-screen consent) while that count is above zero, so opening the exit confirm on the kit would close the consent screen under it. It moves with `LegalConsentGate`, once the gate stops deferring while its own consent screen is up.
- Full-screen or side surfaces — decide per case, keep raw with the allow-marker if no kit surface fits (3 files, plus the full-screen uses in `LegalConsentGate` / `LegalConsentScreen`): `PostImageViewerModal`, `DeleteAccountSuccessOverlay`, `features/about-landing/AboutNavDrawer`.
- In the kit: `DateTimeField`'s picker sheet moves onto `BottomSheet`.

**Chip components → `Chip` (8 exported, 3 local, 2 chip groups; plus 40 files with a hand-rolled `chip` style, guard rule `adHocChip`; 29 left).** ✅ marks the chips slice (2026-11-01): 7 of the 8 exported and all 3 local chip components.
- Exported: ✅ `PostFilterSheet/Chip` (deleted; the feed filter sections render the kit `Chip` directly, `sm` since §8.1), ✅ `search/SearchChip` (now a thin adapter over the kit `Chip`), ✅ `admin/AdminFilterChip` (thin adapter, `sm`), ✅ `admin/tasks/{TaskStatusChip, TaskPriorityChip, TaskCategoryChip}` (thin `sm` tags; `taskTagTones.ts` gives every value in a group its own look, D99: status open neutral, in progress info, blocked warning, done success, archived muted; priority low muted, medium neutral, high warning, urgent error; category moderation error, support info, engineering brand, product success, marketing warning, finance / operations neutral, other muted, and every category leads with its own icon, which tells finance from operations), ✅ `admin/admins/ChoiceChips` (a wrapping row of kit filter chips). **Kept: `chat/ChatReactionChips`** — not a filter, tag or applied value but an emoji reaction counter inside the message bubble: the kit's selected fill is `primary`, the colour of the user's own bubbles, so their own reaction would disappear there, and the 44pt-wide pills would widen every bubble. It needs a reaction pattern of its own (with the chat redesign).
- Local: ✅ `RadiusChip` (`PostFilterSheet/LocationFilterSection`, now the kit `Chip`; its selected fill moves from `secondary` to the kit's `primary`), ✅ `Chip` in `admin/tasks/TaskAssigneeFilter` and ✅ `FilterChip` in `app/(admin)/tasks/index` (both now `AdminFilterChip`).
- Groups that should render kit chips: ✅ `marketplace/BrowseRefineChips` (kit filter chips, `sm`, 2026-11-01, with the world feeds of FR-FEED-020), `features/rides/components/RideAdvancedChips`.
- `chip`-style files by area: admin screens and components 20 (13 left: ✅ `AdminFilterChip`, `admins/ChoiceChips`, `tasks/{TaskStatusChip, TaskPriorityChip, TaskCategoryChip, TaskAssigneeFilter}`, `app/(admin)/tasks/index`), search / post filter / create / edit 7 (4 left: ✅ `search/searchFilterSheet.styles`, `PostFilterSheet/{Chip, LocationFilterSection}`), marketplace 4, settings 3, and one each in map, about, cards, chat and rides (✅ money: the donation amount presets are kit chips since CTAs 2). `LayerPersonChip` is an avatar tile, not a chip: rename its style when that file is touched. Status pills named `pill` (`PostDetailStatusBadge`, `KcRowCard`, `MyRequestRow`, `MyRideRow`) are tags too, but the guard does not count `pill` because the name also covers nav tabs and separators.

**Hand-rolled CTAs → buttons.** `backgroundColor: colors.primary` appears 164 times in 137 files outside the kit (CTAs plus selected chips): admin components 25 (24 files), root components 20 (18), admin screens 17 (11), rides 11 (8), tabs 10 (9), closure 8 (7), about 8 (8), marketplace 5, onboarding 5, then ≤ 4 per area. No guard yet: a precise rule for "a hand-rolled primary button" needs the press handler and the fill in one place, which a line rule cannot see. ✅ **CTAs 1 — onboarding, auth and closure** (2026-11-01; 118 fills in 99 files left outside the kit and tests, down from 129 in 109 on `dev` before the slice — counted as the whole token `backgroundColor: colors.primary`): onboarding ✅ `(onboarding)/{about-intro, basic-info, photo, tour}` (the bottom CTA is an `lg` `PrimaryButton` with the trailing arrow; the photo step's "choose / replace photo" is an `md` `SecondaryButton`; basic info also moves its three text inputs onto `TextField`); auth ✅ `(auth)/{sign-in, sign-up}` (now one shared form, `auth/AuthFormScreen` with its state in `auth/useAuthEmailForm`; `lg` submit, ghost links), ✅ `(auth)/forgot-password`, ✅ `auth/{reset-password, verify, callback}` (their message states share `auth/AuthStatusScreen`, `md`), ✅ `auth/VerificationPendingPanel` (primary, secondary resend, ghost "change address", `md`); closure ✅ `closure/OwnerActionsBar` (`lg` primary "mark as delivered", `lg` secondary "reopen"). **Not CTAs, kept:** the photo step's camera badge, the closure recipient radio dot and the explainer's "don't show again" checkbox (selection marks), the onboarding step header's skip / back (navigation), and the welcome screen's Apple / Google buttons (third-party brand looks; the welcome screen has no primary fill).

✅ **CTAs 2 — tabs, marketplace, about and rides** (2026-11-01): 103 fills in 85 files left outside the kit and tests, down from 118 in 99 on `dev` after CTAs 1 — counted as the whole token `backgroundColor: colors.primary` in `apps/mobile/{src,app}`, leaving out `src/components/ui/` and tests. Tabs ✅ `donations/money/{donate, standing-order}` (one shared `money/AmountCheckoutForm`: `TextField` amount, kit `Chip` presets, `lg` primary confirm), ✅ `donations/money/nonprofit` (`md` primary "donate now" beside an `md` secondary "monthly gift"), ✅ `donations/marketplace/my-listings/edit` (`TextField`s, `lg` save), ✅ `donations/time/{opportunity, support, organizer/{index, create, [opportunityId]}}` (`md` in cards, `lg` publish; the organizer's shift links are `sm` ghost buttons and "close opportunity" is a `DangerButton`, D94); marketplace ✅ `ListingDetailActions` (`md` primary "message", secondary share / report), ✅ `GivingHandoffActions`, ✅ `rides/{RideBookingRow, RidePassengerBooking}` (one `marketplace/HandoffActionButton`, `md`, blocked while any action of the flow runs), ✅ `HandoffRatingForm` (`md` submit); about ✅ `AboutContactLinks` (`md` primary with its icon), and the unused `AboutInstagramEmbed` (native and web) was deleted on 2026-11-02 with owner approval (TD-256, closed). `features/rides/**` has no hand-rolled CTA left (its three sheets have no caller, `TD-244`). **Not CTAs, kept:** the About hero banner, the scope toggle's selected segment, the contributions-grid badge, the audience icon badge and the logo section's pull-quote rule; the rating stars and the seat stepper (selectors); the ride emergency call (an `error` fill, not a primary one, and not a destructive action in the D94 sense — since 2026-11-02 the kit `AlertButton`, §8.1 call 7).

✅ **CTAs 3 — root components** (2026-11-02): 97 fills in 80 files left outside the kit and tests, down from 103 in 85 on `dev` after CTAs 2 (same whole-token count). ✅ `EmptyState` (`EmptyStateActions`: an `md` primary and an optional `md` secondary; the kit plays the haptic), ✅ `FirstPostNudge` (`md` primary "share", `md` secondary "remind me", the permanent dismiss is an `sm` `GhostButton`), ✅ `ErrorBoundary`, ✅ `PostFeedList` and ✅ `AuthGate` (each retry is an `md` primary under its centred message), ✅ `DonationLinksList` (the empty-state and load-error calls to action are `md` primaries). **Not CTAs, kept:** the donation links' round "add" icon button (an icon-button pattern is not in the kit yet), the new-posts banner pill, the tab bar's create circle, the chat / top-bar count badges, the warm prompt card's icon badge and the user's own chat bubble.

✅ **CTAs 4 — admin, the token-clean files** (2026-11-02): 84 fills in 68 files left outside the kit and tests, down from 97 in 80 after CTAs 3 (same whole-token count). Every admin action is the compact `sm` size (§4.3); a destructive one is a `DangerButton` (D94). Shared: ✅ `AdminCardActions` (primary edit, danger delete), ✅ `AdminFormActions` (ghost cancel, primary submit that keeps its "saving" label while blocked), ✅ `AdminScreenHeader` (primary "new"); ✅ `crm/ContactCard` (secondary "mark contacted", primary edit, danger delete), ✅ `admins/{GrantManagerSection, PersonRolesSection, layers/AdminsLayersView}` (primary assign / add role with the `add` glyph / retry; secondary "clear manager"), ✅ `time/TimesheetEntryCard` (secondary edit, primary submit / approve, danger delete / reject), ✅ `reports/CaseTargetCard` (primary open post / listing / profile); screens ✅ `(admin)/{money, tasks, admins}` (primary "new" / "grant") and ✅ `(admin)/whatsapp` (the kill switch: primary to turn the channel on, danger to turn it off). **Not CTAs, kept:** the admins view-mode segment, the status / category / assignee chips (chip slice), the timeline dot, the survey bars and the nav brand mark. The admin files still in the brand-guard baseline (UI-ADMIN-1's token cleanup, §4.3) keep their hand-rolled CTAs until that cleanup reaches them: `crm/ContactFormModal`, `tasks/TaskDueRangeFilter`, `time/TimesheetFormModal`, `(admin)/{audit, crm, org-approvals, tasks/new, tasks/[taskId]}`.

#### 4.1.2 Search, filter and sort kit (#1457)

The shared filter kit (`apps/mobile/src/components/filterKit`) standardizes search inputs, filter buttons, chip rows, section frames, and sort sections across the mobile app.

- **Kit controls:** `FilterSearchBar` (search input with search icon, clear button, RTL alignment, testID), `FilterButton` (icon or boxed filter button with active count badge), `ChipSelectRow` (default chip layout for forms and filter sections: one sideways-scroll row plus a small expand control that switches to multi-line wrap), `FilterChipRow` (chip row of kit `Chip`s on top of `ChipSelectRow`, single or multi-select; pass `scrollable` for scroll-only bars without expand), `FilterSection` (composite titled section wrapping `FilterChipRow`), `SortSection` (preset sort options row), `FilterSheetFrame` (standardized bottom sheet frame with scrollable body, count badge, reset link, and footer apply action).
- **Surfaces migrated to kit:**
  - Home feed filter sheet (`components/PostFilterSheet/*`)
  - Universal Search screen (`app/(tabs)/search.tsx`, `components/search/*`) and sheet (`components/SearchFilterSheet.tsx`)
  - Giving world feeds controls (`components/giving/WorldFeedControls.tsx`) and marketplace refine chips (`components/marketplace/BrowseRefineChips.tsx`)
  - Rides filter sheet (`features/rides/sheets/RideFilterSheet.tsx`)
  - Admin report filters (`components/admin/reports/ReportFilters.tsx`)
  - Admin task assignee and status filters (`components/admin/tasks/TaskAssigneeFilter.tsx`, `app/(admin)/tasks/index.tsx`)
  - Admin content search rows (`app/(admin)/posts/index.tsx`, `app/(admin)/users/index.tsx`)
  - Admin CRM search and status filters (`app/(admin)/crm/index.tsx`)
  - Admin audit search and action filters (`app/(admin)/audit/index.tsx`)
  - Chat inbox search (`app/chat/index.tsx`)
  - User followers and following lists search (`app/user/[handle]/followers.tsx`, `app/user/[handle]/following.tsx`)
- **Kept out of kit / raw:** `components/giving/RideMatchSearch.tsx` is a corridor match via dual origin/dest place selector (`RidePlaceField` + `SearchablePicker`); `components/SearchablePicker` is a fixed-height modal picker (kept raw per §4.1.1).

### 4.2 Icons

- One icon set: **Ionicons** from `@expo/vector-icons`. Do not add another icon library or inline SVG icons without a decision. ESLint `no-restricted-imports` blocks the other `@expo/vector-icons` families (named or deep imports) and other icon libraries (lucide, react-native-vector-icons, Feather, Phosphor, Heroicons, Tabler, Font Awesome) (D87).
- Sizes come from `iconSize` (xs 14 · sm 16 · md 18 · lg 20 · xl 22 · 2xl 24). A larger hero / empty-state glyph (28+) stays off the scale with an end-of-line `brand-guard-allow: <reason>` on its `size=` line.
- Directional icons (arrows, chevrons, carets, "back") must mirror between RTL and LTR; non-directional icons never mirror. A directional glyph is named for LTR and rendered through the kit `MirroredIcon` (`apps/mobile/src/components/ui/MirroredIcon.tsx`), which flips it when the layout runs RTL (`isLayoutRtl()`); the "back" affordance takes its glyph from `useDirectionalBackIcon()` (chevron on iOS, arrow on Android and web). The brand guard counts a directional glyph on a raw `Ionicons` tag (`unmirroredDirectionalIcon`, frozen per file, counts only go down); a media control that must not mirror carries `brand-guard-allow` on its `name=` line.
- Icon colours come from tokens (`colors.primary` for brand glyphs, `textSecondary` for neutral ones).

### 4.3 Admin surfaces (D67)

Admin and team-only screens use the **same** colours, type, radius, components and rules as the rest of the app. They may be denser: one spacing step tighter, smaller type presets (`bodySmall`, `label`) and tables instead of cards. They never introduce their own colours (role badges included).

**Cleanup complete (#1287).** All admin surfaces (`app/(admin)` and `src/components/admin`) are 100% aligned to brand tokens and shared kit components (`Chip`, `TextField`, `Buttons`), with zero brand-guard findings. Role badges use semantic role tokens in `@kc/ui` (`roleSuperAdmin`, `roleModerator`, etc.) checked for WCAG AA contrast in both light and dark palettes in `brandContrast.test.ts`. All admin findings in `brand-guard.baseline.json` are removed, and `brandGuard.test.ts` enforces that admin surfaces remain at zero going forward.

### 4.4 Appearance

Light, dark and system appearance (FR-SETTINGS-014). The native app passes the OS colour scheme through (`app.json` `userInterfaceStyle: "automatic"`, `expo-system-ui` on Android) so "system" can resolve to dark; signed-out surfaces stay light.

#### 4.4.1 Platform conventions (#858, KC#1960)

KC provides a full native look on each platform: Apple style (HIG) on iOS, Material 3 on Android, and a neutral system look on web. The KC look is the brand colours and content; shape, depth, typography and press feedback follow each platform (D-231 supersedes D66). Design: [`docs/superpowers/specs/2026-11-08-platform-adaptive-ui-design.md`](../superpowers/specs/2026-11-08-platform-adaptive-ui-design.md).

#### 4.4.2 Visual platform tokens (KC#1960)

Visual tokens branch through `platformSelect` in `@kc/ui` and are exposed as `theme.platform` in `ThemeContext`:

| Token | iOS (Apple HIG) | Android (Material 3) | Web (System) |
|---|---|---|---|
| Corner Radius (card/dialog) | Compact: `sm` 8px, `md` 10px, `lg` 14px, `xl` 20px | Rounded: `sm` 8px, `md` 12px, `lg` 16px, `xl` 28px | Clean: `sm` 6px, `md` 8px, `lg` 12px, `xl` 16px |
| Depth / Shadows | Layered soft blur shadows (`shadowRadius: 4-16`, low opacity) | Native elevation (`elevation: 2-8`), surface tint | Subdued box-shadows |
| Press Feedback | Opacity fade (`activeOpacity: 0.7`) | Material surface ripple | Subdued hover / active state |
| Typography / Font | System font (SF Pro) via dynamic type | System font (Roboto) | System sans-serif stack |
| Branching gate | `platformSelect` from `@kc/ui` | Same | Same |

Raw `Platform.OS` or `Platform.select` checks are forbidden by the CI brand guard (`rawPlatformCheck`, §6). All branching must go through `platformSelect`.

| Concern | iOS | Android | Web (export) | Hook |
|---|---|---|---|---|
| Stack push / pop | Native stack slide | `slide_from_right` on the root stack; nested stacks slide natively | Cross-fade | `rootStackAnimation.ts`, `nestedStackGestureOptions.ts` |
| Back | Edge swipe on every nested stack + mirrored back chevron | System back pops the stack; predictive back stays **off** (`app.json`) | Browser history | stack options, `MirroredIcon` |
| Header | Shared `TopBar` on tab roots and worlds; no large titles (only screens that already opt in keep them) | Same | Same | `TopBarStackHeader`, `detailStackScreenOptions` |
| Sheet / dialog dismiss | Backdrop, ✕, swipe down | + hardware back | Escape | kit `BottomSheet` / `Modal`, `useModalHardwareBack` |
| Action menus | Kit `ActionMenuSheet` | Same | Same | `ActionMenuSheet.tsx` |
| Tab re-tap | Tab root: no-op; nested: back to the tab root (FR-RESP-006 AC23) | Same | Same | `tabPress.ts` |
| Keyboard | `KeyboardAvoidingView` `padding` + measured offset | Window resize; offset 0 | Offset 0 | `useKeyboardVerticalOffset()` |
| Date / time | Spinner in a sheet, app palette | System dialogs (date, then time) | `<input>` | `DateTimeField.tsx` |
| Pull-to-refresh | Native `RefreshControl` + light tap | Same | Same | `KcRefreshControl.tsx` |
| Haptics | See below | See below | None | `src/lib/haptics.ts` |
| Reduce motion | Sheets and kit controls skip their animation; stack transitions stay OS default | Same | Same | `useReducedMotion` |

**Haptics policy.** `src/lib/haptics.ts` is the only module that imports `expo-haptics` (ESLint, §6); every helper is a no-op on web, best-effort on devices without a haptic engine, and the OS setting can turn them off. Reduce motion does not turn haptics off.

| Helper | When | iOS | Android |
|---|---|---|---|
| `hapticSuccess` | A confirmed outcome, **after** the server succeeds: publish, handoff / booking / registration confirmed, marked delivered, comment sent, a **new** post or chat reaction, a new comment like | Success notification | Same |
| `hapticLightImpact` | Kit press feedback (`PrimaryButton` and friends, `PressableScale`); turn it off with `haptic={false}` where the action already plays an outcome haptic | Light impact | Same |
| `hapticLightTap` | Light affirmation on non-outcome controls: filters, toggles, pull-to-refresh | Light impact | Context click |

No haptic on errors, validation, a duplicate press, removing a reaction or like, or a failed request.

## 5. Accessibility floor

KC targets **WCAG 2.x AA** (Israeli standard IS 5568): normal text ≥ 4.5:1, large text and UI glyphs ≥ 3:1, in **both** palettes. The required pairs are encoded in `packages/ui/src/__tests__/brandContrast.test.ts`. Known failures are listed there with a TD reference and must be removed when fixed.

Since D66 every required pair passes in both palettes (e.g. white on `primary` 5.2:1, give/request tags 4.9:1, `error` on white 4.8:1); the exception list in the test is empty. The vivid orange (`primaryVivid`) may be used only where it carries no text or meaning (decoration). Avatar initials (`avatarPalette`) are checked in the same test.

## 6. Guardrails (automated)

All run inside `pnpm test` (pre-push gate and CI):

| Test | Location | Fails when |
|---|---|---|
| Token contract | `packages/ui/src/__tests__/theme.test.ts` | a core token is removed or changes shape |
| Palette parity | `packages/ui/src/__tests__/brandTokens.test.ts` | light and dark palettes drift in keys, or a value is not a valid colour |
| Token export drift | `packages/ui/src/__tests__/brandTokens.test.ts` | `kc.tokens.json` does not match the code |
| Brand identity | `packages/ui/src/__tests__/brandTokens.test.ts` + `apps/mobile/src/__tests__/brandGuard.test.ts` | the brand name / nickname, the locale `appName`s, or the store name in `app.json` drift |
| Contrast floor | `packages/ui/src/__tests__/brandContrast.test.ts` | a required pair drops below AA, or a listed exception starts passing (stale) |
| Brand font | `packages/ui/src/__tests__/brandFont.test.tsx` + ESLint `no-restricted-imports` | a weight stops mapping to its face, or app code imports `Text` / `TextInput` from `react-native` |
| Icon set | ESLint `no-restricted-imports` (`app/eslint.config.mjs`) | app code imports an icon family other than `Ionicons`, or another icon library (D87) |
| Haptics gate | ESLint `no-restricted-imports` (`app/eslint.config.mjs`) | app code other than `src/lib/haptics.ts` imports `expo-haptics` (§4.4.1) |
| Hard-coded style ratchet | `apps/mobile/src/__tests__/brandGuard.test.ts` (rules in `brandGuardRules.ts`, pinned by `brandGuardRules.test.ts`) | a file gains a finding beyond its frozen baseline, or a new file has any. Rules: `colorLiteral`, `fontSizeLiteral`, `fontWeightLiteral`, `fontFamilyLiteral`, `radiusLiteral`, `spacingLiteral`, `physicalSide`; since D87 also `iconSizeLiteral` (numeric Ionicons `size`), `zIndexLiteral`, `shadowLiteral`, `rawTextInput` (use `TextField`) and `rawModal` (use `Modal` / `BottomSheet`; counts only React Native's `Modal`, by its import); since #1285 also `adHocChip` (a style key named exactly `chip` — use `Chip`) |
| Touched-file rule | `apps/mobile/src/__tests__/brandGuard.test.ts` | a file changed since the PR base still has any finding (D67) |
| Config colours | `apps/mobile/src/__tests__/brandGuard.test.ts` | `app.json` / `+html.tsx` brand colours drift from `primaryVivid`, or the native colour scheme is forced to light |
| Copy voice | `apps/mobile/src/__tests__/copyVoiceGuard.test.ts` | a locale file gains a voice finding (§7.5) beyond its frozen baseline, a changed locale file has any, or the key slogan leaves the Hebrew bundle (D93) |

**Touched-file rule (D67).** A PR that changes a file in `apps/mobile/{src,app}` must leave that file with **zero** findings — every rule, the whole file, not only the changed lines. Files nobody touches keep their frozen counts until someone works in them. The guard diffs against the merge-base with the PR base (`GITHUB_BASE_REF`, else `origin/dev`; override with `KC_BRAND_BASE_REF`), including uncommitted changes. In CI an unresolvable base fails the test (the frontend job checks out full history); a local clone without the ref skips the rule. The rule does **not** apply to release traffic into `main` — a push to `main` and a dev → main release PR (`GITHUB_BASE_REF=main`, `GITHUB_HEAD_REF=dev`): their files were already gated on their own PRs into `dev`, and until the main → dev sync lands `dev` lacks `main`'s history, so the merge-base is the previous release and every file changed since then would count (CI on `main` failed this way after the first release, #1490). Setting `KC_BRAND_BASE_REF` applies the rule regardless. Pinned by `apps/mobile/src/__tests__/ratchetTouchedRule.test.ts`.

The ratchet baseline (`apps/mobile/brand-guard.baseline.json`) only goes down. After removing literals, refresh it with `KC_BRAND_BASELINE=update pnpm --filter @kc/mobile test -- brandGuard`; a PR that *raises* a count must explain why in its body.

## 7. Voice and tone (D93)

Ported from the Founder-approved master narrative (`docs/SSOT/archive/superpowers/specs/2026-05-26-karma-community-master-narrative.md` §7.4, §15, §16) and FR-RESP-006 AC19/AC20 ([legacy spec](../SSOT/spec/17_responsive_desktop.md)). Nothing here is new brand content; where the narrative and a later decision differ, the decision wins (noted inline).

### 7.1 Principles

- **One voice** (§7.4): "קול אחד. מסרים אחידים וברורים. בכל ערוץ אנחנו נשמעים כמו עצמנו." App, Instagram, WhatsApp, email and partnerships speak in it. Length and format per channel are execution, not voice.
- **Register:** UX / dugri-friendly Israeli — short sentences, direct, no bureaucratic Hebrew, no padded softeners. Buttons, errors, toasts and form labels are UX-direct; settings rows, FAQ and the About narrative may use the fuller business register (AC19).
- **Reading test:** "יהודי בן 60 מהפריפריה יבין בקריאה ראשונה."
- **Honesty:** the early stage is a feature ("בונים יחד"), not hidden. Doctrine (§16.10): "לא משקרים. כותבים מה יש היום, מה השאיפות, ואיך הולכים משם לשם."
- **Metaphor:** the narrative's "קיבוץ קפיטליסטי" is limited by D67 / D93 (§1): it may appear subtly on the About screen and in its FAQ only, never elsewhere, in any language. Everywhere else the public form is the slogan "קיבוץ דיגיטלי בעולם טכנולוגי."
- **Brand name:** "קהילת קארמה" or "KC" in Hebrew (§1); first mention "קהילת קארמה (KC)", then KC. Never a Hebrew transliteration of "Karma Community".

### 7.2 Gender-neutral copy (AC20)

The current user is addressed without grammatical gender. **House convention: the infinitive** — alone on buttons ("ללחוץ", "לפרסם") or after "יש" / "אפשר" / "ניתן" in sentences ("יש ללחוץ", "אפשר לבחור"). It is the neutral form the locale bundles already use most (about 210 infinitives vs. 100 plural imperatives across the common UI verbs). Action nouns ("שמירה", "שליחת קישור") are fine for buttons. Plural imperatives ("לחצו", "נסו") are neutral and tolerated, but new copy prefers the infinitive.

| Don't (gendered) | Do (neutral) |
|---|---|
| לחץ כאן / לחצי כאן | ללחוץ כאן · יש ללחוץ כאן |
| נסה שוב | לנסות שוב · נסו שוב |
| בחר עיר | בחירת עיר · אפשר לבחור עיר |
| אתה יכול לבחור עד 5 תמונות | אפשר לבחור עד 5 תמונות |
| מה אתה נותן? | מה נותנים? |
| תוכלי לשלוח בקשה חדשה | אפשר לשלוח בקשה חדשה |

Out of scope: strings about *another* user ("{{name}} הצטרף"), which follow that user's stored gender.

### 7.3 Spelling, words and length

- **Ktiv maleh** (§15): תוכנה, שירות, תיאור, ביטול — not תכנה, שרות, תאור, בטול.
- **Forbidden jargon** (§15) — replace with plain Hebrew:

| Avoid | Use instead |
|---|---|
| MVP | "מה יש היום" / "הגרסה הראשונה" / "מה שכבר עובד" |
| Vision (English label) | "מה אנחנו בונים בהמשך" / "הכיוון שלנו" |
| PMF, KPI, North Star, toggle, feed (unexplained) | עברית פשוטה |
| Philanthropy, infrastructure, scale | translation or everyday wording |
| Unexplained acronyms | "קהילת קארמה (KC)" first time, then KC |

- **Allowed loanwords** when Israelis expect them: ווטסאפ, ביט, פייבוקס, אינסטגרם, גיטהאב (with "קוד פתוח"); צ׳אט, פוסט, פיד only when plain ("רשימת בקשות והצעות באזור שלכם" may replace "פיד").
- **Padded softeners** (AC19): no "נשמח אם…", "אנא…", "ייתכן שכדאי…". A plain "ייתכן ש…" that reports an uncertain cause ("ייתכן שהפוסט נסגר") is information, not padding.
- **Length** (AC19): a call-to-action (button) is **≤ 4 words**; emoji, arrows and symbols do not count. Errors and toasts are short and direct; titles have no fixed limit.
- **Key slogan** (§16.1), locked wording: **"לתת — זה גם לקבל."** Variants (no dash, different words) are not used. The other §16 lines are the slogan bank; their wording is locked there too.

### 7.4 English copy

English is opt-in and machine-translated from Hebrew (D-167 in `docs/SSOT/DECISIONS.md`; polish tracked as TD-176). It follows the same voice: plain words, no internal acronyms (MVP, PMF, KPI, North Star), the name written "Karma Community" or "KC", and "capitalist kibbutz" only on the About screen and in its FAQ (§1). Gender rules do not apply (English addresses "you").

### 7.5 Enforcement (automated)

`apps/mobile/src/__tests__/copyVoiceGuard.test.ts` (rules in `__tests__/guardKit/copyVoiceRules.ts`, unit tests in `copyVoiceRules.test.ts`) reads every string in `src/i18n/locales/{he,en}/**` and runs inside `pnpm test`. Shortcut: `pnpm lint:hebrew-register` (from `app/`). It works like the brand guard (§6): per-file counts frozen in `apps/mobile/copy-voice.baseline.json` may only go down (refresh with `KC_COPY_BASELINE=update pnpm --filter @kc/mobile test -- copyVoiceGuard`), and the **touched-file rule** (D67) applies — a locale file a PR changes must have zero findings. The findings frozen at adoption (290, mostly singular imperatives on buttons) are tracked as TD-233.

| Rule | Locale | Fails when |
|---|---|---|
| `jargon` | he, en | §7.3 jargon in Hebrew; MVP / PMF / KPI / North Star in English |
| `genderedImperative` | he | a sentence opens with a singular (masc. or fem.) imperative from a curated list — "שלח", "נסה", "מחק", "שמרי" |
| `genderedAddress` | he | "אתה", "הנך", "הינך", "תוכלי", "תרצי" anywhere |
| `paddedSoftener` | he | "נשמח אם", "אנא", "ייתכן שכדאי" |
| `ktivHaser` | he | a listed haser spelling (תכנה, שרות, תאור, בטול, …) |
| `buttonLength` | he | a key named `cta` or ending in `Cta` / `Btn` / `Button` has more than 4 words |
| `brandWording` | he, en | a variant of the key slogan; "קומיוניטי"; "Karma Community" with other casing |
| `hiddenMeaning` | he, en | "קיבוץ קפיטליסטי" / "capitalist kibbutz" in any locale module outside the About screen and FAQ — exempt by an explicit, reviewed file list (`HIDDEN_MEANING_ALLOWED_FILES`: the `aboutContent*` modules, he + en), not by allow markers (D67, D93) |

Precision over recall: the word lists leave out words that also read as nouns, adjectives or common past tenses (המשך, סגור, מלא, אשר, דחה), and a verb followed by "ב-" or "על-ידי" is read as a report, not a command. A justified exception (e.g. a confirm keyword the user must type) carries an end-of-line comment `copy-voice-allow: <reason>` after the closing quote on the line the string ends, reviewed in the PR. The marker never exempts the hidden meaning: only the About and FAQ modules may carry it.

**Not enforced (manual review):** register and reading test, honesty, unexplained acronyms and loanwords in context, gender in adjectives and future-tense verbs ("תוכל" is also third-person feminine), slash forms ("מחובר/ת", tolerated), title length, and English quality.

## 8. Change process

1. Token or brand change → edit `theme/*.ts` (and this file if the meaning changes) → regenerate `kc.tokens.json` → tests green.
2. New/changed **brand-level** value (primary colour, font, logo, name, a voice rule or slogan) needs a PM decision `D#` logged in [90](./90_decisions_log.md).
3. After merge to `dev`, refresh Figma variables and the Claude Design project from `kc.tokens.json`.
4. Exploratory design (new screens, components) may start in Figma or Claude Design; implementation must consume existing tokens or add new ones through step 1.
5. Visual and UX calls inside the brand system are made by the lead designer (the agent, D99) and listed in §8.1. Explicit PM decisions (the `D#` rows above, e.g. D67, D87, D93, D94) stay binding; brand-level changes still follow step 2.

### 8.1 Design-lead calls (D99)

1. Filter sheets keep their actions in the footer: the primary "apply" first, the ghost "clear all" below it.
2. Kit dialogs stack their actions vertically, main action first; a destructive action is a `DangerButton` (D94).
3. Tags in one group are told apart by look: each value gets its own tone, the unfilled `muted` marks an inactive value, and a group with more values than tones adds an icon per value (admin task tags, §4.1.1).
4. Chips in a filter sheet (feed, search, rides) use the compact `sm` size; `hitSlop` keeps the 44pt touch target.
5. Hand-rolled calls to action map onto the kit buttons by role and place: the full-width bottom action of a main flow (onboarding steps, sign-in / sign-up submit, the post owner's bar) is `lg`; an action inside a card, sheet, dialog or centred status message is `md`; a text link (switch screen, change address, back to sign-in) is a centred `GhostButton` (`sm` between form fields). A forward arrow stays a trailing `icon`, so on `lg` it sits on the button's edge. The brand glow under the old hand-rolled primary buttons goes: the kit fill carries the emphasis on its own.
6. One primary call to action per screen, not per section. Where a screen stacks sections with their own actions, the primary is the action that moves the listing through its flow (reserve, claim, book a slot or a seat, confirm, mark handed over, rate) and every other standalone action is secondary or ghost. On the marketplace listing detail, "message the owner" is the primary only when the viewer has no flow action above it: a guest, a request listing, or a world without a handoff or booking flow (`listingFlow.ts`). A repeated row (one booking, one shift) is its own unit and may carry its own main / secondary pair. The owner's sections keep their own actions (approve, confirm) and the owner's share buttons are secondary, so the owner's detail may show no primary at all. Guard: `marketplace/__tests__/listingDetailPrimary.test.tsx` renders the detail per world and role and counts the primaries.
7. An alarm is neither a primary nor a destructive action, so it takes neither fill: the ride emergency call is the kit `AlertButton` — the surface with an `error` outline, `error` label and the `alert-circle-outline` glyph, `md` inside the booking card. Both taps of the two-step call use it (the second shows the spinner); the confirm step's "cancel" is a `GhostButton`. `DangerButton` stays reserved for destructive actions (D94) and `PrimaryButton` for the flow's main action, so the alarm never competes with either.

## 9. Brand decisions log (D65, D66, D67, D87, D93)

| Question | Decision |
|---|---|
| Name | Karma Community / קהילת קארמה, nickname KC (D65) |
| Brand orange vs. AA | Light `primary` = `#C2410C` (brightest orange on this hue that passes 4.5:1 with white and on tags); vivid `#F97316` for decoration only (D66) |
| Brand font | Rubik, app-wide via `@kc/ui` `Text` / `TextInput` (D66) |
| Secondary colour | Logo navy `#203050` (light) / `#A5B8DC` (dark) (D66) |
| Logo master | Current `assets/logo.png` (D66) |
| KC platform vs. KC organization; hidden meaning | KC = the platform; the KC organization is styled like any other org; "קיבוץ קפיטליסטי" never appears in product surfaces except, subtly, the About screen and its FAQ (D67, refined by D93) |
| Radius scale | xs 4 · sm 8 · md 12 · lg 16 · xl 24 · full (D67) |
| Enforcement | Ratchet covers colour, type, radius, spacing and physical sides; every file a PR touches must be fully clean (D67) |
| Admin surfaces | Same tokens and components, denser layout (D67) |
| Icon, layer and shadow tokens | `iconSize` xs 14 · sm 16 · md 18 · lg 20 · xl 22 · 2xl 24; `zIndex` base 0 · raised 1 · overlay 2 · floating 20 · toast 9999; `shadow.glow` added beside `card` / `modal` — each matches the values screens already used most (D87) |
| Components and icons in the guard | Ratchet adds icon size, z-index, shadow, raw `TextInput` and raw `Modal`; ESLint allows only Ionicons (D87) |
| Voice and tone | Master narrative §15 rules adopted as the verbal brand; gender-neutral via the infinitive; ≤ 4-word CTAs; key slogan locked; hidden meaning allowed only on About / FAQ; automated copy-voice guard with ratchet + touched-file rule (D93) |

Open: logo teal `#95D1CF` is not a token yet — add it only when a surface needs it.
