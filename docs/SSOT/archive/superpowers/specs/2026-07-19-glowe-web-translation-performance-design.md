# GLOWE Web Translation — Performance, Prefetch & Loading Indicator

> **Design spec.** Enhances the shipped GLOWE web UGC translation (FR-TRANSLATE-005) with an efficiency-first cold-path, viewport-driven prefetch, and a rare, localized loading indicator.
>
> **Maps to spec:** new `FR-TRANSLATE-006` in [`docs/SSOT/spec/18_translation.md`](../../SSOT/spec/18_translation.md).
> **Date:** 2026-07-19 · **Scope:** `app/apps/glowe-web/**` + `supabase/functions/glowe-translate` + `supabase/functions/_shared/translation/**`. KC path untouched.

---

## 1. Goal

Make GLOWE UGC translation feel **effectively instant** while spending the **least possible network and translation-provider calls**. The reader should almost never see a waiting state; when translation is unavoidably cold, a discreet, honest indicator appears — in the reader's interface language.

The guiding objective (PM): *most pleasant experience · least internet · least provider calls = maximum efficiency.* The loading indicator is a fallback we design so that **we almost never reach it**.

## 2. What already exists (unchanged)

The current architecture is sound and is **not** being redesigned. Preserved as-is:

- Progressive enhancement: cards render in source language immediately; a background driver (`js/glowe-translate.js`) swaps in translations and injects a "show original" toggle **only when a translation was applied**.
- **Batched cache read** — `readCache()` already issues a single `.in('content_id', ids)` query per scan. The DB read path is already efficient and is kept.
- Shared, permanent, anon-readable server cache (`glowe_content_translations`); each `(content, field, target)` is translated once, globally, ever.
- Reserved `.tr-slot` under card headers, already `aria-live="polite"`.
- Session skip-map (failures/skips only).
- Provider seam: default `GoogleFreeProvider` (keyless Google translate, one string per request), swappable to Gemini via `TRANSLATION_PROVIDER` (D-63/D-65).
- Names are never translated (FR-GLOWE-024 / D-179 bilingual columns).

## 3. The problem — the cold-miss path only

The weakness is isolated to the **cache-miss path** in `glowe-translate.js` (`scan -> processCard -> resolveField -> translateMiss`):

1. **Sequential misses.** `for (const e of entries) await processCard(...)` and, within a card, `for (const f of entry.fields) { await resolveField(...) }`. A 10-card page (~20 fields) that is cold serializes ~20 client->Edge->provider round-trips (~30s to the last card).
2. **One field per Edge invocation.** `glowe-translate` translates a single field per call, so N misses are N separate round-trips.
3. **No client-side same-language short-circuit.** A Hebrew reader on Hebrew content still fires an Edge call per field; the Edge Function calls the provider, detects `he == he`, returns `skipped`, and discards the result — a wasted provider call per field, repeated on every page navigation.
4. **No prefetch.** Translation begins only *after* the card is painted (MutationObserver + 150ms debounce), never a screen ahead.
5. **No loading feedback.** Nothing renders during the wait; text silently swaps (or never does, if cold and slow).

### Illustrative before/after (10-card page ≈ 20 fields; order-of-magnitude, to be measured on dev)

| Scenario | Today | After |
| --- | --- | --- |
| **Hebrew reader, Hebrew content** (most common) | ~20 Edge + ~20 provider calls, all `skipped` & discarded; repeats per page nav | **0 network, 0 provider calls, instant** (client short-circuit) |
| **Cross-language, cold cache** (first reader) | ~20 sequential Edge round-trips ≈ ~30s | **1 Edge round-trip; provider calls run concurrently server-side ≈ ~1–3s**; visible window starts during fetch |
| **Warm cache** (steady state) | Already fast (1 batched read, sync swap) | Same + zero-network on re-navigation (session cache) |

The wins are concentrated where the current path is broken. The warm path is already good and is left alone.

## 4. Design — a per-field decision ladder

For every translatable field of a card that enters the near-viewport zone, walk the ladder and stop at the first step that resolves. Cheapest first; each step avoids the next.

| Step | Check | Cost | Indicator |
| --- | --- | --- | --- |
| 1. Same language? | Client-side **script detection** (Hebrew block => `he`; no non-Latin letters => `en`) | 0 network | no |
| 2. Session cache? | Translation already resolved this visit (sessionStorage) | 0 network | no |
| 3. DB cache? | Batched `.in('content_id', ids)` read (**existing**) | cheap (DB) | no |
| 4. Genuine miss | Enqueue -> **one Edge round-trip**; provider calls concurrent server-side | 1 round-trip; cached once globally | only if > 400ms |

