# UGC auto-translation (KC)

Demand-driven translation for Karma Community user-generated content. Translations are materialized lazily per `(content_type, content_id, field, target_language)`, cached in Postgres, and served on subsequent reads.

For the KC mobile app, `target_language` is always the active app UI language from the i18n module (`he` or `en`). There is no separate translation-language setting; changing the app language changes the target reactively. `users.preferred_language` is a legacy, unused column for this behavior: its database column and read mapping remain, but mobile translation does not read or write it. The `ugc_auto_translation` feature flag remains off.

## Architecture

```mermaid
flowchart LR
  subgraph client [KC mobile / future clients]
    Read[Read path: RPC or direct SELECT]
    Miss[Cache miss list]
    Batch[invoke translate batch]
  end
  subgraph edge [Supabase Edge]
    T[translate function]
    Reg[kcSource registry]
    Prov[Shared provider GoogleFree + Gemini]
  end
  subgraph db [Postgres]
    CT[content_translations]
    Src[posts / post_comments / messages / users]
  end
  Read --> CT
  Miss --> Batch --> T
  T --> Reg --> Src
  T --> Prov
  T --> CT
```

### Components

| Piece | Location | Role |
| --- | --- | --- |
| Cache table | `public.content_translations` | One row per translation key; service-role writes only |
| Source registry | `supabase/functions/_shared/translation/kcSource.ts` | Maps `contentType` → table, PK, allowed fields; server-side reads only (anti-poisoning) |
| Batch resolver | `supabase/functions/translate/resolveBatch.ts` | Cache hit / short-circuit / bounded provider fan-out (`translateMany`) |
| Single path | `supabase/functions/translate/single.ts` | Legacy one-field call with JWT + RLS visibility check |
| HTTP entry | `supabase/functions/translate/index.ts` | Routes single vs `{ targetLanguage, items[] }` batch |
| Shared provider | `supabase/functions/_shared/translation/*` | Language allow-list, short-circuit heuristics, provider seam |
| App adapter | `EdgeFnTranslationService` | `requestTranslation` (single) + `requestTranslationsBatch` |
| Feed materialization | `MaterializePostTranslationsUseCase` | Sends all post misses in one batch invoke |

KC uses **`content_translations` only**. Current schema: `supabase/schemas/78_translation/010_content_translations.sql`, included in `0001_baseline.sql`. Historical migration `0239` predates the baseline reset. Rides are now posts, not a separate translation content type.

### Batch API contract

```http
POST /functions/v1/translate
Authorization: Bearer <user JWT>
Content-Type: application/json

{
  "targetLanguage": "en",
  "items": [
    { "contentType": "post", "contentId": "<uuid>", "field": "title" },
    { "contentType": "post", "contentId": "<another-uuid>", "field": "description" }
  ]
}
```

Response:

```json
{
  "results": [
    { "contentType": "post", "contentId": "…", "field": "title", "status": "cached", "translation": { … } },
    { "contentType": "post", "contentId": "…", "field": "description", "status": "skipped" }
  ]
}
```

`status` is `translated` | `cached` | `skipped` | `error`. Source text is never accepted in the batch body.

### Registered entities (current)

| `contentType` | Table | PK | Fields |
| --- | --- | --- | --- |
| `post` | `posts` | `id` | `title`, `description` |
| `comment` | `post_comments` | `id` | `body` |
| `message` | `messages` | `id` | `body` |
| `user` | `users` | `id` | `biography` (not `display_name`) |

Post cache reads for the feed use `get_post_translations`, a SECURITY INVOKER function limited to the first 100 supplied post IDs. Authenticated cache SELECT policies exist for visible posts, active comments and visible users. There is no message-cache SELECT policy while chat translation remains planned. Registry support alone does not mean a type has released reader UX or consent handling.

## Source checkpoint (2026-11-24, #1863)

- `provider.ts` defaults to `googlefree`; `gemini` is an explicit selector. This does not verify the deployed selector, provider terms, a DPA or permission to spend. D-63/D-65's conditions before real-user exposure are not waived by the current default.
- `resolveBatch.ts` reads eligible sources under caller permissions before using the cache, reads cache rows in one batch, and bounds provider fan-out to two. Unique-key insertion deduplicates persistence **after** provider calls; it does not guarantee one provider call across simultaneous misses.
- `useTranslatedPosts.ts` is gated by `ugc_auto_translation`, whose local default is off. Live flag state was not checked. Chat remains opt-in, default-off and sender-consent-gated in the requirements, with UX planned.
- No project-book chapter or product D/S/G registry entry found in the scoped reconciliation adds a conflicting translation rule. Engineering decisions D-63/D-64/D-65/D-191 and current source remain separately identified; static code presence is not rollout evidence.

## How to add a new translatable entity

1. **Schema** — Add a forward migration:
   - Extend `content_translations_type_chk` / `content_translations_field_chk` if new type or field names are needed.
   - Add `BEFORE DELETE` purge trigger and `AFTER UPDATE` purge on edited translatable columns (mirror `0216` / `0239`).

2. **Registry** — Add an entry to `kcSource.ts` with `table`, `pk`, and `fields`. Do not register proper names or PII display fields.

3. **Tests** — Extend `kcSource.test.ts` with the new type and fields.

4. **Domain (if the app orchestrates it)** — Extend `CONTENT_TYPES` / `TRANSLATION_FIELDS` and `createTranslationRequest` field coupling in `@kc/domain`.

5. **Read path** — Either extend an existing SECURITY INVOKER RPC with RLS-safe joins, or invoke batch translate from the client after visibility is already established.

6. **SSOT** — Update `docs/spec/requirements/18_translation.md` acceptance criteria and this file’s entity table.

Run from `app/`: `pnpm typecheck && pnpm test && pnpm lint`. Run Deno tests: `deno test supabase/functions/_shared/translation/`.
