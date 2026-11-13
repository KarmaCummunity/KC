# 14 — Responsive Desktop (FR-RESP-*)

**Status:** 🟡 In progress
**Owner:** Autonomous loop
**Design doc:** `docs/SSOT/archive/superpowers/specs/2026-05-22-responsive-desktop-design.md`

This domain covers adapting the mobile app to desktop browsers (≥ 768px viewport) without regressing mobile (< 768px). Strategy and decisions captured in `D-RESP-001`.

## FR-RESP-001 — Shell primitives (foundation)

**Status:** 🟡 In progress

**ACs:**
- AC1. `@kc/ui` exports a `BREAKPOINTS` constant with four named widths (`mobile`, `tablet`, `desktop`, `wide`) and a `useBreakpoint()` hook returning the current token.
- AC2. `@kc/ui` exports an `AsideContext`, `AsideProvider`, and `useAside(render, deps)` hook. `useAside` is a no-op on mobile.
- AC3. `@kc/ui` exports an `AsidePanel` display component.
- AC4. `apps/mobile/src/components/shell/` contains `NavigationRail`, `SplitAuthLayout`, `AppShell`, and a shared `tabs.config.ts` consumed by both `TabBar` (existing) and `NavigationRail` (new).
- AC5. `SHELL_V2_ENABLED` feature flag exists in `apps/mobile/src/config/environment.ts`, defaults `false`, opt-in via `EXPO_PUBLIC_SHELL_V2=1`.
- AC6. A dev-only route at `/dev/shell-preview` mounts when `SHELL_V2_ENABLED` and showcases all four breakpoints.
- AC7. A baseline snapshot test at 375px viewport guards the mobile invariant.
- AC8. No existing screen or layout file is modified (other than the trivial `TabBar.tsx` refactor to consume `tabs.config.ts` — behavior identical).

## FR-RESP-002 — Wire shell to (tabs)

**Status:** ✅ Done

Wire `AppShell` into root `_layout.tsx`, replacing `ShellWithTabBar` with `ShellWithResponsiveChrome`. Flip `SHELL_V2_ENABLED` default to `true`.

## FR-RESP-003 — Aside panels for feed, donations, profile, search

**Status:** ✅ Done

Each screen publishes contextual aside content via the focus-aware `useScreenAside(...)` wrapper (`useAside` gained an `enabled` arg so unfocused-but-mounted tab scenes withdraw their content):
- Feed → `GivingWorldsAside` (curated giving-world shortcuts; no trending/suggested-follows backend exists at MVP, so the curated list stands in).
- Search → `RecentSearchesAside` (store-backed; a tap runs the query in the screen via the `requestedQuery` handshake on `searchStore`).
- Donations hub → `CommunityStatsAside` (live `community_stats` snapshot, shared query key with the stats screen).
- Profile (own, open + closed tabs) → `ProfileStatsAside` (karma, given/received, open/closed counts, link to `/stats`).

## FR-RESP-004 — Chat inbox layout

**Status:** ⏳ Planned (PR 4)

`chat/_layout.tsx` renders conversations list + active thread side-by-side at ≥768; passthrough at <768.

## FR-RESP-005 — Split-screen auth & onboarding

**Status:** ⏳ Planned (PR 5)

`SplitAuthLayout` wired into `(auth)/_layout.tsx` and `(onboarding)/_layout.tsx`.

## FR-RESP-006 — Mobile platform polish & bottom-bar safety

**Status:** 🟡 In progress

Cross-cutting fix for content cropping behind the floating tab bar on mobile + platform-aware paper cuts. Audit-driven, mapped 1:1 to plan `docs/SSOT/archive/superpowers/plans/2026-05-25-mobile-platform-polish-audit.md`.

