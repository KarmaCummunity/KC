# UGC Translation — Phase 2 Reader UX (Design)

> **Spec:** FR-TRANSLATE-003 (`docs/SSOT/spec/18_translation.md`).
> **Depends on (all landed):** FR-TRANSLATE-001 (language foundations), FR-TRANSLATE-002 (cache + provider + posts read substrate).
> **Prior design:** `docs/SSOT/archive/superpowers/specs/2026-06-29-ugc-translation-design.md` (overall architecture).
> **Status:** Design approved; ready for implementation plan.

---

## 1. Goal

Make posts readable in each reader's preferred language across the surfaces where they browse — **the feed first**, then the full post. A reader who does not understand a post's source language must be able to read it without any manual step. Translation stays demand-driven and cached (Phase 1 substrate); Phase 2 is the mobile rendering + the settings control that drives it.

## 2. Product decisions (locked)

- **D2-A — Where/when: feed + full post (option "B+").** The feed translates the posts in the visible window on demand and caches the result. Cache hits render inline; a miss triggers a background (batched) translation and the field swaps in when ready. This is the only option that keeps the feed readable for *new* posts (a strict cache-hits-only feed would leave never-opened posts in their source language — defeating the goal). Cost stays bounded to one translation per `(post × target-language)` because every result is cached and shared across all readers of that language; we translate only what actually scrolls into view, never the whole corpus.
- **D2-B — Feed miss UX: source + indicator, then gentle swap (option "iii").** While a miss is in flight, the card shows the **source** text plus a small, discreet "translating…" affordance, then swaps to the translation when ready. Chosen over "skeleton" (leaves the card blank) and "silent source-then-swap" (text changes with no explanation).
- **D2-C — Full post: translated by default, per-post "show original" toggle.** The toggle is local to the screen (not persisted). If the post's source language already equals the reader's language, no toggle is shown.
- **D2-D — Transparency:** a discreet "auto-translated" label on a translated full post. Omitted in the feed to avoid clutter.
- **D2-E — Failure / offline:** any translation failure or skip degrades silently to the source text (never an error surfaced to the reader). Offline serves cache hits only; misses stay as source.

## 3. Architecture

Translation is a **read-time overlay** layered on top of the existing feed/post queries — it does not change how posts are fetched. The composition root already exposes `GetTranslatedPostsUseCase` (batched cache read → `{hits, misses}`) and `MaterializePostTranslationsUseCase` (demand-translate misses, `null` on skip/failure). Phase 2 adds: a reader-language hook, a translations overlay hook, presentational wiring, and a settings control.

```
users.preferred_language ──► useReaderLanguage() ──┐
                                                   ▼
feed/post query (PostWithOwner[]) ──► useTranslatedPosts(posts, lang)
        │                                   │  1. GetTranslatedPosts → hits + misses
        │                                   │  2. materialize misses in background (batched)
        │                                   │  3. expose translatedFields(postId) + status
        ▼                                   ▼
   PostCard / PostDetail ──► render translated field OR source(+indicator) OR source(silent)
```

All new UI code lives in `apps/mobile`; all new business logic reuses the existing `@kc/application` use cases. No new domain or infrastructure ports are required (the Phase 1c ports cover reads and materialization).

## 4. Components

### 4.1 `useReaderLanguage()` — mobile hook
- **Responsibility:** resolve the reader's effective output language (a `LanguageTag` string).
- **Behavior:** reads `users.preferred_language` (via the existing user repo / React Query user record) and passes it through `resolveReaderLanguage(userPreference)` (FR-TRANSLATE-001 AC6), which folds in the device locale with an `he` fallback. Returns the resolved tag and is stable across renders for a given `(preference, deviceLocale)`.
- **Depends on:** `resolveReaderLanguage`, the current-user query.

### 4.2 `useTranslatedPosts(posts, readerLanguage)` — mobile hook
- **Responsibility:** given the list of posts currently rendered and the reader language, provide translated fields per post and a per-post status.
- **Behavior:**
  1. **Read:** a React Query keyed `['post-translations', readerLanguage, postIds]` runs `GetTranslatedPostsUseCase` → `{hits, misses}`. `hits` populate a `Map<postId, {title?, description?}>`.
  2. **Materialize:** if `misses.length > 0`, fire `MaterializePostTranslationsUseCase(misses)` as a background effect (one batched invocation per render window, deduped by post id). On completion, invalidate the read query so newly-cached hits flow in — this is the "gentle swap".
  3. **Expose:** `getTranslatedFields(postId) → {title?, description?} | undefined` and `getStatus(postId) → 'hit' | 'translating' | 'source'`. `'translating'` = the post has an eligible miss with an in-flight materialization; `'source'` = no eligible translation (same language, untranslatable, or failed).
