# ADR-005 — Library evaluation matrix

- **Status:** Accepted (2026-11-11; "to verify" items resolved from npm registry metadata on that date) · records library evaluation matrix, core mobile dependency selections, and dependabot grouping policy
- **Issue:** KC#1024
- **Related:** [ADR-001 client state](./ADR-001-client-state.md), [ADR-002 data layer](./ADR-002-data-layer.md), [ADR-003 realtime](./ADR-003-realtime.md), KC#896 (virtualized list wrapper), KC#1211 (FlatList migration fixing Android release build), KC#1276 (Expo SDK bump line)

## Context

Karma Community (`apps/mobile`) targets iOS, Android, and Web (`expo export --platform web`) from a single codebase on Expo SDK 54 (`expo ~54.0.38`, React Native `0.81.5`, React `19.1.0`) with Hebrew RTL layout forced app-wide. The app enforces clean architecture boundaries (`packages/{domain,application,infrastructure-supabase,ui}` and `apps/mobile` composition root), file line caps (≤ 300 LOC), and bundle budgets (`app/perf-budgets.json`: `mobileWebMainBundleGzipKb: 4200`).

Without an explicit evaluation matrix, dependency choices risk fragmenting between screens, regressing Android or iOS New Architecture builds, degrading bundle size, or breaking RTL layout. Furthermore, uncoordinated automated dependency bumps (e.g. KC#1276, where lone major bumps of `expo-*` packages pulled mismatched SDK releases) have repeatedly broken CI.

This ADR evaluates seven core library categories:
1. Navigation (`expo-router` vs `react-navigation`)
2. Forms and validation (`react-hook-form` + `zod` vs current approach)
3. Maps (`react-native-maps` vs `Mapbox`)
4. Media (`expo-image`, `expo-video`)
5. Animation (`react-native-reanimated`, `moti`)
6. i18n (`i18next`)
7. Lists (`FlashList`)

For each category, this document records what the repository uses today, verified package metadata, Expo SDK 54 compatibility, RTL readiness, maintenance status, approximate bundle impact, and an architectural recommendation. Any unverified property outside package metadata is explicitly marked as "to verify". Finally, a proposed Dependabot grouping configuration is specified as text.

---

## Evaluation Matrix Summary

| Category | Candidate / Options | What repo uses today | License | Expo SDK 54 / RN 0.81 status | RTL support | Approx bundle impact | Recommendation |
|---|---|---|---|---|---|---|---|
| **1. Navigation** | `expo-router` vs `react-navigation` | `expo-router ~6.0.24` (wraps `@react-navigation/*` v7) | MIT (verified) | Native to SDK 54 (verified) | Full RTL via RN `I18nManager` | ~80–120 KB JS gzip (already included) | **Keep `expo-router` v6**; direct `react-navigation` adds boilerplate with no benefit |
| **2. Forms & Validation** | `react-hook-form` + `zod` vs current approach | Hand-rolled `useState` / custom hooks + `@kc/ui` inputs + domain gate functions | Current: in-house; `zod`: MIT (verified); `react-hook-form`: MIT (verified, npm 7.92.0) | Current: 100% compatible; RHF peers `react ^16.8 \|\| ... \|\| ^19` (verified), Zod 4.6.7 has no native code or peers (verified) | Handled by `@kc/ui` `TextField` / `TextInput` | Current: 0 KB; RHF: ~9–10 KB gzip; Zod: ~13–15 KB gzip | **Keep current approach for MVP**; consider RHF + Zod only for complex multi-step forms |
| **3. Maps** | `react-native-maps` vs `Mapbox` | `react-native-maps 1.29.11` (native) + `leaflet 1.9.4` (web) behind `<KcMap>` | `react-native-maps`: MIT; `leaflet`: BSD-2-Clause (verified); Mapbox: proprietary SDK / MIT wrapper | Native / Web split verified in SDK 54; Mapbox `@rnmapbox/maps` 10.3.18 peers `expo >=47`, `react-native >=0.79` (verified; not built in this repo) | Native maps inherit OS RTL; Leaflet via CSS; Mapbox needs RTL plugin | RN Maps: ~50–70 KB JS; Leaflet: ~40 KB JS; Mapbox: +15–25 MB native binary | **Keep `react-native-maps` (native) + `leaflet` (web)**; avoid Mapbox tokens and binary bloat |
| **4. Media** | `expo-image`, `expo-video` | `expo-image ~3.0.11` via `<KCImage>`; video not installed | `expo-image`: MIT (verified); `expo-video`: MIT (verified) | `expo-image`: native to SDK 54; `expo-video`: SDK 54 line is `3.0.x` (latest `3.0.16`, verified on npm) | Image: full RTL; Video: native playback controls mirror | `expo-image`: ~15 KB JS gzip (native in Expo); `expo-video`: ~20 KB JS gzip | **Keep `expo-image` via `<KCImage>`**; adopt `expo-video` if video is required; avoid `expo-av` |
| **5. Animation** | `react-native-reanimated`, `moti` | `react-native-reanimated ~4.1.7` + `react-native-worklets 0.5.1` via `<MotionEntry>` & tokens | `react-native-reanimated`: MIT (verified); `moti`: MIT (verified, npm 0.30.0) | Reanimated 4 native to SDK 54; Moti peers only `react-native-reanimated: *` (verified), but it is not built in this repo and adds a layer over `<MotionEntry>` | Full RTL transforms and transitions | Reanimated: ~100–120 KB JS gzip (included); Moti: +15–20 KB JS gzip | **Keep `react-native-reanimated` directly**; reject `moti` (avoids React 19 / Reanimated 4 friction) |
| **6. i18n** | `i18next` | `i18next ^23.16.0` (23.16.8) + `react-i18next ^15.1.0` (15.7.4) + `expo-localization ~17.0.8` | `i18next`: MIT; `react-i18next`: MIT (verified) | 100% compatible with SDK 54 / React 19 (verified) | First-class Hebrew RTL primary, English secondary | ~15–20 KB JS gzip | **Keep `i18next` + `react-i18next`**; standard, type-safe, CI-guarded |
| **7. Lists** | `FlashList` vs `FlatList` | `<KcFlashList>` wrapping RN `FlatList` (`@shopify/flash-list` removed in #1211) | `FlatList`: MIT (verified); `FlashList`: MIT (verified, npm 2.3.3) | `FlatList`: 100% compatible; FlashList v1: broken on RN 0.81 (verified); v2 (2.3.3) peers `react`/`react-native: *` but has not been built or benchmarked in this repo | Full RTL supported | FlatList: 0 KB extra; FlashList: +30–40 KB JS gzip + native views | **Keep `<KcFlashList>` backed by `FlatList`**; defer `@shopify/flash-list` until a v2 benchmark in this repo proves a gain |

---

## Category Evaluations

### 1. Navigation: `expo-router` vs `react-navigation`

- **What the repo uses today:**
  - `app/apps/mobile/package.json` specifies `"expo-router": "~6.0.24"` as a direct dependency.
  - The application entry point is `"main": "expo-router/entry"`.
  - Over 80 files in `app/apps/mobile/` import directly from `'expo-router'` (`Stack`, `Tabs`, `useRouter`, `router`, `useLocalSearchParams`, `useSegments`, `usePathname`, `Redirect`, `Href`).
  - Typed routes are verified and generated via `scripts/generate-typed-routes.mjs`.
  - Standalone `@react-navigation/*` is not a direct dependency in `package.json` and has zero imports in application code. However, package metadata in `node_modules` verifies that `expo-router@6.0.23` directly depends on `@react-navigation/native` (7.2.2), `@react-navigation/native-stack` (7.3.16), and `@react-navigation/bottom-tabs` (7.4.0).
- **Expo SDK compatibility:**
  - `expo-router ~6.0.24` is the official routing library engineered for Expo SDK 54 (`~54.0.38`), React Native 0.81.5, and React 19.1.0.
  - Bare `react-navigation` v7 is compatible with Expo SDK 54, but discarding `expo-router` would break file-based routing conventions and deep linking automation.
- **RTL support:**
  - Supported natively: Expo Router respects React Native's `I18nManager.isRTL`. Headers, tabs, and screen slide transitions adapt to Hebrew RTL direction.
- **License:**
  - `expo-router`: MIT (verified from `node_modules/expo-router/package.json`).
  - `@react-navigation/native`: MIT (verified from `node_modules/@react-navigation/native/package.json`).
- **Maintenance status:**
  - Exceptionally active: Maintained directly by the Expo core team as the default navigation framework for modern Expo applications.
- **Approximate bundle impact:**
  - ~80–120 KB JS gzipped (inclusive of underlying React Navigation primitives). Switching to standalone React Navigation would save only ~15–25 KB gzipped (the file router runtime) while forfeiting automated web routing, deep link mapping, and typed routes.
- **Recommendation:**
  - **Retain `expo-router` v6.** It is deeply integrated into the codebase, powers both native navigation and web export URLs, and wraps React Navigation v7 natively.

---

### 2. Forms and Validation: `react-hook-form` + `zod` vs Current Approach

- **What the repo uses today:**
  - Hand-rolled form state via React `useState` and custom composition hooks (e.g., `useCreatePostFormState`, `useOnboardingBasicInfoFlow`, `useAddressStateWithCityReset`).
  - Controlled inputs use `@kc/ui` primitives (`TextInput`, `TextField`).
  - Validation is procedural using domain-specific helper functions (e.g. `getProfileAddressPairIssue`, `hasRequiredFields`, regex patterns, and domain invariant checks).
  - Draft state persistence is managed via custom hooks and Zustand (`usePostDraftStore`).
  - Neither `react-hook-form` nor runtime `zod` is listed in `app/apps/mobile/package.json`.
  - `zod@4: ^4.6.6` is listed under `pnpm.overrides` in `app/package.json` and resolves to `zod@4.6.7` (MIT) as a transitive devDependency of `hermes-parser` / ESLint tooling.
- **Expo SDK compatibility:**
  - Current approach: 100% compatible (pure React 19 state).
  - `react-hook-form`: Headless JS library. Peer range (npm 7.92.0) accepts React 19 and declares no `react-native` peer (verified), so it is compatible on paper; it is not installed in this repo.
  - `zod`: Pure TypeScript/JavaScript library with zero native dependencies. Version 4.6.7 is already in the lockfile as a transitive tooling dependency and has no native code and no peers (verified); runtime use in the app bundle is not exercised today.
- **RTL support:**
  - Current approach: Full RTL support handled at the `@kc/ui` input component layer (`TextField`, right-aligned text for Hebrew, explicit physical alignment in `hebrewSurveyFieldStyle.ts`).
  - `react-hook-form` + `zod`: Headless; RTL layout is completely delegated to the rendered input components. Localized validation messages are supported through `useTranslation` (`t('...')`).
- **License:**
  - Current approach: Internal project code.
  - `react-hook-form`: MIT (verified from npm package metadata; not in `node_modules`).
  - `zod`: MIT (verified from `node_modules/zod/package.json`).
- **Maintenance status:**
  - Current approach: Maintained internally; low risk of external breaking changes.
  - `react-hook-form`: Actively maintained, industry standard for React form state.
  - `zod`: Actively maintained, dominant TypeScript schema validation library.
- **Approximate bundle impact:**
  - Current approach: 0 KB additional dependencies.
  - `react-hook-form`: ~9–10 KB JS gzipped.
  - `zod`: ~13–15 KB JS gzipped (tree-shakeable based on schema operators used).
  - Combined impact: ~23–25 KB JS gzipped.
- **Recommendation:**
  - **Maintain the current approach for MVP.** Custom form state hooks (such as `useCreatePostFormState`) successfully isolate form logic and keep screen files below the 300-line architecture cap (`pnpm lint:arch`).
  - **Post-MVP evaluation:** If future modules require complex, multi-step dynamic forms with conditional schemas (e.g., enterprise organization registration or finance ledgers), evaluate introducing `react-hook-form` with `@hookform/resolvers` and `zod`. Do not add them until an explicit FR necessitates declarative schema validation.

---

### 3. Maps: `react-native-maps` vs `Mapbox`

- **What the repo uses today:**
  - Architecture uses an explicit platform split under `<KcMap>`:
    - Native (iOS & Android): `react-native-maps` (`1.29.11`, MIT) imported in `app/apps/mobile/src/components/map/KcMap.native.tsx` (`MapView`, `Marker`, `Polyline`, `Region`). On iOS it defaults to system Apple Maps (MapKit); on Android it renders Google Maps.
    - Web export: `leaflet` (`1.9.4`, BSD-2-Clause) imported in `app/apps/mobile/src/components/map/KcMap.web.tsx` using OpenStreetMap tiles (`tile.openstreetmap.org`), because `react-native-maps` does not support React Native Web.
  - Map features include clustered pins, debounced region change gates (`regionChangeGate.ts`), and polyline routes for rides.
  - Mapbox (`@rnmapbox/maps`): Not installed or imported anywhere in the monorepo.
- **Expo SDK compatibility:**
  - `react-native-maps`: Version 1.29.11 is installed and verified compatible with Expo SDK 54 (`~54.0.38`) via Expo dev-client and native prebuild.
  - `leaflet`: Version 1.9.4 is a pure DOM web mapping library, verified compatible with Expo Web export (`pnpm build:web`).
  - `Mapbox` (`@rnmapbox/maps`): Requires native config plugin and native build. Version 10.3.18 declares peers `expo >=47` and `react-native >=0.79` (verified from npm metadata); it was not built in this repo, and the RTL text plugin and native binary cost below already rule it out.
- **RTL support:**
  - `react-native-maps`: Inherits native OS mapping controls. Markers, callouts, and cluster labels render localized Hebrew text cleanly.
  - `leaflet`: Full RTL support via CSS and Leaflet control positioning.
  - `Mapbox`: Requires loading the external `@mapbox/mapbox-gl-rtl-text` plugin at runtime for Arabic/Hebrew bidirectional text shaping on vector tiles.
- **License:**
  - `react-native-maps`: MIT (verified from `node_modules/react-native-maps/package.json`).
  - `leaflet`: BSD-2-Clause (verified from `node_modules/leaflet/package.json`).
  - `Mapbox` (`@rnmapbox/maps`): React Native wrapper is MIT, but Mapbox GL native SDK and tile endpoints require a proprietary commercial Mapbox account, API access token, and pay-as-you-go telemetry/pricing. Open-source alternative MapLibre (`@maplibre/maplibre-react-native`): **to verify**.
- **Maintenance status:**
  - `react-native-maps`: Actively maintained by community maintainers under `react-native-maps`.
  - `leaflet`: Highly stable, mature web standard.
  - `Mapbox`: Actively maintained by Mapbox.
- **Approximate bundle impact:**
  - `react-native-maps`: ~50–70 KB JS gzipped. Native binary size: 0 MB extra on iOS (leverages built-in MapKit framework); ~3–5 MB on Android (Google Play Services Maps SDK).
  - `leaflet`: ~40 KB JS gzipped + ~5 KB CSS (loaded only on web export).
  - `Mapbox`: Adds ~15–25 MB uncompressed native binary per architecture for the C++ vector rendering engine, plus ~80–120 KB JS.
- **Recommendation:**
  - **Keep `react-native-maps` (native) + `leaflet` (web).** This architecture leverages native platform capabilities with zero licensing costs, requires no external Mapbox API tokens (avoiding secret exposure risks per AGENTS.md §7), adds zero native binary bloat on iOS, and delivers full feature parity (marketplace clusters and ride routes).

---

### 4. Media: `expo-image` vs `expo-video`

- **What the repo uses today:**
  - Remote and local image rendering is strictly standardized through `<KCImage>` (`app/apps/mobile/src/components/ui/KCImage.tsx`), which wraps `expo-image` (`~3.0.11`, MIT). Direct use of React Native's `<Image>` is prohibited.
  - Features implemented in `<KCImage>`: Blurhash placeholder decoding, image prefetching (`imagePrefetch.ts`), recycling keys for virtualized lists, disk and memory caching, and graceful degrade (`thumb` URL fallback to full URL).
  - Paired with `expo-image-picker` (`~17.0.11`) and `expo-image-manipulator` (`~14.0.8`) for client-side resizing (max 1024px, JPEG q=85) and Supabase Storage uploads.
  - Video: No video player library is installed. Neither `expo-video` nor legacy `expo-av` is present in `package.json` or imported.
- **Expo SDK compatibility:**
  - `expo-image`: Core module in Expo SDK 54 (`~3.0.11`), fully certified.
  - `expo-video`: Official video player module introduced to replace `expo-av`. Supported in Expo SDK 54 (the SDK 54 line is `expo-video ~3.0.x`; latest `3.0.16`, verified on npm).
- **RTL support:**
  - `expo-image`: Fully supports RTL layouts. Does not mirror raster images unintentionally.
  - `expo-video`: Native player controls (AVPlayer on iOS, ExoPlayer on Android) and custom playback progress bars respect RTL layout directions.
- **License:**
  - `expo-image`: MIT (verified from `node_modules/expo-image/package.json`).
  - `expo-video`: MIT (verified from npm package metadata; official Expo module).
- **Maintenance status:**
  - `expo-image`: Flagship Expo library, actively developed and optimized with native SDWebImage (iOS) and Glide (Android) integrations.
  - `expo-video`: Actively maintained by Expo as the modern replacement for deprecated video components in `expo-av`.
- **Approximate bundle impact:**
  - `expo-image`: ~15 KB JS gzipped (native binaries are part of the standard Expo client runtime).
  - `expo-video`: ~20 KB JS gzipped; adds AndroidX Media3 / ExoPlayer on Android and AVKit on iOS.
- **Recommendation:**
  - **Continue standardizing on `expo-image` via `<KCImage>`.**
  - **Video policy:** Defer video library installation until a specified product requirement (e.g. video attachments or promotional reels) is prioritized. If video playback is introduced, adopt `expo-video` (pinned to Expo SDK 54); never introduce the deprecated `expo-av`.

---

### 5. Animation: `react-native-reanimated` vs `moti`

- **What the repo uses today:**
  - `react-native-reanimated` (`~4.1.7`, MIT) and `react-native-worklets` (`0.5.1`) are direct dependencies in `app/apps/mobile/package.json`.
  - Configured in `app/apps/mobile/babel.config.js` with `'react-native-reanimated/plugin'`.
  - Widely imported across components: `AmbientBlobs`, `Buttons`, `MotionEntry`, `PressableScale`, `TourSlidePager`, `AnimatedAuthInput`, and auth forms.
  - Centralized design tokens: `MOTION` constants in `app/apps/mobile/src/lib/animations/motion.ts` and `EASINGS` in `motion-easings.ts`.
  - Accessibility: `useReducedMotion` (`app/apps/mobile/src/hooks/useReducedMotion.ts`) checks system accessibility preferences and zeroes animation durations and distances (`applyReducedMotion`).
  - `moti`: Not installed or imported anywhere in the monorepo.
- **Expo SDK compatibility:**
  - `react-native-reanimated ~4.1.7`: Verified compatible with Expo SDK 54, React Native 0.81.5, and the New Architecture.
  - `moti`: Compatibility with Reanimated 4 and React 19: Moti 0.30.0 declares only `react-native-reanimated: *` as a peer (verified), so the peer range does not block it; whether it runs cleanly on Reanimated 4 was not tested in this repo. It stays rejected because `<MotionEntry>` and tokens already cover the app's animation needs.
- **RTL support:**
  - `react-native-reanimated`: Full RTL support. Transform animations (translations, scales, fades) operate seamlessly with RTL layouts.
  - `moti`: Inherits Reanimated's layout and style capabilities.
- **License:**
  - `react-native-reanimated`: MIT (verified from `node_modules/react-native-reanimated/package.json`).
  - `moti`: MIT (verified from npm package metadata).
- **Maintenance status:**
  - `react-native-reanimated`: Maintained with high velocity by Software Mansion.
  - `moti`: Community maintained by Fernando Rojo; slower release cadence relative to major React / Reanimated releases.
- **Approximate bundle impact:**
  - `react-native-reanimated`: ~100–120 KB JS gzipped + native C++ worklets engine (already integrated into the build).
  - `moti`: Would add ~15–20 KB JS gzipped on top of Reanimated.
- **Recommendation:**
  - **Stick exclusively to direct `react-native-reanimated`** via `<MotionEntry>` and the `MOTION` token system. Reject `moti`. Direct Reanimated ensures high-performance 60/120fps UI thread animations, avoids compatibility risks with Reanimated 4 / React 19, and honors accessibility standards through `useReducedMotion`.

---

### 6. i18n: `i18next`

- **What the repo uses today:**
  - `i18next` (`^23.16.0`, resolved to `23.16.8`, MIT) and `react-i18next` (`^15.1.0`, resolved to `15.7.4`, MIT) in `app/apps/mobile/package.json`.
  - Paired with `expo-localization` (`~17.0.8`) for device locale detection.
  - Configured in `app/apps/mobile/src/i18n/index.ts`:
    - Resources: Hebrew (`he`) and English (`en`).
    - Hebrew is forced RTL (`I18nManager.forceRTL(true)`) and serves as the primary fallback (`fallbackLng: 'he'`).
    - English is supported per FR-SETTINGS-018.
  - Static guards: `scripts/extract-hebrew-text.mjs --check` and `copyVoiceRules.test.ts` prevent hardcoded strings in code and enforce tone rules.
- **Expo SDK compatibility:**
  - 100% pure JavaScript libraries; fully compatible with Expo SDK 54, React Native 0.81.5, and React 19.1.0.
  - `expo-localization ~17.0.8` is an official Expo SDK 54 native module.
- **RTL support:**
  - Comprehensive: Hebrew strings and RTL directionality are primary throughout all screens and components. Language switching dynamically updates layout direction and locale bundles.
- **License:**
  - `i18next`: MIT (verified from `node_modules/i18next/package.json`).
  - `react-i18next`: MIT (verified from `node_modules/react-i18next/package.json`).
- **Maintenance status:**
  - Gold standard in the JavaScript and React ecosystems; exceptionally active and stable maintenance.
- **Approximate bundle impact:**
  - `i18next` + `react-i18next`: ~15–20 KB JS gzipped. Translation string modules add payload proportional to copy size.
- **Recommendation:**
  - **Keep `i18next` + `react-i18next`.** It is already cleanly integrated, type-safe, supports pluralization and interpolation, and is guarded by repository integrity checks.

---

### 7. Lists: `FlashList` vs `FlatList`

- **What the repo uses today:**
  - React Native's built-in `FlatList`, wrapped inside `<KcFlashList>` (`app/apps/mobile/src/components/lists/KcFlashList.tsx`).
  - Historical context in repo: `@shopify/flash-list` was previously used, but was intentionally removed in commit `f4b9c524` (#1211) because FlashList v1 mis-measured cells under the React Native New Architecture (Fabric) and its Android native module failed compilation against React Native 0.81 on Expo SDK 54.
  - The `<KcFlashList>` component wraps `FlatList`, accepts (and safely ignores) `estimatedItemSize` to preserve call-site compatibility across 25+ screens, and enforces optimized defaults (`windowSize: 11`, `removeClippedSubviews: false`).
  - `@shopify/flash-list` is neither in `package.json` nor installed in `node_modules`.
- **Expo SDK compatibility:**
  - Current `<KcFlashList>` (`FlatList`): 100% compatible with Expo SDK 54, React Native 0.81.5 New Architecture, and React 19.
  - `@shopify/flash-list`: FlashList v1 is incompatible with RN 0.81 Android release builds (verified by #1211). FlashList v2 (2.3.3 on npm) targets the New Architecture and declares wildcard peers (verified); it was not built or benchmarked against Expo SDK 54 / RN 0.81.5 here, so it stays deferred.
- **RTL support:**
  - `FlatList`: Full, native RTL support out of the box in React Native.
  - `FlashList`: Supports RTL, though cell recycling previously caused layout offset quirks with dynamic-height items in RTL layouts.
- **License:**
  - `FlatList`: MIT (part of `react-native`).
  - `@shopify/flash-list`: MIT (verified from npm package metadata).
- **Maintenance status:**
  - `FlatList`: Maintained directly by Meta as part of React Native core.
  - `@shopify/flash-list`: Maintained by Shopify; active efforts on v2 for New Architecture.
- **Approximate bundle impact:**
  - Current `<KcFlashList>` (`FlatList`): 0 KB extra bundle impact (uses React Native core).
  - `@shopify/flash-list`: Adds ~30–40 KB JS gzipped plus native Android/iOS recycler views.
- **Recommendation:**
  - **Maintain `<KcFlashList>` backed by `FlatList`.** Do not re-install `@shopify/flash-list` until FlashList v2 is officially stable, verified against Expo SDK 54 / React Native 0.81.5 with the New Architecture, and proves measurable frame-rate improvements in benchmarks. Because all list call sites throughout the app use `<KcFlashList>`, any future migration back to FlashList v2 can be achieved inside that single file without modifying any screen components.

---

## Dependabot Grouping Proposal

The repository manages automated dependency updates via `.github/dependabot.yml`. To prevent broken builds caused by uncoordinated major bumps (e.g. KC#1276 where individual `expo-*` major bumps broke CI), the following grouping configuration is proposed for text documentation.

> [!IMPORTANT]
> This section is the recorded grouping policy. The live `.github/dependabot.yml` already implements the Expo, TanStack Query, lint/test and GitHub Actions groups and the semver-major ignores for `expo`, `expo-*`, `@expo/*`, `babel-preset-expo`, `react-native` and `vitest`. Two parts of the policy below are not applied there yet: a `react-native-ecosystem` group (and `react-native-*` major ignore), and `react` / `i18next` groups. Applying them is a CI-config change outside this documentation-only ADR; it is left to a separate CI-config change rather than done inline.

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/app"
    target-branch: "dev"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      # 1. Expo SDK packages: must move together as a single unit on minor/patch.
      # Majors are ignored because the SDK line updates via `npx expo install --fix`.
      expo-sdk:
        patterns:
          - "expo"
          - "expo-*"
          - "@expo/*"
          - "babel-preset-expo"
        update-types: ["minor", "patch"]

      # 2. React Native ecosystem: native modules must remain compatible with RN 0.81.5.
      react-native-ecosystem:
        patterns:
          - "react-native"
          - "react-native-*"
          - "@react-native*"
          - "@react-native-community/*"
        update-types: ["minor", "patch"]

      # 3. React core: pinned to the React 19 line supported by Expo SDK 54.
      react-core:
        patterns:
          - "react"
          - "react-dom"
          - "@types/react"
          - "@types/react-dom"
        update-types: ["patch"]

      # 4. TanStack Query: server cache libraries updated synchronously.
      tanstack-query:
        patterns:
          - "@tanstack/query-*"
          - "@tanstack/react-query*"
        update-types: ["minor", "patch"]

      # 5. Internationalization: i18next core and React bindings kept in lockstep.
      i18n:
        patterns:
          - "i18next"
          - "react-i18next"
        update-types: ["minor", "patch"]

      # 6. Static analysis, testing, and monorepo tooling.
      tooling-lint-test:
        patterns:
          - "eslint"
          - "@eslint/*"
          - "typescript-eslint"
          - "vitest"
          - "@vitest/*"
          - "turbo"
          - "typescript"
        update-types: ["minor", "patch"]

    ignore:
      # Majors for core platform packages must be managed via deliberate upgrade PRs.
      - dependency-name: "expo"
        update-types: ["version-update:semver-major"]
      - dependency-name: "expo-*"
        update-types: ["version-update:semver-major"]
      - dependency-name: "@expo/*"
        update-types: ["version-update:semver-major"]
      - dependency-name: "babel-preset-expo"
        update-types: ["version-update:semver-major"]
      - dependency-name: "react"
        update-types: ["version-update:semver-major"]
      - dependency-name: "react-native"
        update-types: ["version-update:semver-major"]
      - dependency-name: "react-native-*"
        update-types: ["version-update:semver-major"]
      - dependency-name: "vitest"
        update-types: ["version-update:semver-major"]
      - dependency-name: "@vitest/*"
        update-types: ["version-update:semver-major"]
    open-pull-requests-limit: 8

  - package-ecosystem: "github-actions"
    directory: "/"
    target-branch: "dev"
    schedule:
      interval: "monthly"
    groups:
      github-actions:
        patterns: ["*"]
    open-pull-requests-limit: 5
```

---

## Consequences

- **Single source of truth:** Every agent and contributor has clear guidance on which core libraries are approved, what wrappers must be used (`<KCImage>`, `<KcFlashList>`), and which libraries to avoid (e.g. `expo-av`, `moti`, Mapbox).
- **Zero ad-hoc dependency creep:** Prohibits introducing redundant or incompatible libraries without an updated ADR and justification against bundle and architecture limits.
- **RTL and New Architecture safety:** Confirms that current dependencies build cleanly on React Native 0.81 New Architecture and render properly in Hebrew RTL.
- **Predictable Dependabot upgrades:** Documents grouping rules that prevent weekly CI breakage caused by disjointed Expo or React Native package updates.
