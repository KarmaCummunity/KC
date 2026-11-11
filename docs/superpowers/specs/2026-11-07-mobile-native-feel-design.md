# Mobile native feel — design specification (issue #858)

**Status:** Approved for implementation (gaps-only).  
**Date:** 2026-11-07  
**Platforms:** iOS and Android (web export inherits documented behavior where applicable).  
**Epic context:** Design system #1061; absorbs closed guideline duplicate #1022.

This document is the **written design spec** for [#858](https://github.com/KarmaCummunity/KC/issues/858). It does **not** close the issue. Issue closure requires merged implementation PR(s) plus native verification evidence described in §8.

**Related spec (not replaced by this file):** Product platform rules will land in `docs/spec/17_brand_and_design_system.md` §4.4.x during implementation slice **858a**. Cross-cutting keyboard/tab behavior remains mapped to **FR-RESP-006** (`docs/spec/requirements/17_responsive_desktop.md`).

---

## 1. Goal and boundaries

### 1.1 Goal

Make KC feel native on iOS and Android by **standardizing and completing** existing patterns: navigation gestures already fixed in #1459, decentralized haptics, hardcoded keyboard offsets, and the missing §4.4 platform guideline table. No visual redesign of unrelated UI and **no backend or business-logic changes**.

### 1.2 In scope (gaps-only)

| Area | Work |
|---|---|
| **Guideline** | Add §4.4.x per-platform table (navigation, back, sheets, haptics, keyboard, typography touchpoints, date pickers, pull-to-refresh) in spec 17. |
| **Navigation / gestures** | Preserve current stack options; audit nested layouts; **align challenges world header** with #1632 TopBar pattern (sole known world-header gap). |
| **Keyboard** | Introduce `useKeyboardVerticalOffset()` and replace all hardcoded `keyboardVerticalOffset={88}` call sites with measured, mode-aware offsets. **Do not** add `react-native-keyboard-controller`. |
| **Haptics** | Single gate in `src/lib/haptics.ts`; explicit semantics for publish, handoff/delivered, and **new** likes/reactions; no haptics on errors, removals, or duplicates; no double feedback with kit button tap. |
| **Pickers / menus** | Retain native platform behaviors (Android system date/time dialogs, iOS spinner in existing presentation, `ActionMenuSheet` / kit `BottomSheet`). **No** iOS `DateTimeField` migration to kit `BottomSheet` in this epic. |
| **Accessibility** | Preserve `useReducedMotion` behavior on overlays and kit controls; haptics defer to OS when disabled (no new dependency). |
| **RTL/LTR** | No change to direction policy; verify affected flows in native matrix. |

### 1.3 Out of scope

- Navigation architecture rewrite, new root/tab structure, or large-title rollout beyond documenting defaults in §4.4.
- Enabling Android `predictiveBackGestureEnabled` (stays **`false`** in `app.json`).
- Active-tab **scroll-to-top** on re-tap (FR-RESP-006 AC23 remains: **no-op** on tab root; nested → `dismissTo` tab root).
- `react-native-keyboard-controller` or other new keyboard libraries.
- iOS date spinner → kit `BottomSheet` migration (spec 17 §4.1.1 follow-up).
- FR-RESP-006 device matrix completion (#861), store release, environment/CI setup beyond tests listed in §7.
- Maestro iOS job creation (noted as future; not blocking this epic’s code slices).

### 1.4 Already supported (do not re-implement)

Evidence: merged PR #1459, `nestedStackGestureOptions.ts`, `TabBar.tsx` + `tabPress.ts`, kit `BottomSheet`/`Modal` + `useModalHardwareBack`, `TopBarStackHeader` (#1632), `useReducedMotion`, `MirroredIcon` / `useDirectionalBackIcon`, publish success haptic in `useCreatePostPublish`, Android edge-to-edge via `expo-navigation-bar` (#859), iOS date spinner theming (#1438).

| Behavior | Implementation hook |
|---|---|
| iOS nested swipe-back | `getNestedStackGestureOptions()` on nested stacks |
| Tab re-tap / no remount | `handleActiveTabRepress`, Maestro `15-tab-retap-and-profile-tabs.yaml` |
| Tab switch from root routes | `router.dismissAll()` before `push` in `TabBar.tsx` |
| Android hardware back on overlays | `useModalHardwareBack` via `overlayParts.ts` |
| Shared TopBar on worlds | `worldStackOptions.ts`, `TopBarStackHeader`, donation world `_layout.tsx` files |
| Publish success vibration | `hapticSuccess()` in `useCreatePostPublish` `onSuccess` only |
| Reduce motion on sheets/buttons | `useReducedMotion` in `overlayParts`, `Buttons`, `TabBar` plus rotation |

---

## 2. Platform guideline table (§4.4.x content)

Implementation slice **858a** copies this table into `docs/spec/17_brand_and_design_system.md`. Values reflect **approved KC policy**, not a full HIG/Material clone.

| Concern | iOS | Android | Web (export) | KC hook |
|---|---|---|---|---|
| Stack push/pop animation | Native stack `default` slide | `slide_from_right` on root; nested uses native slide | Cross-fade 220ms | `rootStackAnimation.ts`, `nestedStackGestureOptions.ts` |
| Interactive back | Edge swipe + back chevron (`MirroredIcon`) | System back + stack pop; predictive back **off** | Browser/history | Gestures in stack options; `BackButton` |
| Modal / sheet dismiss | Backdrop, ✕, swipe down (RN Modal) | + hardware back | Escape | `overlayParts.ts`, `useModalHardwareBack` |
| Tab re-tap | No push on root; pop nested to tab root | Same | Same | `tabPress.ts` |
| Primary haptics | `notificationAsync(Success)` for outcomes; light impact optional for passive tap | `performAndroidHapticsAsync(Context_Click)` for light tap; success notification where used | None | `haptics.ts` (§4) |
| Keyboard avoiding | `KeyboardAvoidingView` `padding` + measured offset on iOS | Window resize / `undefined` behavior where already used | N/A or minimal | `useKeyboardVerticalOffset()` (§3) |
| Date/time pick | Spinner sheet (`DateTimeField`); theme from app palette | System dialogs (date then time) | `<input type=…>` | `DateTimeField.tsx` — unchanged presentation |
| Action menus | Kit `ActionMenuSheet` / `BottomSheet` | Same + hardware back | Same | `ActionMenuSheet.tsx` |
| Pull-to-refresh | Native `RefreshControl`; optional light tap haptic on pull | Same | Same | `KcRefreshControl.tsx` — audit haptic against §4 |
| Reduce motion | Overlays/buttons instant; stack transitions OS default | Same | CSS / instant where implemented | `useReducedMotion` |
| RTL back icon | Chevron mirrored via `MirroredIcon` | Arrow mirrored | Mirrored | spec 17 §4.2 |

---

## 3. Keyboard offset design

### 3.1 Problem

Six screens use a **hardcoded** `keyboardVerticalOffset={88}` (or iOS-only `88`):

- `app/chat/[id].tsx`
- `app/settings/feedback.tsx`, `report-issue.tsx`, `survey/[slug].tsx`, `survey-demo.tsx`

Other forms use `KeyboardAvoidingView` without a shared offset helper (`edit-profile.tsx`, auth/onboarding, `AmountCheckoutForm`, `AuthFormScreen`, `BottomSheet`, etc.). FR-RESP-006 AC5/AC10 requires **`useKeyboardVerticalOffset()`** — **not yet implemented**.

### 3.2 Component: `useKeyboardVerticalOffset`

**Location (implementation):** `app/apps/mobile/src/lib/platform/useKeyboardVerticalOffset.ts` (or `src/navigation/` if collocated with shell helpers).

**API:**

```ts
type KeyboardOffsetMode =
  | { kind: 'nativeStack' }           // Expo Router stack with headerShown: true
  | { kind: 'customHeader'; height: number }  // In-screen header; height excludes top safe area if header view already includes it
  | { kind: 'none' };                 // Android when window resize handles inset; web

function useKeyboardVerticalOffset(mode: KeyboardOffsetMode): number;
```

**Rules (avoid double-counting):**

1. **iOS + `nativeStack`:** Use `useHeaderHeight()` from `@react-navigation/elements` when the screen registers a visible native stack header (`detailStackScreenOptions`, settings child routes, etc.). **Do not add** `useSafeAreaInsets().top` if the keyboard-avoiding view sits **below** a native header that already consumes the status-bar inset (standard Expo Router layout). If a screen wraps content in `SafeAreaView` with `edges={['top']}` **and** shows a native header, pass `kind: 'none'` or a documented override after manual check — native header wins.
2. **iOS + `customHeader`:** Use **`kind: 'customHeader'`** with height = **laid-out header height** below the status bar. For chat, measure `ChatConversationHeader` (min row 44pt + hairline; status bar handled by header placement). Prefer **`onLayout`** on the header container exporting height to context, or a shared constant updated from one measurement test. **Do not** call `useHeaderHeight()` for chat — `headerShown: false` on `chat/[id]`.
3. **Android:** Return **`0`** from the hook for stack and chat patterns already using `behavior={undefined}` or `height` where resize applies. Do not introduce offsets that fight `windowSoftInputMode` / Expo resize behavior.
4. **Web:** Return `0`.

**Call-site mapping (implementation checklist):**

| Screen | Mode | Notes |
|---|---|---|
| `chat/[id].tsx` | `customHeader` | Replace `88`; verify composer clears keyboard on SE + Pro Max |
| Settings feedback / report-issue / surveys | `nativeStack` | Uses `useDetailStackScreenOptions()` |
| `edit-profile.tsx` | Confirm native header + mode | Add offset only if KAV remains on iOS |
| Auth / onboarding | Audit in PR | Only change if currently mis-inset; no drive-by refactors |

**Non-goals:** Wrapping the app in a third-party keyboard provider; changing `BottomSheet` keyboard lift on iOS.

### 3.3 Data / error flow

Keyboard offset is **derived state** only. No network or persistence. Failure to read header height falls back to last known `customHeader` constant for chat (dev-only warning), not a user-visible error.

---

## 4. Haptics design

### 4.1 Central gate

Extend `app/apps/mobile/src/lib/haptics.ts` as the **only** module that imports `expo-haptics` (migrate `Buttons.tsx`, `PressableScale`, and other direct imports).

**Exported semantics:**

| Function | When | iOS | Android |
|---|---|---|---|
| `hapticOutcomeSuccess()` | Confirmed successful **outcome** (publish, handoff complete, mark delivered, registration confirmed) | `notificationAsync(Success)` | Same |
| `hapticAffirmationTap()` | Optional light tap on **non-outcome** controls (filter chip, refresh) if product keeps them | `impactAsync(Light)` | `performAndroidHapticsAsync(Context_Click)` |

Rename or alias existing `hapticSuccess` / `hapticLightTap` for clarity during migration; **web: no-op** (unchanged).

**System settings:** Rely on `expo-haptics` / OS to no-op when haptics disabled. No KC settings toggle in this epic.

### 4.2 Policy table (outcome vs forbidden)

| User action | Haptic | Condition |
|---|---|---|
| Post **published** | Outcome success | Mutation success only (`useCreatePostPublish`) |
| Handoff / ride booking / event registration / housing action **confirmed** | Outcome success | Server success only (existing success paths) |
| Mark **delivered** / closure owner confirm | Outcome success | Success only |
| Post **reaction set to a new type** (like/support/thanks) | Outcome success | After API success; **not** on toggle-off, **not** on failed request |
| Chat message **reaction added** (new type) | Outcome success | After API success; **not** on remove/toggle-off |
| Chat comment submit | Outcome success | After create success (replace pre-submit tap) |
| Kit `PrimaryButton` press | **None** when action also fires outcome haptic | `haptic={false}` on publish header (already); extend pattern |
| Errors, validation, duplicate press, toggle-off reaction | **None** | |
| Pull-to-refresh | Affirmation tap optional | Audit `KcRefreshControl` — keep or drop per table in §4.4 |

### 4.3 Error flow (reactions example)

```
onPress → if disabled return
→ await API
→ on success: hapticOutcomeSuccess(); update UI
→ on failure: no haptic; revert optimistic UI; show existing toast/error
```

Remove haptics from **optimistic** paths in `PostEngagementSection` and `useChatMessageReactions` (today haptic fires before await).

### 4.4 Interaction with reduce motion

Reduce motion **does not** disable haptics (Apple/Android treat them independently). No change.

---

## 5. Navigation, TopBar, and challenges

### 5.1 Preserve

- Root and nested stack animations and gesture flags as in `nestedStackGestureOptions.ts` / `rootStackAnimation.ts`.
- `predictiveBackGestureEnabled: false` — document in §4.4; no flip in this epic.

### 5.2 TopBar consistency

**Norm:** Donation worlds and hub use `TopBarStackHeader` (#1632) or in-screen `TopBar` on tab roots.

**Challenges world (exception today, closed in implementation):** `app/(tabs)/donations/challenges/_layout.tsx` uses a native title header **without** shared TopBar. Implementation **858b** applies the same `topBarStackHeaderOptions` / pattern as `food`, `housing`, etc., while keeping `WorldLaunchGateByFlag`. This is a **header consistency fix**, not a navigation rewrite.

**Large titles:** Remain **off** for TopBar stacks (`headerLargeTitle: false` in `detailStackScreenOptions`). Allowlist unchanged: only screens that already opt in (e.g. `follow/suggestions.tsx`) may keep large titles; no new large-title surfaces in #858.

---

## 6. Components and file touch map (implementation reference)

| Component / module | Role in #858 |
|---|---|
| `src/lib/haptics.ts` | Central gate + policy |
| `src/lib/platform/useKeyboardVerticalOffset.ts` | New |
| `src/components/ui/Buttons.tsx`, `PressableScale.tsx` | Route haptics through gate; default `haptic={false}` when parent emits outcome |
| `useCreatePostPublish.ts` | Keep outcome haptic on success only |
| `PostEngagementSection.tsx`, `useChatMessageReactions.ts` | Move haptic after success; suppress toggle-off |
| Marketplace handoff/booking hooks | Verify success-only (already mostly correct) |
| `donations/challenges/_layout.tsx` | TopBar alignment |
| `docs/spec/17_brand_and_design_system.md` | §4.4.x table |
| Tests: `haptics.test.ts`, new `useKeyboardVerticalOffset.test.ts`, extend layout test for challenges | §7 |

---

## 7. Automated tests (bounded; not native proof)

Vitest/JSDOM tests **do not** prove gestures, keyboard inset on device, or tactile haptics.

| Test | Asserts |
|---|---|
| `haptics.test.ts` | Policy functions no-op on web; correct expo API per platform; **no call** when policy forbids (new cases for reaction success-only helpers) |
| `useKeyboardVerticalOffset.test.ts` | Mock `useHeaderHeight`, safe area, modes → expected numeric offset; chat `customHeader` does not add safe area twice |
| `topBarStackHeader.test.ts` | Challenges layout includes TopBar header pattern after 858b |
| `tabPress.test.ts`, `TabBar.repress.test.tsx` | **Unchanged**; regression guard for #1633 |
| `nestedStackGestureOptions.test.ts` | **Unchanged** |

Optional: Maestro Android smoke (keyboard focus on chat composer) — records visibility only, not inset correctness. **Not sufficient** for #858 closure.

---

## 8. Native verification matrix and closure gate

### 8.1 What blocks closing #858

All **implementation** slices merged to `dev`, plus **completed checklists** below with evidence links (TestFlight/Play build numbers or CI artifact URLs + notes). Until then, issue stays open and CLA unchecked per project rules.

| Evidence class | Proves | Does **not** prove |
|---|---|---|
| Vitest / Maestro (Android emulator) | Policy wiring, no regressions in tab re-tap | Swipe-back feel, keyboard clearance, haptics |
| iOS Simulator | Layout, swipe-back stack order, keyboard **approximation** | Taptic quality |
| Android Emulator | Back stack, keyboard resize, layout | Haptic quality on all OEMs |
| **Physical iPhone** | Edge swipe, keyboard on chat + forms, **tactile haptics** | — |
| **Physical Android** | Hardware back, keyboard, **tactile haptics** | — |

### 8.2 iOS verification matrix

Run on **Simulator** (minimum) and **physical device** (required for §8.1 haptics rows). Test **Hebrew (RTL)** and **English (LTR)** each.

| ID | Journey | Simulator | Physical |
|---|---|---|---|
| iOS-N1 | Donations → world → detail → edge swipe back one level | Required | Required |
| iOS-N2 | Post detail → switch tab → world → swipe back (no stale root) | Required | Required |
| iOS-N3 | Open kit sheet → dismiss (✕, backdrop); no crash | Required | Spot-check |
| iOS-N4 | Chat: focus composer; keyboard does not cover input/send | Required | Required |
| iOS-N5 | Settings feedback form: lowest field visible while typing | Required | Required |
| iOS-N6 | Publish post → single success haptic; failed publish → none | Optional | **Required** |
| iOS-N7 | Like post reaction (new) → one haptic; toggle off → none | Optional | **Required** |
| iOS-N8 | Handoff confirm success → one haptic; cancel/error → none | Optional | **Required** |
| iOS-N9 | Reduce motion on: sheet opens without slide (existing) | Required | Spot-check |
| iOS-N10 | Challenges world shows TopBar after 858b | Required | Spot-check |

### 8.3 Android verification matrix

| ID | Journey | Emulator | Physical |
|---|---|---|---|
| AND-N1 | Same as iOS-N1/N2 with hardware back | Required | Required |
| AND-N2 | Modal/sheet open → hardware back dismisses | Required | Required |
| AND-N3 | Chat + settings form keyboard clearance | Required | Required |
| AND-N4 | Haptics rows iOS-N6–N8 | Optional | **Required** |
| AND-N5 | RTL back icon mirrored | Required | Spot-check |
| AND-N6 | Predictive back remains off; no regression under gesture nav | Required | Spot-check |

### 8.4 Evidence gaps (current)

This design spec was produced in a **Linux cloud agent** environment **without** iOS Simulator, Android Emulator, or Maestro CLI. **No native verification was performed** for this document. Parent/human QA must execute §8.2–8.3 before issue closure.

---

## 9. Acceptance criteria (mapped to issue #858)

| #858 checklist item | Criterion | Met by spec alone? |
|---|---|---|
| Step 1 — §4.4 platform table | Table merged into spec 17 per §2 | **No** — requires PR 858a |
| Native stack + swipe-back | No regression; audit passes | **Already met** on `dev`; re-verify N1/N2 |
| Large titles where appropriate | Documented allowlist; no expansion | **Policy only** |
| Haptics on publish / delivered / like | §4 policy implemented + physical proof N6–N8 | **No** |
| Keyboard consistency | `useKeyboardVerticalOffset` + six call sites + chat audit | **No** |
| Platform sheets / date pickers | Retained; #1438 spinner theme remains | **Already met** |
| KC TopBar on worlds | Challenges aligned (#1632) | **No** — 858b |
| Tab re-tap | AC23 preserved | **Already met** |
| RTL/LTR | Matrix N5 / iOS-N9 | Re-verify only |
| Android back / edge-to-edge | #859; overlay back | **Already met** |

**Honest status:** Issue #858 is **not** fully met until implementation PRs land and §8 checklists are evidenced.

---

## 10. Implementation slices (ordering only)

For parent planning; **not** a step-by-step implementation plan.

1. **858a** — Docs: spec 17 §4.4.x (from §2).
2. **858b** — Challenges TopBar + nested layout audit.
3. **858c** — Haptics gate + call-site policy (§4).
4. **858d** — `useKeyboardVerticalOffset` + call sites (§3).

Each slice: `pnpm typecheck && pnpm test && pnpm lint` from `app/`; native spot-check from §8 where applicable.

---

## 11. Residual decisions (material only)

1. **Pull-to-refresh haptic** (`KcRefreshControl`): keep light affirmation tap or remove for strict “outcome-only” haptics — default **keep** in §4.4 table unless PM removes in 858c.
2. **Chat header height source:** shared `onLayout` vs fixed constant — default **`onLayout`** with Vitest snapshot of fallback constant.
3. **Auth/onboarding keyboard audit:** fix only if matrix finds overlap; no preemptive refactor in 858d.

---

## 12. Change log

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-11-07 | Initial approved gaps-only design spec (investigation + parent approval). |