- **Guards:** empty `postIds` short-circuits (the use case already avoids a round-trip). Language change re-keys the query (new cache namespace). A miss that materializes to `null` (skip/failure) is not retried in a tight loop — it resolves to `'source'`.
- **Depends on:** `GetTranslatedPostsUseCase`, `MaterializePostTranslationsUseCase`, React Query.

### 4.3 `TranslatableText` — presentational component
- **Responsibility:** render one translatable field (title or description) under the D2-B / D2-E rules.
- **Props:** `source: string`, `translated?: string`, `status: 'hit' | 'translating' | 'source'`, `numberOfLines?`, plus style passthrough.
- **Render:**
  - `hit` → translated text.
  - `translating` → source text + a discreet inline indicator (small "translating…" glyph/label, `he` locale string).
  - `source` → source text, no indicator.
- **Accessibility:** when showing a translated value, expose an `accessibilityLabel` noting it is auto-translated (D2-D); the indicator is not a focus stop.

### 4.4 `PostCard` wiring (feed)
- Replace the raw `post.title` / `post.description` render with `<TranslatableText>` fed by `useTranslatedPosts`. Line clamps (`numberOfLines={2}`) unchanged. No transparency label in the feed (D2-D).

### 4.5 Post detail wiring
- Full title + body render via `TranslatableText`. Add:
  - A discreet **"auto-translated"** label when the shown text is a translation (D2-D).
  - A **"show original" / "show translation"** toggle (D2-C): local `useState`, default translation; hidden when source language == reader language or no translation exists. Toggling flips every translatable field on the screen together.
- **Accessibility:** toggle is `accessibilityRole="button"` with a clear `he` label; the label change is announced.

### 4.6 Settings language picker
- In `settings.tsx`: a "Translation language" row opening a picker of supported target languages (the set the `translate` Edge Function/provider supports; sourced from a single constant so client and server stay in sync).
- Selecting a language calls `IUserRepository.setPreferredLanguage` (FR-TRANSLATE-001 AC5) and invalidates the current-user + `['post-translations', …]` queries so the reader language and all rendered translations refresh.
- Includes a "device default" choice that persists `null` (resolve from device locale at runtime, AC3).

## 5. Data flow (feed miss → readable)

1. Feed query returns `PostWithOwner[]` for the visible window.
2. `useTranslatedPosts` reads the cache in one batched RPC. Post P is a miss.
3. `PostCard` for P shows source + "translating…" (status `translating`).
4. Background materialization translates P (one provider call, cached, single-flight per Phase 1b/1c).
5. Read query invalidated → P is now a hit → card swaps to the translated field.
6. Any later reader of P in the same language gets an immediate cache hit (no provider call).

## 6. Error handling

- Materialization never throws on the read path (Phase 1c AC15 guarantee); `null` results resolve to status `'source'`.
- Read RPC failure → hook returns no hits; all posts render as `'source'` (feed stays usable in the source language).
- Offline → React Query serves the persisted translation cache (hits only); misses stay source; no error UI.
- Settings write failure → surfaced as a toast/alert via the adapter's prefixed error; the previous preference is retained.

## 7. Testing

- **Domain/application:** already covered by Phase 1 tests; no new use cases. Add a unit test for any new pure helper (e.g. a `supportedTargetLanguages` guard or a status-derivation function) with happy path + one boundary (empty/unknown language).
- **Hooks:** `useTranslatedPosts` — hits render translated; a miss yields `'translating'` then swaps to `'hit'` after materialization; `null` materialization yields `'source'`; language change re-keys. `useReaderLanguage` — explicit preference wins; `null` falls back to device then `he`.
- **Component:** `TranslatableText` renders each of the three statuses correctly, including the indicator only in `translating`.
- **Manual (RN-Web + device):** load the feed in a non-source language, confirm source-then-swap; open a post, toggle show-original; change settings language and confirm feed + post refresh; airplane-mode a cached vs uncached post.

## 8. Scope / non-goals

- No chat translation (Phase 3, FR-TRANSLATE-004).
- No eager/whole-corpus translation; only the visible window materializes.
- No new provider/model work; reuses the `translate` Edge Function untouched.
- No change to post fetching, ranking, or the feed query shape.

## 9. Acceptance Criteria (for the spec)

- **AC1.** Settings exposes a translation-language picker listing the supported target languages plus a "device default" option; selecting persists `users.preferred_language` (or `null` for device default) via `setPreferredLanguage`, and refreshes the reader language + rendered translations.
- **AC2.** `useReaderLanguage()` resolves the effective language from the persisted preference, else device locale, else `he` (reusing `resolveReaderLanguage`).
- **AC3.** The feed renders each post's title/description translated when a cache hit exists for the reader language; posts already in the reader language render unchanged.
- **AC4.** On a feed cache miss for an eligible field, the card shows the source text with a discreet "translating…" indicator and swaps to the translation once background materialization caches it (no manual action).
- **AC5.** The full post renders translated fields by default with a discreet "auto-translated" indicator, and a per-post (non-persisted) "show original / show translation" toggle that is hidden when the post's source language equals the reader language.
- **AC6.** Any translation failure, skip, or offline miss degrades silently to the source text — no error UI on the read path; the feed remains usable in the source language.
- **AC7.** Accessibility: translated text carries an auto-translated `accessibilityLabel`; the show-original toggle is a labeled button whose state change is announced to screen readers.

