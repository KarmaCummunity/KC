# Cross-language translation of user-generated content (UGC)

**Status:** Draft (approved in brainstorming 2026-06-29)
**Mapped to:** new spec domain `docs/SSOT/spec/14_translation.md` → `FR-TRANSLATE-*` (to be created during implementation); CLAUDE.md §5 (Clean Architecture invariants)
**Related TD:** (to be appended once `TECH_DEBT.md` is updated)
**Council review:** 5-expert parallel review on 2026-06-29 (cost/scale, UX/accessibility, Postgres/Supabase, security/privacy, i18n/quality). All "needs-changes"; security flagged blockers. Fixes folded into this design.

---

## 1. Problem & Goal

Karma Community serves a **multilingual community**. Users speak many languages. Today the app is Hebrew-only; user-generated content (posts, chat) is shown verbatim in whatever language the author wrote it, which is unreadable to a cross-language audience.

**Primary goal:** full linguistic accessibility — any reader sees any post or message in their own language — on the **cheapest viable infrastructure**, with **fast reads** and **low bandwidth** (users on poor internet).

This is **shared platform infrastructure**: it must serve KC and any future content type. It is not a single-feature add-on.

**Out of scope (UI strings):** translating the app's own UI chrome is a separate, already-architected `react-i18next` effort (`docs/SSOT/archive/superpowers/specs/2026-05-16-hebrew-to-i18n-design.md`). This design covers **UGC only**.

## 2. Core decisions (from brainstorming + council)

