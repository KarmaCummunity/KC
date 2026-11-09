# 2.18 Cross-language UGC Translation

> **Status:** ✅ Phase 0–2 done on KC mobile (posts feed + detail). ✅ **KC smart translation engine (2026-10-16, D-191):** batch-oriented engine on `translate` + `content_translations` with `kcSource` registry, cache poison recovery, and feed batch materialization (migration `0239` for `ride_listing` + `user` biography). Architecture: `docs/SSOT/UGC_TRANSLATION.md`. FR-TRANSLATE-005/006 are retired (D-190). Phases 3–4 (chat opt-in, LRU) ⏳ Planned.

Prefix: `FR-TRANSLATE-*`

---

## Scope

Translate user-generated content into each reader's app UI language so the platform is linguistically accessible to everyone. For KC mobile, the active i18n locale is always the target language; there is no separate translation-language setting. This is **shared infrastructure** — it must stay world-agnostic.

Architecture (see design doc `docs/SSOT/archive/superpowers/specs/2026-06-29-ugc-translation-design.md`): **demand-driven (lazy) materialization** — translate per `(content, field, target_language)` only when a real reader requests it, then cache in Postgres. This supports unlimited target languages while paying for and storing only the few actually demanded per item. Translation never runs on the read path (translate-ahead-of-read; cache hits served inline as ordinary fields). LLM-flash provider behind a Supabase Edge Function holding the API key; provider must be zero-retention / under DPA.

Posts auto-translate. **Chat translation is opt-in (default off)** with a sender-consent gate — a message is sent for translation only if its sender opted in — and is deferred to the last phase.

Non-goals (out of scope):
- Translating app UI strings (handled by react-i18next / locale files, `INFRA-I18N-*`).
- Eager translation of every item into every language.
- Running an LLM synchronously on the reader's request path.

---

## FR-TRANSLATE-001 — Language foundations

**Description.**
Inert language primitives the rest of the system depends on: a validated, normalized BCP-47 `LanguageTag`; and nullable `source_language` plumbing on posts and messages. The `users.preferred_language` column is legacy and unused by KC mobile translation. No translation, LLM, or UI in this phase.

**Source.**
- Design spec: `docs/SSOT/archive/superpowers/specs/2026-06-29-ugc-translation-design.md` §3, §4, §8.
- Plan: `docs/SSOT/archive/superpowers/plans/2026-06-29-ugc-translation-phase-0-foundations.md`.
- Decisions: `D-63` (zero-retention/DPA provider), `D-64` (posts auto / chat opt-in with sender-consent gate).

**Acceptance Criteria.**
- AC1. `createLanguageTag(raw)` (in `@kc/domain`) validates a pragmatic BCP-47 subset (language + optional script + optional region, incl. UN M.49 numeric region), normalizes casing (language lower, script Title, region UPPER), trims whitespace, and throws `ValidationError(field='languageTag')` on empty/malformed input.
- AC2. `resolvePreferredLanguage({ userPreference, deviceLocales, fallback })` is a retained domain primitive; KC mobile translation does not use it.
- AC3. `users.preferred_language` (nullable BCP-47 text) is a legacy column retained for compatibility. It is unused as a translation target and is not written by the app. DB CHECK guards length 2..35.
- AC4. `posts.source_language` + `posts.source_language_confidence` and `messages.source_language` + `messages.source_language_confidence` exist (nullable); confidence constrained to 0..1. Set later by the translate pipeline (Phase 1).
- AC5. The app exposes no setter for `users.preferred_language`; the existing column and read mapping remain for compatibility.
- AC6. KC mobile translation uses the active i18n UI locale as its target, with no device-locale resolver or separate preference.

**Related.** Migration `0207_ugc_translation_language_columns.sql`. Consumed by FR-TRANSLATE-002+ (translation core).

---

## FR-TRANSLATE-002 — Translation core (Phase 1)

> **Status:** ✅ Phase 1a (cache substrate) + ✅ Phase 1b (provider/pipeline) + ✅ Phase 1c (posts read substrate) landed. Mobile rendering of translated fields is Phase 2 (FR-TRANSLATE-003).

**Description.**
Demand-driven materialization for posts. Phase 1a delivers the inert cache substrate the later phases populate and consume: a Postgres cache table keyed per `(content_type, content_id, target_language, field)` with single-flight semantics, the pure domain primitives that model a translation request and decide whether/how to cache, and a cache repository behind an application port. No LLM, Edge Function, read-path change, or UI in 1a.