---

## 10. Revision 1 — council review incorporated (2026-07-01)

A 7-lens design council reviewed §1–§9 and confirmed the direction and locked decisions are sound. The following concrete amendments close the gaps it found. They are binding on the implementation plan.

### 10.1 Contract prerequisite (P0 — blocks everything)
The current entities/queries do not expose what the reader layer needs. Before any UI work, ship a `(contract)`-scoped change:
- Add `sourceLanguage: string | null` to the `PostWithOwner` (and underlying post) shape, populated by the feed read RPC and single-post read. Without it the client cannot tell which posts need translation, and D2-C ("hide toggle when source == reader language") is unimplementable.
- Expose `preferredLanguage: string | null` on the current-user read (and `IUserRepository.findById`) so `useReaderLanguage()` (AC2) has its input.
- Add a pure helper `toTranslatableFields(post): TranslatablePostField[]` deriving the eligible fields from the post + its source language (reused by feed and detail).

### 10.2 Materialization is batched and viewport-gated (P0)
- **Batch endpoint:** the `translate` Edge Function (or a thin batch wrapper) accepts N `(postId, field)` items in one call so a feed window is one round-trip, not one call per field. `MaterializePostTranslationsUseCase` sends one batched request per settled window instead of looping `translateOne`.
- **Viewport + dwell gate:** translation targets only the *actually visible* posts via the feed `FlatList` `onViewableItemsChanged` (not `pages.flatMap` of all loaded posts), and only after a dwell threshold (~400 ms visible) so fast scrolling does not fire translations for posts that flash by.
- **Per-session ceiling:** a soft cap on materialization calls per session guards against runaway cost; beyond it, misses render as source until reset.

### 10.3 No re-fire, no stale, no poisoning (P0/P1)
- **Session skip-map (P1):** the client keeps an in-memory `Set` of `(postId, field, lang)` that resolved to skip/failure/`null`, so they are not re-requested on every re-render (prevents feed flashing and wasted calls).
- **Stale-on-edit purge (P0, backend):** add a `BEFORE UPDATE OF title, description` trigger on `posts` that purges the affected `content_translations` rows, so an edited post is re-translated rather than serving the old translation forever. (Phase 1a only purged on delete/moderation.) Ships as a migration in this phase.
- **Translate the real source row, never client text (P1, security):** the Edge Function translates the field read from the source row it already SELECT-verifies (Phase 1b AC7) — it must not translate client-supplied text, which would let a client poison the shared cache for all readers.
- **Server-side language allow-list (P1):** the supported target-language set is validated server-side (Edge Function), not only in the client picker; an unsupported tag is rejected, not translated.

### 10.4 RTL, swap, and accessibility (P0/P1)
- **Direction-aware text (P0):** text alignment/base direction is computed per rendered string (source vs translation may differ in direction — e.g. English source → Hebrew translation, or "show original" of an LTR source inside the RTL card), not fixed at module load. Use bidi isolation for mixed-direction content.
- **Reflow-free swap (P1):** the source→translation swap happens at the card level with a reserved `minHeight` so the swap does not shift scroll position; the "translating…" indicator is a sibling, not inline in the clamped text.
- **Screen-reader-safe (P1):** no aggressive live region on swap (it would interrupt reading); translated text exposes an auto-translated `accessibilityLabel`; the toggle is a ≥44×44 target with a politely-announced state change; the indicator has sufficient contrast and is not a focus stop.

### 10.5 Amended / added Acceptance Criteria
- **AC8.** `PostWithOwner` and the current-user read expose `sourceLanguage` and `preferredLanguage` respectively (contract change); `toTranslatableFields` derives eligible fields purely and is unit-tested.
- **AC9.** Feed materialization is driven by `onViewableItemsChanged` with a dwell gate and a per-session ceiling; it issues one batched translate request per settled window, and never re-requests a `(post, field, lang)` that previously resolved to skip/failure within the session.
- **AC10.** Editing a post's `title`/`description` purges its cached translations (DB trigger); the next reader re-materializes the current text.
- **AC11.** The `translate` Edge Function translates the SELECT-verified source-row field (never client-supplied text) and rejects unsupported target languages server-side.
- **AC12.** Feed cards render with a reserved `minHeight`; the source→translation swap causes no scroll shift, and per-string base direction is resolved at render time (RTL-safe), with the "translating…" indicator as a non-clamped sibling.