1. **Provider: a single LLM-flash tier** (e.g. Gemini Flash / GPT-4o-mini) behind a pluggable adapter. Rationale: ~$0.10–0.30 per 1M source chars — roughly 100× cheaper than classic NMT (Google/DeepL ≈ $20/1M) — and *higher* quality on short social/knowledge text because it accepts domain context. Token spend is trivial even at 1M DAU (~$1.5–3K/mo); the real cost axis is per-invocation overhead, addressed below. A dedicated-NMT adapter may be slotted in later for a hot pair (YAGNI until proven).
2. **Translate ahead of the read, never on the read path.** A read is always a cache lookup served inline as an ordinary field. The LLM runs asynchronously to populate the cache.
3. **Demand-driven (lazy) materialization.** A `(content, field, target_language)` translation is created only when a real reader of that language appears. The system *supports* unlimited languages but only *materializes & pays for* the 2–5 that each piece of content is actually read in. No eager fan-out to N languages.
4. **Display posture (PM decision 2026-06-29):**
   - **Posts (public content): auto-translated** for every reader.
   - **Chat (private): opt-in.** Default off. A message is sent to the translation provider **only if its sender opted in** (no one's words leave without their own consent). The recipient may independently turn off *display* of translations.
5. **Privacy is non-negotiable:** translation provider must be a **zero-retention / no-training tier under a signed DPA**, EU region where feasible, with a public sub-processor list.
6. **Graceful degradation:** any translation failure shows the original. Translation never blocks or breaks a read.

## 3. Architecture (Clean Architecture layers)

Product-agnostic substrate, wired the same way as every other capability.

```
packages/domain/
  LanguageCode            // BCP-47 value object (validation, normalization, variant awareness)
  TranslationRequest      // (contentType, contentId, field, sourceLang, targetLang)
  TranslationError        // domain error class

packages/application/
  ports/
    ITranslationProvider        // translate(texts[], sourceHint, target, context) -> {text, detectedSource, confidence}[]
    ITranslationCacheRepository  // get / putOnConflictDoNothing / deleteForContent
    ILanguageProfile             // author's recent-language prior (for low-confidence detection)
  usecases/
    GetTranslatedContent     // read path: resolve target lang, return cached or signal miss
    TranslateAndCache        // background: single-flight, detect+translate, persist
    PruneColdChatTranslations   // age-based chat eviction

packages/infrastructure-supabase/
  SupabaseTranslationCacheRepository   // the content_translations table
  EdgeFnTranslationProvider            // calls the `translate` Edge Function (holds API key)

apps/mobile/
  composition root: wires ports -> adapters -> React; UI render, local cache, dwell-trigger
```

The LLM API key lives **only** in the Edge Function environment, never in the app bundle.

## 4. Data model

New nullable columns (all metadata-only `ADD COLUMN`, safe on existing tables):

- `users.preferred_language text` — BCP-47; fallback to device locale when null. (Prerequisite — `users` has no language column today.)
- `posts.source_language text`, `posts.source_language_confidence real`.
- `messages.source_language text`, `messages.source_language_confidence real`.

New table **`content_translations`**:

| column | notes |
|---|---|
| `id uuid` PK | |
| `content_type text` | `CHECK IN ('post','message')` |
| `content_id uuid` | no FK (polymorphic) — see deletion handling |
| `field text` | `CHECK IN ('title','description','body')` |
| `target_language text` | BCP-47, variant-aware (see §8) |
| `source_language text` | as detected |
| `translated_text text` | |
| `model text`, `confidence real` | provenance / quality signal |
| `created_at timestamptz` | basis for chat eviction (no `last_read_at`) |

- **Unique / lookup index:** `UNIQUE (content_type, content_id, target_language, field)` — column order chosen so per-content lookup is a prefix scan. This same constraint powers single-flight.
- **No `last_read_at`.** Updating it on every read is write-amplification on the hottest path (MVCC churn, index bloat). Posts are tiny and kept forever; chat is pruned by age via `created_at`.
- **Deletion / moderation:** `BEFORE DELETE` triggers on `posts` and `messages` delete matching translation rows. A trigger on post status → `removed_admin` (and on message redaction / account deletion) likewise purges translations, so moderated/removed content leaves no readable translated copy.
- **Grants:** explicit narrow grants — **no** `anon`/`authenticated` INSERT/UPDATE/DELETE (service-role writes only). Guards against the grant-drift gotcha (live dev `GRANT ALL` vs clean CI). Each column gets `COMMENT ON COLUMN` per house style.

## 5. Read path — posts

1. The feed/post read goes through a **`SECURITY INVOKER` RPC/view** that filters `posts` by their existing RLS **first**, then LEFT JOINs `content_translations` for the reader's `preferred_language`. Translations for an invisible post are unreachable because the post row is already gone — **no second RLS predicate on the join** (avoids double-evaluation of the visibility function on the hottest query).
2. **Cache hit** → translated string returned inline, one language only, no extra round-trip. Instant.
3. **Cache miss** (`source_language ≠ target` and no row): the client shows a **fixed-min-height placeholder** ("Translating…" / dimmed) and enqueues the miss. Translation is fetched once, then **revealed** (not swapped under the reader's eyes). Min-height reservation prevents layout shift (CLS).
   - *Alternative kept open for design review:* show original immediately, locked, with an explicit "Translate" affordance instead of auto-reveal. Default chosen: translate-then-reveal.
4. **Batching:** pending misses are coalesced **by target language** every ~500ms into one LLM call (many short strings, one prompt) — cuts invocation overhead 10–50×, the real cost driver.
5. **No prefetch-translate on scroll.** Only content actually dwelt on (>~300ms in viewport) triggers translation, so we never pay for content scrolled past. Local cache (React Query / MMKV) keeps already-read content instant and available offline.

## 6. Read path — chat

1. On send, **if the sender opted in**, the `translate` Edge Function writes the translation for the **recipient's** `preferred_language` (single target — cheap) **before** the message row is inserted, so the client renders translation inline from the same join. **`content_translations` is not a realtime table** (avoids a second "pop-in" event and double egress).
2. Recipient renders translated body with a per-bubble indicator; "show original" toggle always present; recipient may disable translation display entirely.
3. Chat tolerates append: if a translation lands after delivery, it appends/updates in place at the bottom of the thread (acceptable, unlike feed swap).

## 7. Provider, cost controls, failure handling

- **Single-flight:** `INSERT … ON CONFLICT (content_type,content_id,target_language,field) DO NOTHING RETURNING` — only the winning request calls the LLM; concurrent readers of a freshly-viral post get the cached result. Eliminates the thundering-herd cost bomb.
- **Concurrency cap + capped exponential backoff with jitter** in the Edge Function; **per-user rate limit** and a **daily spend ceiling** (per language) to bound runaway cost.
- **Eviction:** none for posts (tiny, kept forever); age-based `pg_cron` prune for chat translations older than N days, bounded batch size, off-peak. Regeneration on demand is cheap.
- **Dedup:** scoped by `(source_language, target_variant, content_type)` after whitespace/case normalization — **never** across posts↔chat. Global dedup is unsafe (gendered/context-dependent target forms in Hebrew/Arabic).
- **Degradation:** failure → show original, log (without body — see §9), retry in background.

## 8. Language detection & locale correctness

- **Detection folded into the translate call** ("detect source, then translate") → one round-trip; store detected `source_language` **+ confidence**. Below a length/confidence threshold (very short posts, 2-word messages, shared-script pairs es/pt/it or ar/fa/ur), fall back to the author's recent-language profile (`ILanguageProfile`).
- **Source language is user-correctable** (one tap); correction invalidates affected cache rows and re-translates.
- **Short-circuit:** emoji-only / URL-only / number-only content is not translated.
- **Variant awareness:** `zh-Hans` and `zh-Hant` are **distinct** cache keys (different script — never merge). `pt-BR`/`pt-PT`, `es-ES`/`es-419`, Arabic variants may fall back along an explicit chain but the produced variant is tagged; an exact-variant hit is preferred before base fallback. The prompt requests the specific variant.

## 9. Security & privacy (council blockers — all resolved here)

- **Provider terms:** zero-retention / no-training tier only, signed DPA + SCCs, EU region where feasible, public sub-processor list. Default chat translation **off**; posts (public) auto-translated.
- **Consent:** chat is opt-in per sender; one-time disclosure that opted-in messages are processed by an AI translation sub-processor; per-user opt-out; recipient can disable display.
- **Edge Function authorization:** require JWT (`getAuthedUser`, matching existing functions); **verify the caller can actually SELECT the source row** (user-scoped client / RLS check) *before* calling the LLM; enforce max input length; reject non-text. Prevents key-drain / open-relay abuse.
- **RLS:** do not duplicate visibility logic — translation reads flow through the source-joined RPC reusing the *same* predicate (`is_chat_visible_to`, post visibility). Deletion/moderation triggers (§4) prevent stale translated copies of removed/blocked content.
- **Prompt injection:** UGC is untrusted input. System-prompt hardening, structured output, length caps, low temperature; translated output is treated as untrusted display text (no auto-rendering of injected links). Blast radius is display-only (no tools/extra context given to the model).
- **Logging:** never log message/post bodies; redact at the log layer; short log TTL.

## 10. UX & accessibility

- **No soft-swap.** Translate-then-reveal with reserved min-height (or original-locked + explicit Translate affordance). No text changing under a reading user; no layout shift.
- **Per-content direction:** `dir="auto"` (web) / `writingDirection` (native) per node; Unicode isolates (FSI `⁨` … PDI `⁩`) around @mentions, URLs, numbers, emoji. Never rely on the global app-direction constant for user content.
- **Machine-translation labeling:** a small "Auto-translated" badge + a persistent, touch-discoverable "Show original" toggle that renders the original in its own correct direction.
- **Screen-reader support:** emit `lang` + `dir` on each translated node; `accessibilityLabel` prefix announcing "machine-translated from {source}". Honor large-text / Dynamic Type via reserved min-heights, not fixed heights.
- **Low confidence:** keep original primary and *offer* translation rather than replacing with possibly-garbled text.
- **Quality guards in the prompt:** preserve-don't-embellish; do-not-translate pass-through list (@mentions, #hashtags, URLs, numbers + units, known org names); self-rated confidence stored; "report bad translation" affordance.

## 11. Cost summary (with all controls)

| Scale | Monthly LLM-flash spend (order of magnitude) | DB size (post translations, ~3 langs each) |
|---|---|---|
| 1K DAU | a few cents – ~$1 | negligible |
| 100K DAU | tens of dollars | ~150 MB |
| 1M DAU | ~$1.5–3K | low GB |

Storage, Edge Function invocations, and detection are negligible by comparison. Single-flight + language-batching keep invocation overhead (the true cost) bounded.

## 12. Not in v1 (YAGNI)

On-device offline translation (ML Kit); human-curated/edited translations beyond the "report" signal; proactive audience pre-warm (lazy + dwell-trigger only); image/OCR translation; a dedicated-NMT hybrid adapter (interface allows it later).

## 13. Open items for the implementation plan

- Exact provider selection meeting the zero-retention/DPA bar (Vertex Gemini with logging off vs OpenAI ZDR) — engineering decision during planning.
- `react-i18next` UI-strings migration must supply the device-locale → `preferred_language` default.
- New spec file `docs/SSOT/spec/14_translation.md` with `FR-TRANSLATE-*` IDs and ACs; `BACKLOG.md` entry; `DECISIONS.md` entries for the provider/privacy and opt-in posture calls.