**Source.**
- Design spec: `docs/SSOT/archive/superpowers/specs/2026-06-29-ugc-translation-design.md` §4 (data model), §7 (single-flight/dedup), §8 (variant-aware keys, short-circuit).
- Plan (1a): `docs/SSOT/archive/superpowers/plans/2026-06-29-ugc-translation-phase-1a-cache-core.md`.
- Decisions: `D-63` (demand-driven cache + zero-retention/DPA provider), `D-64` (posts auto / chat opt-in).

**Acceptance Criteria (Phase 1a — cache core).**
- AC1. `content_translations` table (migration `0208`, extended `0239`) stores one row per `(content_type, content_id, target_language, field)`, enforced by UNIQUE index `content_translations_key_uidx`; CHECKs constrain `content_type ∈ {post,message,ride_listing,user}`, `field ∈ {title,description,body,biography}`, `confidence ∈ [0,1]`.
- AC2. Mutations are service-role only: `anon`/`authenticated` are revoked all and granted table-level `SELECT` only; RLS is enabled with an explicit deny-by-default SELECT policy (`using (false)`) that blocks direct authenticated reads — replaced in Phase 1c by the narrow policy backing the read RPC.
- AC3. Cache self-cleans so no readable translated copy of removed content survives: `BEFORE DELETE` triggers on `posts`/`messages` purge by source PK, and an `AFTER UPDATE OF status` trigger on `posts` purges when status flips to `removed_admin`.
- AC4. Domain primitives in `@kc/domain`: `ContentType`/`TranslationField` literal unions + guards; `TranslationError extends DomainError` (`code='translation'`); `createTranslationRequest` validating content-type/field coupling (posts→title/description, messages→body) and normalizing source/target via `createLanguageTag`.
- AC5. Cache-decision helpers: `normalizeForCache` (whitespace fold, case preserved), `isTranslatable` (empty/emoji-only/url-only/number-only short-circuit), `needsTranslation(source,target)` (true on unknown source or differing base language).
- AC6. `ITranslationCacheRepository` port (`get`, `putIfAbsent`, `deleteForContent`) with a `SupabaseTranslationCacheRepository` adapter; `putIfAbsent` returns `false` on UNIQUE violation (`23505`) — the single-flight loser — and `true` when it inserts.

**Acceptance Criteria (Phase 1b — provider + translate Edge Function).**
- AC7. `supabase/functions/translate` authenticates the caller (JWT) and, before spending a provider call, verifies the caller can `SELECT` the source row under RLS (`posts`/`messages`); returns `403` otherwise.
- AC8. Detection is folded into the translate call (one round-trip returns translated text + detected `source_language` + confidence); emoji/url/number-only/empty input short-circuits to `{status:'skipped'}`, and same-base-language results are not cached.
- AC9. Persist is single-flight: the winner inserts via service-role `INSERT … ON CONFLICT DO NOTHING` (23505 = loser), so concurrent readers of a freshly-viral item share one provider call.
- AC10. The provider is pluggable behind a Deno `TranslationProvider` seam selected by `TRANSLATION_PROVIDER`; the default `GeminiFlashProvider` uses the free tier (`GEMINI_API_KEY`), and swapping to a paid zero-retention/DPA model (D-63/D-65) is env-only.
- AC11. `ITranslationService` (application) + `EdgeFnTranslationService` (infra) expose the pipeline to the app; any failure/skip returns `null` so callers render the original (graceful degradation). Nothing auto-invokes it yet — the posts read path is Phase 1c.

**Acceptance Criteria (Phase 1c — posts read substrate).**
- AC12. Migration `0210` replaces the Phase-1a deny-by-default SELECT policy with `content_translations_select_visible_post`: an authenticated reader may `SELECT` a translation row only when `content_type = 'post'` and the post exists, reusing the posts `is_post_visible_to` RLS via an `EXISTS` subquery (no duplicated visibility logic). Message (chat) translations stay unreadable (Phase 3). Closes TD-58.
- AC13. `get_post_translations(p_post_ids uuid[], p_target_language text)` is a SECURITY INVOKER, STABLE SQL function that returns cached post translations (cache HITS only; misses absent) for the reader's target language, batched by post id in one round-trip. The join through `posts` is filtered by posts RLS first, so translations for invisible posts are unreachable; `execute` is granted to `authenticated`, revoked from `public`/`anon`.
- AC14. `IPostTranslationReader` port (`getForPosts(postIds, targetLanguage)`) + `SupabasePostTranslationReader` adapter call the RPC and map rows to `PostTranslationHit[]`; an empty `postIds` short-circuits without a round-trip.
- AC15. `GetTranslatedPostsUseCase` returns reader hits plus the eligible-but-uncached fields as `misses` (filtering via `isTranslatable` + `needsTranslation`, deduping post ids); `MaterializePostTranslationsUseCase` demand-translates each miss via `ITranslationService`, dropping any `null` (skip/failure) so callers render the original — never throwing on the read path. Mobile rendering of these results is Phase 2.