Most fields stop at 1–3 (no provider call, near-zero network). Step 4 runs only for the first-ever reader of fresh cross-language content — and only then might the indicator appear.

### 4.1 Trigger — viewport prefetch, not post-paint

- **Discovery** (unchanged mechanism): the MutationObserver and existing explicit `GloweTranslate.scan()` callers *register* new `[data-tr-card]` elements — they no longer translate immediately.
- **Scheduling** (new): an `IntersectionObserver` with a lookahead `rootMargin` (~1–2 screens) enqueues a card *before* it reaches the viewport. Cards on the first screen at load qualify immediately.
- **Early start** (new): the registration flush is a `requestAnimationFrame` tick (not a 150ms debounce), so on-screen cards begin resolving as soon as they are inserted — overlapping DOM build and image load.
- **Micro-batch**: near-viewport cards accumulate for a short window (~50ms) and resolve together, so steps 3–4 run once per window, not per card.

### 4.2 Same-language short-circuit (step 1)

Reader language is `getGloweLanguage()` ∈ `{he, en}`. Reuse the existing script-detection pattern (`/[֐-׿؀-ۿЀ-ӿͰ-Ͽ一-鿿]/`, see `js/glowe-localized-name.js`). Rule per field, over its rendered source text:

- reader `he` -> skip iff the text **contains Hebrew letters** (mixed he+en counts as he — correct).
- reader `en` -> skip iff the text contains **no non-Latin letters** (pure Latin => en; Cyrillic/Arabic/CJK/Hebrew => translate).

This is a deliberately safe heuristic: it only *avoids* obviously-unnecessary calls. Anything ambiguous falls through to steps 3–4, where the server remains the source of truth (detect + `skipped`). Worst case of a wrong short-circuit is leaving a rare Latin-only foreign string untranslated for an `en` reader — acceptable. The pure decision function is unit-tested (he / en / mixed / non-Latin / empty).

### 4.3 Session cache (step 2)

A `sessionStorage`-backed map keyed `type|id|field|target` stores resolved translations **and** same-language decisions, so re-renders and — critically for this multi-page static site — **navigation between pages** cost zero network. Bounded (evict oldest past a cap); cleared on interface-language switch. Failures continue to use the existing in-session skip-map.

### 4.4 Batched translation (step 4) — the one backend change

Extend the **existing** `glowe-translate` Edge Function (no new function, no migration, no new table) to accept a batch body while remaining backward-compatible:

```
POST glowe-translate
  legacy:  { contentType, contentId, field, targetLanguage }
  batch:   { targetLanguage, items: [{ contentType, contentId, field }, …] }
  -> { results: [{ contentType, contentId, field, status, translation? }, …] }
```