**ACs:**
- AC1. Every screen where `useShellTabBarVisibility()` returns `true` reserves enough bottom inset on its scrollable content (or on its floating footer) that the last row is fully visible above the floating-pill TabBar across the **full supported-device matrix**: iPhone SE 2nd/3rd gen (375×667, 20pt top inset, 0pt bottom), iPhone 8 (375×667, 20pt/0pt), iPhone 12/13 mini (375×812, 50pt notch, 34pt home-indicator), iPhone X / XR / 11 / 11 Pro / 11 Pro Max (375–414×812–896, 44pt notch), iPhone 12–13 (390×844, 47pt notch), iPhone 14 Pro through 16 Pro / 16 Pro Max (393–430×852–932, 59pt Dynamic Island); small Android (360×640, gesture-nav or 3-button-nav), standard Android (393×873, Pixel 6/7/8), large Android (412×915, Pixel Pro), Android foldable closed (≈360×780, Z Fold outer); mobile web at 320 / 360 / 375 / 414 / 430 viewport widths (Mobile Safari + Chrome). Holds at default Dynamic Type **and** at the OS-level "Larger Text" / "Largest" setting (Android font scale 1.0 → 1.3).
- AC2. The `Screen` primitive (`apps/mobile/src/components/ui/Screen.tsx`) accepts a `tabBarInset?: boolean` prop (default `true`) and adds `useShellTabBarScrollInset()` to its scroll content's `paddingBottom` automatically when on and the tab bar is visible.
- AC3. No screen carries `edges={['bottom']}` on its root SafeAreaView while `useShellTabBarVisibility()` is `true` for that screen.
- AC4. `useDirectionalBackIcon()` (`apps/mobile/src/components/ui/MirroredIcon.tsx`) returns the back glyph named for LTR — `chevron-back` on iOS (Apple HIG), `arrow-back` on Android (Material 3) and on web — and the back affordances (`BackButton`, chat, onboarding and auth headers, the map) render it through `<MirroredIcon>`, which turns it around in RTL; no call site hard-wires a Hebrew-only `arrow-forward`.
- AC5. `useKeyboardVerticalOffset()` returns a sensible value per platform (iOS: real header height from `useHeaderHeight()` + top inset, with explicit override for custom-header screens; Android / web: 0) and replaces every hardcoded `keyboardVerticalOffset={88}`.
- AC6. `Text` elements in tight rows (`PostCard`, `InboxChatRow`, `MessageBubble`) cap dynamic-type at `MAX_FONT_SCALE_TIGHT = 1.35` via `maxFontSizeMultiplier`; long-form copy uses `MAX_FONT_SCALE_FLEX` (2.0 native / 1.5 web).
- AC7. Snapshot tests at `apps/mobile/src/components/ui/__tests__/Screen.tabBarInset.test.tsx`, `Screen.nativeHeader.test.tsx`, and `Screen.deviceMatrix.test.tsx` prove that the `Screen` primitive's `contentContainerStyle.paddingBottom` includes the tab-bar height when visible and excludes it when suppressed, across six representative device profiles.
- AC8. Mobile invariants from FR-RESP-001 (375px snapshot) and FR-RESP-002 (no shell regression) still pass.
- AC9. Screens registered with `headerShown: true` (native Expo Router header) do **not** double-pad: the `Screen` primitive's effective edges drop `'top'` when its new `hasNativeHeader` prop is set.
- AC10. `useKeyboardVerticalOffset()` reads the actual rendered header height when available (`useHeaderHeight()` from `@react-navigation/elements`); explicit numeric override for custom-header screens (e.g. `chat/[id]`).
- AC11. Dynamic Type policy split: `MAX_FONT_SCALE_TIGHT = 1.35` on fixed-height grid cells / one-line rows; `MAX_FONT_SCALE_FLEX = Platform.select({ ios: 2.0, android: 2.0, web: 1.5 })` on long-form body. Recorded as `D-RESP-006` in `docs/SSOT/DECISIONS.md` (in PR D, not this PR).
- AC12. App-level platform preconditions encoded in `app.json`: `expo.android.softwareKeyboardLayoutMode = "resize"` and `expo.androidStatusBar.translucent = true`.
- AC13. Left/right safe-area insets honored on the floating TabBar wrapper and on every scrollable's `contentContainerStyle` that previously used only horizontal `spacing.base`. Verified on iPhone 16 Pro Max landscape (`insets.left = 59`) and Galaxy Z Fold landscape sanity check.
- AC14. Mobile Safari visible-viewport fix: root `_layout.tsx` injects `html, body, #root { min-height: 100dvh; height: 100dvh; }` (with `100%` declared first as fallback). Verified by integration check.
- AC15. `FlatList` / `ScrollView` `contentContainerStyle` arrays that include the dynamic `tabBarPad` are memoized with `useMemo` — prevents inner ScrollView content-size cache invalidation on iOS when route changes trigger re-renders.
- AC16. Manual matrix executed across all four tiers (iOS phones from SE through 16 Pro Max; Android compact + standard + large + foldable closed; iPad mini portrait + iPad 10th gen + iPad Pro 13" landscape; Mobile Safari + Chrome at 320/360/375/414/430/768/1024/1440), with OS-Largest-Text setting on. Failed cells filed as `TD-1xx` entries.
- AC17. Hebrew typography minimums (from `skills-il/localization@israeli-ui-design-system`): `typography.body.lineHeight / typography.body.fontSize ≥ 1.7`; `typography.bodyLarge.lineHeight / typography.bodyLarge.fontSize ≥ 1.7`; minimum `fontSize ≥ 13` on every body-or-larger token. Tested via `typography.hebrewMinimums.test.ts`.
- AC18. Directional-icon mirroring policy: every directional icon (chevron, arrow, caret, play/forward/backward) renders through the `<MirroredIcon>` primitive (`apps/mobile/src/components/ui/MirroredIcon.tsx`), which applies `transform: scaleX(-1)` only when the layout runs RTL (`isLayoutRtl()`: `document.dir` on web, `I18nManager.isRTL` on native). Non-directional icons (search, home, settings, bell, gear) MUST NOT mirror. The brand guard's `unmirroredDirectionalIcon` rule freezes the remaining raw directional glyphs per file (spec 17 §4.2) and ratchets them down.
- AC19. Hebrew UX copy register: locale strings for buttons, errors, toasts, and form labels are UX-direct — short and direct, calls-to-action ≤4 words, no padded softeners (`נשמח אם`, `אנא`, `ייתכן שכדאי`). Rules in `docs/spec/17_brand_and_design_system.md` §7 (D93). Audited by the copy-voice guard (`apps/mobile/src/__tests__/copyVoiceGuard.test.ts`, inside `pnpm test`; shortcut `pnpm lint:hebrew-register` from `app/`) as a ratchet: existing findings are frozen in `apps/mobile/copy-voice.baseline.json` and every locale file a PR changes must be clean.
- AC20. Gender-neutral UX strings (Option C): every UX locale string for the current user uses neutral phrasing — the infinitive (`ללחוץ`, `יש להזין`, `ניתן לבחור`) — instead of masculine or feminine singular forms (spec 17 §7.2). Sentence-initial singular imperatives and singular address (`אתה`, `הנך`, `תוכלי`) are audited by the same guard; strings about *another* user are out of scope.
- AC21. Free-text inputs use auto direction: every `<TextInput>` whose content can be either Hebrew or English sets `textAlign="auto"` and `writingDirection: 'auto'`. Numeric / single-direction fields keep fixed direction.
- AC22. Shadows + gradients have no horizontal physical offsets: audited by `app/apps/mobile/scripts/lintRtlShadows.mjs`; fails CI if a future PR introduces a `shadowOffset.width !== 0` without an `I18nManager.isRTL` guard.
- AC23. Re-tapping the active tab never re-mounts its screen (#1633). On the tab's root screen the press does nothing (no push, no replayed entry animation); on a nested screen of that tab it unwinds to the tab root (`router.dismissTo`), whose screen stays mounted underneath. The composer "+" is the exception: re-tapping it while the create form is open closes the form (`router.back()`, or `dismissTo('/(tabs)')` when there is nothing to go back to). Other tabs open as before. One rule for the bottom `TabBar` and the desktop `NavigationRail`: `resolveTabPressAction` / `handleActiveTabRepress` in `apps/mobile/src/components/shell/tabPress.ts`. Tests: `shell/__tests__/tabPress.test.ts`, `components/__tests__/TabBar.repress.test.tsx`, Maestro `15-tab-retap-and-profile-tabs.yaml`.
- AC24. One form behavior everywhere. Every text input inside a `FormScreen` or `FormScrollView` joins a form scope automatically, with no per-field wiring: (a) the keyboard toolbar (Previous / Next / Done) and the return key (Next, then Done on the last field) follow the **on-screen reading order** — top to bottom, and within one row from the reading-start edge (right in Hebrew); disabled fields are skipped; multiline fields keep their newline key. (b) A field that **newly** shows an error scrolls into view (top-most first when several appear together); an error present on first render, or on the field being typed in, never moves the screen. A form can re-trigger the jump after a rejected submit with unchanged errors (`FormScrollView.jumpToProblemSignal` / `useScrollToFirstInvalid`). Non-text sections (photo picker, pickers) take part via `useFormScopeAnchor`. A form that hand-wires its own toolbar (`keyboardAccessory`) opts out. Code: `components/ui/formScope.ts`, `useFormScopeField.ts`, `FormScrollView.tsx`, `lib/platform/formFieldOrder.ts`. Tests: `components/ui/__tests__/formScope.test.tsx`, `lib/platform/__tests__/formFieldOrder.test.ts`.
- AC25. The keyboard matches the content. `TextField` takes `inputKind` (`text | name | email | phone | integer | decimal | url | date | time | streetNumber | password`), mapped in `lib/platform/formTextInputHints.ts` to the keyboard type, `inputMode`, capitalisation, autocorrect and autofill hints; explicit props still win. Tests: `lib/platform/__tests__/formTextInputHints.test.ts`, `TextField.test.tsx`.
- AC26. Rejected Publish on the give / request form (`app/create.tsx`) marks the missing title / photo / address inline and scrolls to the first one on every attempt, in addition to the toast (`useCreatePostPublish`: `titleInlineMessage`, `photoInlineMessage`, `failedSubmitCount`).