**Related.** Migrations `0208_content_translations.sql` (Phase 1a) + `0210_content_translations_read.sql` (Phase 1c; Phase 1b adds no migration). Edge Function `supabase/functions/translate`. Phase 1c consumes `ITranslationService` on a cache miss via `MaterializePostTranslationsUseCase`. SQL regression: `supabase/tests/0210_content_translations_read.sql`.

## FR-TRANSLATE-003 — Reader UX (Phase 2, ✅ Done)

> **Status:** ✅ Landed. App-language setting + viewport-gated feed translation + translated post detail with show-original toggle. UGC translations always target the active app UI language; there is no separate translation-language setting. Design: `docs/SSOT/archive/superpowers/specs/2026-07-01-ugc-translation-phase-2-reader-ux-design.md`; plan: `docs/SSOT/archive/superpowers/plans/2026-07-01-ugc-translation-phase-2-reader-ux.md`.

Demand-driven reader UX over the Phase 1 substrate: the app UI language is the reader's target language; the feed translates only the visible window on-demand (source-then-swap); the full post renders translated with a per-post show-original toggle. All failures degrade silently to source text. The `ugc_auto_translation` feature flag remains off.

- AC1. Settings has no separate translation-language picker. The active app i18n locale (`he` or `en`) is always the target language and changing it updates translation reads/materialization reactively. `users.preferred_language` is legacy and unused; its column and read mapping remain. The `ugc_auto_translation` flag remains off.
- AC2. `useReaderLanguage()` returns the active app UI language reactively via the i18n hook.
- AC3. The feed renders a post's translatable fields translated when a cache hit exists for the reader language; posts already in the reader language render unchanged. The feed translates only the fields it renders (title) to bound cost.
- AC4. On a feed cache miss for an eligible field, the card shows the source text with a discreet "translating…" indicator and swaps to the translation once background materialization caches it (no manual action).
- AC5. The full post renders translated fields by default with a discreet "auto-translated" indicator, plus a per-post (non-persisted) "show original / show translation" toggle that is hidden when the post's source language equals the reader language.
- AC6. Any translation failure, skip, or offline miss degrades silently to the source text — no error UI on the read path; the feed remains usable in the source language (session skip-map prevents re-firing resolved skips/failures).
- AC7. Accessibility: translated text carries an auto-translated `accessibilityLabel`; the show-original toggle is a labeled button whose state change is announced to screen readers.
- AC8. `PostWithOwner` exposes `sourceLanguage` and the current-user read exposes `preferredLanguage` (contract change); `toTranslatableFields` derives eligible fields purely and is unit-tested.
- AC9. Feed materialization is driven by `onViewableItemsChanged` with a dwell gate (`itemVisiblePercentThreshold: 60`, `minimumViewTime: 400`); it materializes the settled visible window and never re-requests a `(post, field, lang)` that previously resolved to skip/failure within the session.
- AC10. Editing a post's `title`/`description` purges its cached translations (DB trigger, migration `0216`); the next reader re-materializes the current text.
- AC11. The `translate` Edge Function translates the SELECT-verified source-row field (never client-supplied text) and rejects unsupported target languages server-side.
- AC12. Feed cards render RTL-safe; the source→translation swap causes no scroll shift (the "translating…" indicator is a non-clamped sibling of the clamped text), and per-string base direction is resolved at render time.

## FR-TRANSLATE-004 — Chat translation (Phase 3, ⏳ Planned, last)

Opt-in chat translation (default off) with a sender-consent gate; per-conversation translation; LRU eviction for the chat translation cache. To be detailed before implementation.

## FR-TRANSLATE-005 — Retired (✖)

> **Status:** Retired with the web product it served (D-190). The ID is kept so it is not reused.

## FR-TRANSLATE-006 — Retired (✖)

> **Status:** Retired with the web product it served (D-190). The ID is kept so it is not reused. Still in force for KC: `isAllowedOrigin` (`supabase/functions/_shared/cors.ts`) accepts any loopback Origin and any `*.karma-community.pages.dev` preview host; the same-language short-circuit (`shortcircuit.ts`) and batch fan-out (`translateMany`) power the KC `translate` function — see `docs/SSOT/UGC_TRANSLATION.md`.