Server flow:
1. Validate every item against the `SOURCE` allow-list registry (unsupported field/type => per-item `skipped`, never fatal for the batch).
2. **Batched source reads**, grouped by table: one `.in(pk, ids)` per source table (anti-poisoning preserved — text is read from source rows, never from the client).
3. Per item: `isTranslatable` / length / same-base short-circuit; cache lookup (per-key `getCached`).
4. Remaining misses -> provider calls issued **concurrently** via a bounded-concurrency pool, since the default `GoogleFreeProvider` translates one string per request. (A future LLM provider could override with a true single-request array translate; the pool interface keeps that swap local.)
5. Batched upsert (single-flight preserved: `insert … on conflict do nothing` per row; a `23505` loser re-reads the winner's row).
6. Return results index-aligned to the request items.

Efficiency note: batching does not reduce the *count* of provider calls for the default provider — the cache and same-language short-circuit do that. Batching collapses N **client->Edge round-trips into 1** and runs the provider calls concurrently server-side, cutting wall-clock from ~N×latency to ~1×latency.

To satisfy the duplication gate, the `SOURCE` registry + `resolveField` and the bounded-concurrency `translateMany` helper move to `supabase/functions/_shared/translation/` and are imported by `glowe-translate` (and available to `translate`). Batch size is capped (per-request item/char budget); the client chunks larger sets.

### 4.5 Loading indicator (option 1 — delayed, localized, shift-safe)

- A per-field 400ms timer starts when the field enters step 4. Resolved before it fires => nothing renders (warm / same-language / session-cache paths never flash it).
- On fire: a discreet `<span class="tr-pending">` in the reserved `.tr-slot`, text **in the interface language** — reusing the toggle's localization path (English source label "Translating…" + a Hebrew "מתרגם…" entry in `GLOWE_TRANSLATIONS.he`, applied via `translateGloweTree`). `he` reader => "מתרגם…", `en` reader => "Translating…".
- **No layout shift**: source text stays visible and readable; the indicator is a separate line in the slot; it is removed when the translation swaps in. The swap replaces `textContent` in place (mirrors the existing toggle behavior).
- Accessibility: the slot is already `aria-live="polite"`, so the state is announced.

## 5. Non-goals (YAGNI · minimal provider calls)

- No translate-on-publish / background cache warming — would translate content nobody may read. The rare cold-first-screen wait is covered by the indicator instead.
- No eager whole-feed translation.
- No new tables or migrations — reuse `glowe_content_translations`.
- No translating names — unchanged.
- No touching the KC path (`translate`, `content_translations`, `get_post_translations`).

## 6. Acceptance criteria (FR-TRANSLATE-006)

- **AC1 — Same-language short-circuit.** A pure helper decides, from a field's source text + reader language, whether the field is already in the reader's language (Hebrew block => `he`; no non-Latin letters => `en`). When it matches, no network call is made and no indicator renders. Unit-tested for he / en / mixed / non-Latin / empty.
- **AC2 — Session cache.** Resolved translations and same-language decisions are cached in `sessionStorage` keyed `(type,id,field,target)`; a hit applies with zero network, including across page navigations; the cache is bounded and cleared on interface-language switch.
- **AC3 — Batched DB read (preserved).** The visible batch is read with a single `.in('content_id', ids)` query (existing behavior retained).
- **AC4 — Batched translate.** The driver sends all genuine misses for a window in one request; `glowe-translate` accepts `{ targetLanguage, items[] }`, reads all source rows server-side (anti-poisoning preserved), issues provider calls **concurrently** (bounded) within a single Edge round-trip, upserts all rows single-flight, and returns index-aligned results. The legacy single-item body still works.
- **AC5 — Non-blocking parallelism.** No path awaits misses sequentially per card; a slow or failed batch degrades silently to source text and never blocks rendering or other batches.
- **AC6 — Viewport prefetch.** An `IntersectionObserver` with a lookahead margin (~1–2 screens) enqueues cards before they reach the viewport; first-screen cards qualify at load; discovery of new cards (MutationObserver / explicit `scan()`) registers them with the observer instead of translating immediately.
- **AC7 — Early trigger.** The registration flush is a `requestAnimationFrame` tick (not the 150ms debounce), so the initial visible window begins resolving as soon as cards are inserted.
- **AC8 — Loading indicator.** A field unresolved 400ms after entering the translate path shows a discreet localized "Translating…" line in the reserved `.tr-slot` (interface language, `aria-live`), removed on resolve; warm / same-language / session-cache paths never render it; the source->translation swap causes no layout shift.
- **AC9 — Graceful degradation + cost bounds.** Only near-viewport content is translated (no bulk pre-translation, no translate-on-publish); provider/network failure leaves source text in place with no error UI; the session skip-map prevents re-firing a resolved skip/failure.
- **AC10 — No schema change; shared provider.** Reuses `glowe_content_translations`; the source registry + `translateMany` helper live under `_shared/translation/` so `glowe-translate` shares logic (duplication gate); names are never translated; the KC path is unchanged.

## 7. Rollout phases (detailed sequencing -> implementation plan)

1. **Client efficiency** (no backend): same-language short-circuit (AC1) + session cache (AC2) + make the miss path concurrent (AC5). Immediate win, low risk.
2. **Batched translation** (AC4, AC10): extend the Edge Function + shared-module extraction; client sends batched requests.
3. **Viewport prefetch** (AC6, AC7): IntersectionObserver lookahead + rAF registration flush.
4. **Loading indicator** (AC8): delayed, localized "Translating…".

## 8. Testing & verification

- **Unit** (`js/__tests__/glowe-translate.test.js`, vitest): `sameLanguageSkip` truth table; session-cache key/put/get/evict; batch request/response normalization (index alignment).
- **Edge/shared** (Deno): `translateMany` bounded-concurrency + order preservation with a fake provider; batch handler accepts batch + legacy bodies; anti-poisoning (source-row read) preserved; per-item allow-list rejection is non-fatal; single-flight upsert.
- **Browser verification on dev** (per repo practice — verify UI before "done"): load a cold cross-language feed, count Edge calls and wall-clock before/after; confirm same-language pages fire **zero** translation calls; confirm the indicator appears only when cold > 400ms, is in the interface language, and causes no scroll shift.
- **Before/after measurement** replaces the illustrative numbers in §3 with real figures.
