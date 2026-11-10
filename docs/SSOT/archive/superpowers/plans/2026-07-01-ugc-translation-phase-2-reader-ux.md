# UGC Translation — Phase 2 Reader UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render posts in each reader's preferred language across the feed and full post — feed translates the visible window on demand (source-then-swap), full post has a "show original" toggle — reusing the landed Phase 1 cache/RPC substrate.

**Architecture:** A read-time overlay on the existing feed/post queries. Contract prerequisite exposes `sourceLanguage` (posts) and `preferredLanguage` (users). Two mobile hooks (`useReaderLanguage`, `useTranslatedPosts`) drive a presentational `TranslatableText` component. Backend hardening: stale-on-edit cache purge, Edge Function translates the verified source row (not client text), server-side language allow-list.

**Tech Stack:** TypeScript monorepo (pnpm/turbo), `@kc/domain`/`@kc/application`/`@kc/infrastructure-supabase`/`apps/mobile` (Expo RN, expo-router, React Query, react-i18next, RTL-forced), Supabase (Postgres + Edge Functions/Deno), vitest.

**Spec:** `docs/SSOT/archive/superpowers/specs/2026-07-01-ugc-translation-phase-2-reader-ux-design.md` (incl. Revision 1 council fixes). FR-TRANSLATE-003.

---

## PR structure & ordering

This plan is split into three phases mapping to PRs (BE/FE lane split, CLAUDE.md §9):

- **Phase A — Contract + BE substrate (Tasks 1–5).** One BE PR. Independently testable; unblocks FE.
- **Phase B — Application helpers (Tasks 6–7).** Folds into the BE PR or its own `(contract)` PR.
- **Phase C — Mobile reader UX (Tasks 8–16).** One FE PR, depends on Phase A/B merged.

**Verification gate for every code response:** begin with `Mapped to spec: FR-TRANSLATE-003. Refactor logged: [Yes/No/NA].`

**Local test runner note (from repo memory):** run vitest with `NODE_OPTIONS=--experimental-require-module` on Node 20.17. From `app/`: `pnpm --filter @kc/<pkg> test`. Pre-push gates from `app/`: `pnpm typecheck && pnpm test && pnpm lint`.

**Migration numbering:** at time of writing, `origin/dev` tops out at `0212`; a concurrent PR will add `0213`. Before creating the migration in Task 4, run `ls supabase/migrations | tail -3` and use the next unused integer. This plan names it `0214_content_translations_purge_on_edit.sql` — rename to the actual next number if 0214 is taken.

---

## Phase A — Contract + BE substrate

### Task 1: Add `sourceLanguage` to the Post entity + row mapping

**Files:**
- Modify: `app/packages/domain/src/posts.ts` (Post interface, ~line 51)
- Modify: `app/packages/infrastructure-supabase/src/posts/mapPostRow.ts` (PostJoinedRow type + `mapPostRow` return, ~line 87)
- Test: `app/packages/infrastructure-supabase/src/posts/__tests__/mapPostRow.test.ts` (create if absent)

The DB column `posts.source_language` already exists (migration 0207) and `POST_SELECT_OWNER` fetches it via `*`. This wires it through the type + mapping only. No migration.

- [ ] **Step 1: Add the domain field.** In `app/packages/domain/src/posts.ts`, inside `interface Post`, after `updatedAt: string;`, add:

```typescript
  /** FR-TRANSLATE — detected BCP-47 source language of title/description; null = not yet detected. */
  sourceLanguage: string | null;
```

- [ ] **Step 2: Add the row field.** In `app/packages/infrastructure-supabase/src/posts/mapPostRow.ts`, add `source_language?: string | null;` to the `PostJoinedRow` (and base row) interface, then in `mapPostRow`'s returned object, after `updatedAt: row.updated_at,`, add:

```typescript
    sourceLanguage: row.source_language ?? null,
```

- [ ] **Step 3: Write the failing test.** In `app/packages/infrastructure-supabase/src/posts/__tests__/mapPostRow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapPostRow } from '../mapPostRow';

const baseRow = {
  post_id: 'p1', owner_id: 'o1', type: 'Give', status: 'open',
  status_before_admin_removal: null, visibility: 'public', title: 'T',
  description: 'D', category: 'furniture', location_display_level: 'city',
  item_condition: null, urgency: null, media_assets: [], recipient: null,
  reopen_count: 0, delete_after: null, created_at: 'c', updated_at: 'u',
} as any;

describe('mapPostRow — sourceLanguage', () => {
  it('maps source_language when present', () => {
    expect(mapPostRow({ ...baseRow, source_language: 'en' }).sourceLanguage).toBe('en');
  });
  it('defaults to null when absent', () => {
    expect(mapPostRow(baseRow).sourceLanguage).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests.** From `app/`: `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/infrastructure-supabase test`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/packages/domain/src/posts.ts app/packages/infrastructure-supabase/src/posts/mapPostRow.ts app/packages/infrastructure-supabase/src/posts/__tests__/mapPostRow.test.ts
git commit -m "feat(contract): expose posts.source_language on Post entity"
```

---

### Task 2: Add `preferredLanguage` to the User entity + row mapping

**Files:**
- Modify: `app/packages/domain/src/entities.ts` (User interface, ~line 63)
- Modify: `app/packages/infrastructure-supabase/src/users/mapUserRow.ts` (UserRow + mapUserRow)
- Modify: `app/packages/infrastructure-supabase/src/users/userPublicColumns.ts` (select list)
- Test: `app/packages/infrastructure-supabase/src/users/__tests__/mapUserRow.test.ts` (create if absent)

The DB column `users.preferred_language` already exists (0207). This surfaces it on reads.

- [ ] **Step 1: Add the domain field.** In `app/packages/domain/src/entities.ts`, inside `interface User`, after `updatedAt: string;`, add:

```typescript
  /** FR-TRANSLATE — reader's BCP-47 output language; null = resolve from device locale. */
  preferredLanguage: string | null;
```

- [ ] **Step 2: Add the row field + mapping.** In `mapUserRow.ts`, add `preferred_language?: string | null;` to `UserRow`, and in `mapUserRow`'s return, after `updatedAt: row.updated_at,`, add:

```typescript
    preferredLanguage: row.preferred_language ?? null,
```

- [ ] **Step 3: Add to the select columns.** In `userPublicColumns.ts`, append `, preferred_language` to `USER_PUBLIC_SELECT_COLUMNS` (before the closing quote).

- [ ] **Step 4: Write the failing test.** In `app/packages/infrastructure-supabase/src/users/__tests__/mapUserRow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapUserRow } from '../mapUserRow';

const row = {
  user_id: 'u1', auth_provider: 'email', share_handle: 'h', display_name: null,
  city: null, city_name: null, biography: null, avatar_url: null,
  privacy_mode: 'Public', privacy_changed_at: null, account_status: 'active',
  onboarding_state: 'done', notification_preferences: {}, is_super_admin: false,
  closure_explainer_dismissed: false, first_post_nudge_dismissed: false,
  items_given_count: 0, items_received_count: 0, active_posts_count_internal: 0,
  followers_count: 0, following_count: 0, karma_points: 0,
  created_at: 'c', updated_at: 'u',
} as any;

describe('mapUserRow — preferredLanguage', () => {
  it('maps preferred_language when present', () => {
    expect(mapUserRow({ ...row, preferred_language: 'ru' }).preferredLanguage).toBe('ru');
  });
  it('defaults to null when absent', () => {
    expect(mapUserRow(row).preferredLanguage).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests.** `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/infrastructure-supabase test`. Expected: PASS. Fix any other `mapUserRow` consumers that build `User` literals (typecheck will flag them — add `preferredLanguage: null`).

- [ ] **Step 6: Typecheck the monorepo.** From `app/`: `pnpm typecheck`. Fix any `User`/`Post` literal construction sites the new required fields break (e.g. test fixtures) by adding `sourceLanguage: null` / `preferredLanguage: null`.

- [ ] **Step 7: Commit.**

```bash
git add app/packages/domain/src/entities.ts app/packages/infrastructure-supabase/src/users
git commit -m "feat(contract): expose users.preferred_language on User entity"
```

---

### Task 3: Migration — purge cached translations when a post's title/description is edited

**Files:**
- Create: `supabase/migrations/0214_content_translations_purge_on_edit.sql` (use next free number)
- Create: `supabase/tests/0214_content_translations_purge_on_edit.sql`

Follows the exact pattern of the existing purge triggers in `0208_content_translations.sql`.

- [ ] **Step 1: Write the migration.** Create `supabase/migrations/0214_content_translations_purge_on_edit.sql`:

```sql
-- 0214 — FR-TRANSLATE-003: purge cached post translations on content edit.
-- Phase 1a purged on delete + admin-removal only; an edited title/description
-- would otherwise serve a stale translation forever. Re-translation happens
-- lazily on the next read (cache miss).
set search_path = public;

create or replace function public.content_translations_purge_post_on_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title
     or new.description is distinct from old.description then
    delete from public.content_translations
     where content_type = 'post' and content_id = new.post_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_translations_purge_post_edit on public.posts;
create trigger trg_content_translations_purge_post_edit
  after update of title, description on public.posts
  for each row execute function public.content_translations_purge_post_on_edit();
```

- [ ] **Step 2: Write the SQL regression test.** Create `supabase/tests/0214_content_translations_purge_on_edit.sql` (mirrors `supabase/tests/0210_content_translations_read.sql` structure):

```sql
-- Regression for migration 0214: editing a post's title/description purges its
-- cached translations; an unrelated update (e.g. reopen_count) does not.
begin;

do $$
declare v_city text; v_owner uuid := '00000000-0000-0000-0000-0000000214a1';
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_owner, 'tr214_owner@test.local', now(), '{}'::jsonb,
          jsonb_build_object('provider','email'), 'authenticated', 'authenticated');
  update public.users set share_handle = 'tr214_owner', account_status = 'active' where user_id = v_owner;
  select city_id into v_city from public.cities limit 1;
  if v_city is null then raise exception 'PRECONDITION FAILED: no cities seeded'; end if;

  insert into public.posts (post_id, owner_id, type, status, visibility, title, description, category, city)
  values ('00000000-0000-0000-0000-0000002140b1', v_owner, 'Give', 'open', 'public',
          'Original title', 'Original desc', 'furniture', v_city);

  insert into public.content_translations (content_type, content_id, field, target_language, source_language, translated_text)
  values ('post', '00000000-0000-0000-0000-0000002140b1', 'title', 'en', 'he', 'Original title EN'),
         ('post', '00000000-0000-0000-0000-0000002140b1', 'description', 'en', 'he', 'Original desc EN');
end $$;

-- Non-content update must NOT purge.
update public.posts set reopen_count = reopen_count + 1
 where post_id = '00000000-0000-0000-0000-0000002140b1';
do $$
declare n int;
begin
  select count(*) into n from public.content_translations
   where content_id = '00000000-0000-0000-0000-0000002140b1';
  if n <> 2 then raise exception 'ASSERT FAILED: non-content update purged translations (got %)', n; end if;
end $$;

-- Title edit MUST purge.
update public.posts set title = 'New title'
 where post_id = '00000000-0000-0000-0000-0000002140b1';
do $$
declare n int;
begin
  select count(*) into n from public.content_translations
   where content_id = '00000000-0000-0000-0000-0000002140b1';
  if n <> 0 then raise exception 'ASSERT FAILED: title edit did not purge translations (got %)', n; end if;
end $$;

rollback;
\echo '✓ 0214 content_translations purge-on-edit regression test passed'
```

- [ ] **Step 3: Apply + verify against dev.** From repo root, source secrets and push via the pipeline (NOT MCP apply_migration — see the recurring-drift task): `set -a; source ~/.kc-dev-secrets.env; set +a; supabase db push`. Then run the test: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0214_content_translations_purge_on_edit.sql` (or the repo's SQL-probe runner). Expected: the ✓ echo, no ASSERT failures.

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/0214_content_translations_purge_on_edit.sql supabase/tests/0214_content_translations_purge_on_edit.sql
git commit -m "feat(infra): purge cached post translations on title/description edit (FR-TRANSLATE-003)"
```

---

### Task 4: Harden the `translate` Edge Function — source-row text + server-side language allow-list

**Files:**
- Modify: `supabase/functions/translate/index.ts`
- Create: `supabase/functions/translate/supportedLanguages.ts`

Two council fixes: (a) translate the field read from the verified source row, never client-supplied text (anti cache-poisoning); (b) reject unsupported target languages server-side.

- [ ] **Step 1: Add the server-side allow-list.** Create `supabase/functions/translate/supportedLanguages.ts`:

```typescript
// FR-TRANSLATE-003 — the target languages the reader UX offers. Server-side gate
// so an arbitrary tag cannot spend a provider call / poison the cache. Keep in
// sync with the mobile picker constant (SUPPORTED_TRANSLATION_LANGUAGES).
export const SUPPORTED_TARGET_LANGUAGES = new Set(['he', 'en', 'ar', 'ru']);

/** Base-language match (e.g. 'en-US' → 'en'). */
export function isSupportedTarget(tag: string): boolean {
  const base = tag.toLowerCase().split('-')[0];
  return SUPPORTED_TARGET_LANGUAGES.has(base);
}
```

- [ ] **Step 2: Read the field from the source row + gate the language.** In `supabase/functions/translate/index.ts`:
  1. Import: `import { isSupportedTarget } from './supportedLanguages.ts';`
  2. Extend the `SOURCE` map so each content type knows which columns hold each field:

```typescript
const SOURCE: Record<string, { table: string; pk: string; fields: Record<string, string> }> = {
  post: { table: 'posts', pk: 'post_id', fields: { title: 'title', description: 'description' } },
  message: { table: 'messages', pk: 'message_id', fields: { body: 'body' } },
};
```

  3. After validating the body and before the provider call, reject unsupported targets:

```typescript
if (!isSupportedTarget(body.targetLanguage)) {
  return json({ error: 'unsupported_language' }, 400, hdrs);
}
```

  4. Replace the visibility SELECT so it also fetches the actual field value, and translate THAT (not `body.sourceText`):

```typescript
const src = SOURCE[body.contentType];
const column = src.fields[body.field];
if (!column) return json({ error: 'invalid_body' }, 400, hdrs);
const { data: srcRow, error: visErr } = await authed.userClient
  .from(src.table)
  .select(`${src.pk}, ${column}`)
  .eq(src.pk, body.contentId)
  .maybeSingle();
if (visErr) return json({ error: 'internal' }, 500, hdrs);
if (!srcRow) return json({ error: 'forbidden' }, 403, hdrs);
const sourceText = (srcRow as Record<string, unknown>)[column];
if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
  return json({ status: 'skipped' }, 200, hdrs);
}
// ...later, pass `sourceText` (the DB value) to the provider instead of body.sourceText.
```

  5. `body.sourceText` becomes optional/ignored — keep accepting it for backward compat but do NOT use it for the provider call. Update the `MAX_INPUT` guard to check the DB `sourceText`.

- [ ] **Step 3: Deploy + smoke-test against dev.** `set -a; source ~/.kc-dev-secrets.env; set +a; supabase functions deploy translate`. Then verify: a request with `targetLanguage:'zz'` returns 400 `unsupported_language`; a valid request for a visible post returns `translated`/`cached` and the translated text corresponds to the DB title (tamper `sourceText` in the request body → response still reflects the real row).

- [ ] **Step 4: Commit.**

```bash
git add supabase/functions/translate
git commit -m "fix(infra): translate verified source-row field + server-side language allow-list (FR-TRANSLATE-003)"
```

---

### Task 5: BE PR — open, verify, merge

- [ ] **Step 1:** From `app/`: `pnpm typecheck && pnpm test && pnpm lint`. All green.
- [ ] **Step 2:** Branch `feat/FR-TRANSLATE-003-be-reader-substrate` from `origin/dev`, push, `gh pr create --base dev` with the §6 body template (Mapped to spec: FR-TRANSLATE-003), `gh pr merge --auto --squash --delete-branch`, watch checks.

---

## Phase B — Application helpers (pure, testable)

### Task 6: `toTranslatableFields` — derive eligible fields from a post

**Files:**
- Create: `app/packages/application/src/translations/toTranslatableFields.ts`
- Modify: `app/packages/application/src/index.ts` (export)
- Test: `app/packages/application/src/translations/__tests__/toTranslatableFields.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { describe, it, expect } from 'vitest';
import { toTranslatableFields } from '../toTranslatableFields';
import type { PostWithOwner } from '../../ports/IPostRepository';

function post(over: Partial<PostWithOwner>): PostWithOwner {
  return { postId: 'p1', title: 'Hello', description: 'World',
    sourceLanguage: 'en', /* other fields not read by the helper */ } as PostWithOwner;
}

describe('toTranslatableFields', () => {
  it('emits title + description for a foreign-language post', () => {
    const out = toTranslatableFields(post({}), 'he');
    expect(out.map((f) => f.field).sort()).toEqual(['description', 'title']);
    expect(out[0]).toMatchObject({ postId: 'p1', sourceLanguage: 'en' });
  });
  it('emits nothing when source language equals reader language', () => {
    expect(toTranslatableFields(post({ sourceLanguage: 'he' }), 'he')).toEqual([]);
  });
  it('skips empty/untranslatable fields', () => {
    expect(toTranslatableFields(post({ description: null, title: '123' }), 'he')).toEqual([]);
  });
  it('translates when source language is unknown (null)', () => {
    const out = toTranslatableFields(post({ sourceLanguage: null }), 'he');
    expect(out.map((f) => f.field)).toContain('title');
  });
});
```

- [ ] **Step 2: Run to confirm it fails.** `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/application test`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** `app/packages/application/src/translations/toTranslatableFields.ts`:

```typescript
import { isTranslatable, needsTranslation } from '@kc/domain';
import type { PostWithOwner } from '../ports/IPostRepository';
import type { TranslatablePostField } from './PostTranslationsUseCases';

/**
 * Derive the translatable fields of a post for a reader language. A field is
 * eligible when it has natural-language text and its source language differs
 * from (or is unknown vs) the reader language. Pure; no I/O.
 */
export function toTranslatableFields(
  post: Pick<PostWithOwner, 'postId' | 'title' | 'description' | 'sourceLanguage'>,
  readerLanguage: string,
): TranslatablePostField[] {
  if (!needsTranslation(post.sourceLanguage, readerLanguage)) return [];
  const candidates: { field: 'title' | 'description'; text: string | null }[] = [
    { field: 'title', text: post.title },
    { field: 'description', text: post.description },
  ];
  return candidates
    .filter((c) => typeof c.text === 'string' && isTranslatable(c.text))
    .map((c) => ({
      postId: post.postId,
      field: c.field,
      sourceLanguage: post.sourceLanguage,
      text: c.text as string,
    }));
}
```

- [ ] **Step 4: Export.** In `app/packages/application/src/index.ts`, add `export { toTranslatableFields } from './translations/toTranslatableFields';`.

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/packages/application/src/translations/toTranslatableFields.ts app/packages/application/src/translations/__tests__/toTranslatableFields.test.ts app/packages/application/src/index.ts
git commit -m "feat(contract): add toTranslatableFields helper (FR-TRANSLATE-003)"
```

---

### Task 7: `deriveTranslationStatus` — pure per-field status

**Files:**
- Create: `app/packages/application/src/translations/deriveTranslationStatus.ts`
- Modify: `app/packages/application/src/index.ts` (export)
- Test: `app/packages/application/src/translations/__tests__/deriveTranslationStatus.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { describe, it, expect } from 'vitest';
import { deriveTranslationStatus } from '../deriveTranslationStatus';

describe('deriveTranslationStatus', () => {
  it('hit when a translation exists', () => {
    expect(deriveTranslationStatus({ hasTranslation: true, isEligible: true, inFlight: false })).toBe('hit');
  });
  it('translating when eligible + in flight + no translation yet', () => {
    expect(deriveTranslationStatus({ hasTranslation: false, isEligible: true, inFlight: true })).toBe('translating');
  });
  it('source when not eligible', () => {
    expect(deriveTranslationStatus({ hasTranslation: false, isEligible: false, inFlight: true })).toBe('source');
  });
  it('source when eligible but settled (failed/skipped, not in flight)', () => {
    expect(deriveTranslationStatus({ hasTranslation: false, isEligible: true, inFlight: false })).toBe('source');
  });
});
```

- [ ] **Step 2: Run to confirm it fails.** Expected: FAIL.

- [ ] **Step 3: Implement.** `app/packages/application/src/translations/deriveTranslationStatus.ts`:

```typescript
export type TranslationStatus = 'hit' | 'translating' | 'source';

/** Pure status derivation for a single translatable field. */
export function deriveTranslationStatus(input: {
  hasTranslation: boolean;
  isEligible: boolean;
  inFlight: boolean;
}): TranslationStatus {
  if (input.hasTranslation) return 'hit';
  if (input.isEligible && input.inFlight) return 'translating';
  return 'source';
}
```

- [ ] **Step 4: Export** from `app/packages/application/src/index.ts`: `export { deriveTranslationStatus, type TranslationStatus } from './translations/deriveTranslationStatus';`

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/packages/application/src/translations/deriveTranslationStatus.ts app/packages/application/src/translations/__tests__/deriveTranslationStatus.test.ts app/packages/application/src/index.ts
git commit -m "feat(contract): add deriveTranslationStatus helper (FR-TRANSLATE-003)"
```

---

## Phase C — Mobile reader UX

### Task 8: Wire translation use cases into the mobile composition root

**Files:**
- Modify: `app/apps/mobile/src/services/postsComposition.ts`

- [ ] **Step 1: Add getters.** In `postsComposition.ts`, import the use cases + adapters and add memoized getters mirroring the existing pattern (`getFeedUseCase`, `getActivePostsCountUseCase`):

```typescript
import {
  GetTranslatedPostsUseCase,
  MaterializePostTranslationsUseCase,
} from '@kc/application';
import {
  SupabasePostTranslationReader,
  EdgeFnTranslationService,
} from '@kc/infrastructure-supabase';

let _getTranslated: GetTranslatedPostsUseCase | undefined;
let _materialize: MaterializePostTranslationsUseCase | undefined;

export function getTranslatedPostsUseCase(): GetTranslatedPostsUseCase {
  if (!_getTranslated) {
    _getTranslated = new GetTranslatedPostsUseCase(
      new SupabasePostTranslationReader(getSupabaseClient({ storage: pickStorage() })),
    );
  }
  return _getTranslated;
}

export function materializePostTranslationsUseCase(): MaterializePostTranslationsUseCase {
  if (!_materialize) {
    _materialize = new MaterializePostTranslationsUseCase(
      new EdgeFnTranslationService(getSupabaseClient({ storage: pickStorage() })),
    );
  }
  return _materialize;
}
```

(Reuse the exact `getSupabaseClient`/`pickStorage` calls already used in this file — copy their import lines if not present.)

- [ ] **Step 2: Typecheck.** From `app/`: `pnpm typecheck`. Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add app/apps/mobile/src/services/postsComposition.ts
git commit -m "feat(mobile): wire translation use cases into composition root (FR-TRANSLATE-003)"
```

---

### Task 9: `useReaderLanguage` hook

**Files:**
- Create: `app/apps/mobile/src/hooks/useReaderLanguage.ts`
- Test: `app/apps/mobile/src/hooks/__tests__/useReaderLanguage.test.ts`

- [ ] **Step 1: Implement.** `app/apps/mobile/src/hooks/useReaderLanguage.ts`:

```typescript
// FR-TRANSLATE-003 — the reader's effective output language (BCP-47). Reads the
// persisted users.preferred_language and folds in device locale (he fallback).
import { useQuery } from '@tanstack/react-query';
import { resolveReaderLanguage } from '../i18n/deviceLanguage';
import { getUserRepo } from '../services/userComposition';
import { useAuthStore } from '../store/authStore';

export function useReaderLanguage(): string {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data } = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
  return resolveReaderLanguage(data?.preferredLanguage ?? null);
}
```

(The `['user-profile', userId]` key matches `settings.tsx`, so the record is shared/cached.)

- [ ] **Step 2: Write the test** (pure-resolver focus; wrap in QueryClientProvider per the repo pattern). `app/apps/mobile/src/hooks/__tests__/useReaderLanguage.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../services/userComposition', () => ({
  getUserRepo: () => ({ findById: async () => ({ preferredLanguage: 'ru' }) }),
}));
vi.mock('../../store/authStore', () => ({ useAuthStore: (sel: any) => sel({ session: { userId: 'u1' } }) }));
vi.mock('../../i18n/deviceLanguage', () => ({ resolveReaderLanguage: (p: string | null) => p ?? 'he' }));

import { useReaderLanguage } from '../useReaderLanguage';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: new QueryClient() }, children);

describe('useReaderLanguage', () => {
  it('falls back to he before the user record loads', () => {
    const { result } = renderHook(() => useReaderLanguage(), { wrapper });
    expect(result.current).toBe('he');
  });
});
```

- [ ] **Step 3: Run tests.** `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/mobile test`. Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add app/apps/mobile/src/hooks/useReaderLanguage.ts app/apps/mobile/src/hooks/__tests__/useReaderLanguage.test.ts
git commit -m "feat(mobile): add useReaderLanguage hook (FR-TRANSLATE-003)"
```

---

### Task 10: `useTranslatedPosts` hook — batched, viewport-gated, skip-mapped

**Files:**
- Create: `app/apps/mobile/src/hooks/useTranslatedPosts.ts`
- Test: `app/apps/mobile/src/hooks/__tests__/useTranslatedPosts.test.ts`

This is the core overlay. It reads cached translations for the given posts, materializes eligible misses in the background (bounded to the posts passed in — the caller passes only the visible window), keeps a session skip-map so failed/skipped fields don't re-fire, and exposes per-field lookups + status.

- [ ] **Step 1: Implement.** `app/apps/mobile/src/hooks/useTranslatedPosts.ts`:

```typescript
// FR-TRANSLATE-003 — read-time translation overlay for a set of posts. Caller
// passes ONLY the currently-visible posts (viewport-gated) so materialization is
// bounded. Cache hits render inline; eligible misses materialize in the
// background and swap in on the next read. Failed/skipped fields are remembered
// (session skip-map) so they never re-fire.
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toTranslatableFields, deriveTranslationStatus, type TranslationStatus } from '@kc/application';
import type { PostWithOwner } from '@kc/application';
import { getTranslatedPostsUseCase, materializePostTranslationsUseCase } from '../services/postsComposition';

type FieldKey = string; // `${postId}:${field}`
const key = (postId: string, field: string): FieldKey => `${postId}:${field}`;

export interface TranslatedFields {
  title?: string;
  description?: string;
}

export function useTranslatedPosts(posts: PostWithOwner[], readerLanguage: string) {
  const queryClient = useQueryClient();
  const skipRef = useRef<Set<FieldKey>>(new Set()); // per-session skip/fail memo

  const eligible = useMemo(
    () => posts.flatMap((p) => toTranslatableFields(p, readerLanguage)),
    [posts, readerLanguage],
  );
  const postIds = useMemo(() => Array.from(new Set(eligible.map((f) => f.postId))), [eligible]);

  const hitsQuery = useQuery({
    queryKey: ['post-translations', readerLanguage, postIds],
    queryFn: () => getTranslatedPostsUseCase().execute({ fields: eligible, targetLanguage: readerLanguage }),
    enabled: postIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const hitMap = useMemo(() => {
    const m = new Map<FieldKey, string>();
    for (const h of hitsQuery.data?.hits ?? []) m.set(key(h.postId, h.field), h.translatedText);
    return m;
  }, [hitsQuery.data]);

  // Background materialize: only misses not already hit and not skip-memoed.
  const inFlightRef = useRef<Set<FieldKey>>(new Set());
  useEffect(() => {
    const misses = (hitsQuery.data?.misses ?? []).filter(
      (m) => !hitMap.has(key(m.postId, m.field)) && !skipRef.current.has(key(m.postId, m.field)),
    );
    if (misses.length === 0) return;
    misses.forEach((m) => inFlightRef.current.add(key(m.postId, m.field)));
    let cancelled = false;
    void materializePostTranslationsUseCase()
      .execute({ misses, targetLanguage: readerLanguage })
      .then((produced) => {
        if (cancelled) return;
        // Any miss that did not produce a row is a skip/failure — memoize it.
        const producedKeys = new Set(produced.map((p) => key(p.contentId, p.field)));
        misses.forEach((m) => {
          const k = key(m.postId, m.field);
          inFlightRef.current.delete(k);
          if (!producedKeys.has(k)) skipRef.current.add(k);
        });
        if (produced.length > 0) {
          void queryClient.invalidateQueries({ queryKey: ['post-translations', readerLanguage, postIds] });
        }
      });
    return () => { cancelled = true; };
  }, [hitsQuery.data, hitMap, readerLanguage, postIds, queryClient]);

  const eligibleKeys = useMemo(() => new Set(eligible.map((f) => key(f.postId, f.field))), [eligible]);

  function getTranslatedFields(postId: string): TranslatedFields {
    return {
      title: hitMap.get(key(postId, 'title')),
      description: hitMap.get(key(postId, 'description')),
    };
  }
  function getStatus(postId: string, field: 'title' | 'description'): TranslationStatus {
    const k = key(postId, field);
    return deriveTranslationStatus({
      hasTranslation: hitMap.has(k),
      isEligible: eligibleKeys.has(k),
      inFlight: inFlightRef.current.has(k),
    });
  }
  return { getTranslatedFields, getStatus };
}
```

- [ ] **Step 2: Write the test.** `app/apps/mobile/src/hooks/__tests__/useTranslatedPosts.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const getExec = vi.fn();
const matExec = vi.fn();
vi.mock('../../services/postsComposition', () => ({
  getTranslatedPostsUseCase: () => ({ execute: getExec }),
  materializePostTranslationsUseCase: () => ({ execute: matExec }),
}));

import { useTranslatedPosts } from '../useTranslatedPosts';

const post = { postId: 'p1', title: 'Hello', description: null, sourceLanguage: 'en' } as any;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: new QueryClient() }, children);

describe('useTranslatedPosts', () => {
  it('renders a cache hit', async () => {
    getExec.mockResolvedValue({ hits: [{ postId: 'p1', field: 'title', translatedText: 'שלום' }], misses: [] });
    const { result } = renderHook(() => useTranslatedPosts([post], 'he'), { wrapper });
    await waitFor(() => expect(result.current.getTranslatedFields('p1').title).toBe('שלום'));
    expect(result.current.getStatus('p1', 'title')).toBe('hit');
  });

  it('marks a miss translating then leaves source on null materialization', async () => {
    getExec.mockResolvedValue({ hits: [], misses: [{ postId: 'p1', field: 'title', sourceLanguage: 'en', text: 'Hello' }] });
    matExec.mockResolvedValue([]); // skip/failure
    const { result } = renderHook(() => useTranslatedPosts([post], 'he'), { wrapper });
    await waitFor(() => expect(matExec).toHaveBeenCalled());
    await waitFor(() => expect(result.current.getStatus('p1', 'title')).toBe('source'));
  });
});
```

- [ ] **Step 3: Run tests.** Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add app/apps/mobile/src/hooks/useTranslatedPosts.ts app/apps/mobile/src/hooks/__tests__/useTranslatedPosts.test.ts
git commit -m "feat(mobile): add useTranslatedPosts overlay hook (FR-TRANSLATE-003)"
```

---

### Task 11: i18n strings

**Files:**
- Modify: `app/apps/mobile/src/i18n/locales/he/modules/post.ts`
- Modify: `app/apps/mobile/src/i18n/locales/he/modules/common.ts` (if a settings/language module is preferred, add there)

- [ ] **Step 1: Add keys.** In `post.ts`'s `postHe` object, add:

```typescript
  translating: 'מתרגם…',
  showOriginal: 'הצג מקור',
  showTranslation: 'הצג תרגום',
  autoTranslated: 'תורגם אוטומטית',
```

And a settings string (in the settings module or `common.ts`):

```typescript
  translationLanguage: 'שפת תרגום',
  translationLanguageDeviceDefault: 'ברירת מחדל של המכשיר',
```

- [ ] **Step 2: Typecheck.** `pnpm typecheck`. Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add app/apps/mobile/src/i18n/locales/he
git commit -m "feat(mobile): add translation reader-UX strings (he)"
```

---

### Task 12: `TranslatableText` presentational component

**Files:**
- Create: `app/apps/mobile/src/components/TranslatableText.tsx`

Renders one field under the three statuses: `hit` → translated; `translating` → source + discreet indicator sibling; `source` → source. RTL/direction-aware, reflow-safe, a11y-labelled.

- [ ] **Step 1: Implement.** `app/apps/mobile/src/components/TranslatableText.tsx`:

```typescript
// FR-TRANSLATE-003 — renders one translatable field with source-then-swap UX.
import React from 'react';
import { View, Text, type StyleProp, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

export type TranslatableStatus = 'hit' | 'translating' | 'source';

interface Props {
  source: string;
  translated?: string;
  status: TranslatableStatus;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  indicatorStyle?: StyleProp<TextStyle>;
}

export function TranslatableText({ source, translated, status, numberOfLines, style, indicatorStyle }: Props) {
  const { t } = useTranslation();
  const isHit = status === 'hit' && !!translated;
  const shown = isHit ? (translated as string) : source;
  return (
    <View>
      <Text
        style={style}
        numberOfLines={numberOfLines}
        accessibilityLabel={isHit ? `${shown}. ${t('post.autoTranslated')}` : undefined}
      >
        {shown}
      </Text>
      {status === 'translating' ? (
        <Text style={indicatorStyle} accessibilityElementsHidden importantForAccessibility="no">
          {t('post.translating')}
        </Text>
      ) : null}
    </View>
  );
}
```

(The indicator is a non-clamped sibling — never inside the `numberOfLines` Text — so it cannot truncate the content. Direction: `shown` inherits the RTL layout via the passed `style`'s `textAlign`; because the Text auto-aligns to content direction on RN, no per-string override is needed for the common he/en/ar/ru set — if a mixed-direction bug appears in manual QA, wrap `shown` with a Unicode bidi isolate `⁨…⁩`.)

- [ ] **Step 2: Typecheck.** `pnpm typecheck`. Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add app/apps/mobile/src/components/TranslatableText.tsx
git commit -m "feat(mobile): add TranslatableText component (FR-TRANSLATE-003)"
```

---

### Task 13: Feed wiring — viewport-gated translation in PostCard

**Files:**
- Modify: `app/apps/mobile/app/(tabs)/index.tsx` (track visible posts, run `useReaderLanguage` + `useTranslatedPosts`, pass down)
- Modify: `app/apps/mobile/src/components/PostFeedList.tsx` (forward `onViewableItemsChanged` + a translation accessor)
- Modify: `app/apps/mobile/src/components/PostCard.tsx` (render title/description via `TranslatableText`)

- [ ] **Step 1: Track the visible window in the feed screen.** In `index.tsx`, add viewability tracking and the overlay:

```typescript
import { useReaderLanguage } from '../../src/hooks/useReaderLanguage';
import { useTranslatedPosts } from '../../src/hooks/useTranslatedPosts';
// ...
const readerLanguage = useReaderLanguage();
const [visibleIds, setVisibleIds] = React.useState<string[]>([]);
const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 400 }).current;
const onViewableItemsChanged = React.useRef(({ viewableItems }: { viewableItems: { key?: string }[] }) => {
  setVisibleIds(viewableItems.map((v) => v.key).filter((k): k is string => !!k));
}).current;
const visiblePosts = React.useMemo(
  () => feedPosts.filter((p) => visibleIds.includes(p.postId)),
  [feedPosts, visibleIds],
);
const translations = useTranslatedPosts(visiblePosts, readerLanguage);
```

Pass `onViewableItemsChanged`, `viewabilityConfig`, and `translations` down to `PostFeedList`. (`keyExtractor` in `PostFeedList` must key by `post.postId` so `v.key` is the post id — verify/adjust.)

- [ ] **Step 2: Forward through PostFeedList.** In `PostFeedList.tsx`, add the two FlatList props and thread a `translations` prop into `renderItem` → `PostCardGrid`/`PostCard`:

```typescript
<FlatList
  /* ...existing props... */
  onViewableItemsChanged={onViewableItemsChanged}
  viewabilityConfig={viewabilityConfig}
/>
```

`renderItem` passes `translatedFields={translations.getTranslatedFields(item.postId)}` and `titleStatus={translations.getStatus(item.postId, 'title')}` / `descriptionStatus={translations.getStatus(item.postId, 'description')}` to the card.

- [ ] **Step 3: Render via TranslatableText in PostCard.** In `PostCard.tsx`, accept the new optional props and replace the field renders:

```typescript
// props: translatedFields?: { title?: string; description?: string };
//        titleStatus?: TranslatableStatus; descriptionStatus?: TranslatableStatus;
<TranslatableText
  source={post.title}
  translated={translatedFields?.title}
  status={titleStatus ?? 'source'}
  numberOfLines={2}
  style={styles.title}
  indicatorStyle={styles.translatingIndicator}
/>
{post.description ? (
  <TranslatableText
    source={post.description}
    translated={translatedFields?.description}
    status={descriptionStatus ?? 'source'}
    numberOfLines={2}
    style={styles.description}
    indicatorStyle={styles.translatingIndicator}
  />
) : null}
```

Add a `translatingIndicator` style in `PostCard.styles.ts` (small, `colors.textDisabled`, `typography.caption`, `textAlign: alignStart`).

- [ ] **Step 4: Verify in the browser (per repo memory — RN-Web layout bugs escape typecheck).** From `app/`: `pnpm --filter @kc/mobile web`. Load the feed as a signed-in user whose `preferred_language` differs from a post's source language; confirm the card shows source then swaps, the indicator appears briefly, and no scroll jump/reflow. Inspect via the browser MCP.

- [ ] **Step 5: Typecheck + test + lint.** From `app/`: `pnpm typecheck && pnpm test && pnpm lint`. Green.

- [ ] **Step 6: Commit.**

```bash
git add app/apps/mobile/app/(tabs)/index.tsx app/apps/mobile/src/components/PostFeedList.tsx app/apps/mobile/src/components/PostCard.tsx app/apps/mobile/src/components/PostCard.styles.ts
git commit -m "feat(mobile): viewport-gated translated feed rendering (FR-TRANSLATE-003)"
```

---

### Task 14: Post-detail wiring — translated body + show-original toggle + label

**Files:**
- Modify: `app/apps/mobile/app/post/[id].tsx` (or its scroll-content component `PostDetailScrollContent.tsx`)

- [ ] **Step 1: Add the overlay + toggle.** In the post-detail data component:

```typescript
const readerLanguage = useReaderLanguage();
const translations = useTranslatedPosts(post ? [post] : [], readerLanguage);
const [showOriginal, setShowOriginal] = React.useState(false);
const fields = post ? translations.getTranslatedFields(post.postId) : {};
const titleStatus = post ? translations.getStatus(post.postId, 'title') : 'source';
const hasAnyTranslation = !!fields.title || !!fields.description;
```

Render title/description via `TranslatableText`, forcing `status='source'` when `showOriginal` is true:

```typescript
<TranslatableText source={post.title} translated={fields.title}
  status={showOriginal ? 'source' : titleStatus} style={styles.title} />
```

- [ ] **Step 2: Add the label + toggle UI.** When `hasAnyTranslation` and source ≠ reader language, show a discreet "auto-translated" label and a toggle button:

```typescript
{hasAnyTranslation ? (
  <View style={styles.translationBar}>
    <Text style={styles.autoTranslatedLabel}>{t('post.autoTranslated')}</Text>
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={showOriginal ? t('post.showTranslation') : t('post.showOriginal')}
      onPress={() => {
        setShowOriginal((v) => !v);
        AccessibilityInfo.announceForAccessibility(
          !showOriginal ? t('post.showOriginal') : t('post.showTranslation'),
        );
      }}
    >
      <Text style={styles.showOriginalLink}>
        {showOriginal ? t('post.showTranslation') : t('post.showOriginal')}
      </Text>
    </TouchableOpacity>
  </View>
) : null}
```

Add the referenced styles (`translationBar`, `autoTranslatedLabel`, `showOriginalLink`) with RTL-safe `textAlign` and a ≥44×44 touch area on the toggle (`hitSlop` or padding).

- [ ] **Step 3: Verify in the browser.** `pnpm --filter @kc/mobile web`, open a foreign-language post: default shows translation + label; toggling shows original; toggle hidden when source == reader language.

- [ ] **Step 4: Typecheck + test + lint.** Green.

- [ ] **Step 5: Commit.**

```bash
git add app/apps/mobile/app/post
git commit -m "feat(mobile): translated post detail with show-original toggle (FR-TRANSLATE-003)"
```

---

### Task 15: Settings language picker

**Files:**
- Create: `app/apps/mobile/src/lib/supportedTranslationLanguages.ts`
- Modify: `app/apps/mobile/app/settings.tsx`

- [ ] **Step 1: Add the shared constant.** `app/apps/mobile/src/lib/supportedTranslationLanguages.ts` (keep in sync with the Edge Function `SUPPORTED_TARGET_LANGUAGES`):

```typescript
// FR-TRANSLATE-003 — target languages offered to the reader. Mirror of the
// Edge Function allow-list (supabase/functions/translate/supportedLanguages.ts).
export const SUPPORTED_TRANSLATION_LANGUAGES: { tag: string; labelHe: string }[] = [
  { tag: 'he', labelHe: 'עברית' },
  { tag: 'en', labelHe: 'אנגלית' },
  { tag: 'ar', labelHe: 'ערבית' },
  { tag: 'ru', labelHe: 'רוסית' },
];
```

- [ ] **Step 2: Add the settings row + picker.** In `settings.tsx`, add a row under an appropriate section that opens a picker (reuse an existing bottom-sheet/list-picker component in the repo, or a simple `SettingsScreenRow` per language). On select, call the mutation:

```typescript
const queryClient = useQueryClient();
async function onPickLanguage(tag: string | null) {
  await getUserRepo().setPreferredLanguage(userId!, tag);
  await queryClient.invalidateQueries({ queryKey: ['user-profile', userId] });
  await queryClient.invalidateQueries({ queryKey: ['post-translations'] });
}
```

Show the current selection from `userQuery.data?.preferredLanguage` (or the device-default label when null). Wrap `setPreferredLanguage` in try/catch and surface a toast/alert on failure (retain previous selection).

- [ ] **Step 3: Verify in the browser.** Change the language; confirm the feed + open post re-render in the new language, and "device default" persists null.

- [ ] **Step 4: Typecheck + test + lint.** Green.

- [ ] **Step 5: Commit.**

```bash
git add app/apps/mobile/src/lib/supportedTranslationLanguages.ts app/apps/mobile/app/settings.tsx
git commit -m "feat(mobile): settings translation-language picker (FR-TRANSLATE-003)"
```

---

### Task 16: SSOT updates + FE PR

**Files:**
- Modify: `docs/SSOT/spec/18_translation.md` (FR-TRANSLATE-003 → ✅, expand ACs to match AC1–AC12 of the design)
- Modify: `docs/SSOT/BACKLOG.md` (TRANSLATE-P2 → ✅ Done)
- Modify: `docs/SSOT/TECH_DEBT.md` (if any residue, e.g. a true batch Edge endpoint deferred → add a TD row)

- [ ] **Step 1: Update the spec.** Replace the FR-TRANSLATE-003 stub with the finalized ACs (mirror the design's AC1–AC12) and flip the status header note for Phase 2 to ✅.

- [ ] **Step 2: Update BACKLOG.** Flip `TRANSLATE-P2` to `✅ Done`.

- [ ] **Step 3: TECH_DEBT.** If a real batch Edge endpoint (multiple fields per call) was NOT implemented (this plan tames cost via viewport+dwell+skip-map instead), add a `TD-1xx` FE row: "Translate Edge Function is per-field; add a batch endpoint to cut round-trips on cold feed windows."

- [ ] **Step 4: Full gate.** From `app/`: `pnpm typecheck && pnpm test && pnpm lint`. Green.

- [ ] **Step 5: Open the FE PR.** Branch `feat/FR-TRANSLATE-003-fe-reader-ux` from latest `origin/dev` (after Phase A merged), push, `gh pr create --base dev` with the §6 template + `Mapped to spec: FR-TRANSLATE-003`, `gh pr merge --auto --squash --delete-branch`, watch checks.

```bash
git add docs/SSOT/spec/18_translation.md docs/SSOT/BACKLOG.md docs/SSOT/TECH_DEBT.md
git commit -m "docs(ssot): mark FR-TRANSLATE-003 phase 2 done"
```

---

## Self-Review (completed against the design spec)

**1. Spec coverage** — design AC1 (settings picker) → Task 15; AC2 (useReaderLanguage) → Task 9; AC3 (feed hit render) → Tasks 10/13; AC4 (miss indicator + swap) → Tasks 10/12/13; AC5 (detail toggle + label) → Task 14; AC6 (silent degradation) → Task 10 skip-map + `EdgeFnTranslationService` null; AC7/AC12 (a11y + RTL + reflow) → Tasks 12/14; AC8 (contract + toTranslatableFields) → Tasks 1/2/6; AC9 (viewport/dwell/batch/skip) → Tasks 10/13; AC10 (edit purge) → Task 3; AC11 (source-row + allow-list) → Task 4. All covered.

**2. Placeholder scan** — migration number is explicitly conditional (checked at implementation time), not a vague placeholder; every code step has real code. No "TBD"/"handle edge cases".

**3. Type consistency** — `TranslatablePostField` (from `PostTranslationsUseCases`), `PostTranslationHit`, `CachedTranslation` (`.contentId`/`.field`), `TranslationStatus`/`TranslatableStatus`, and the `getStatus(postId, field)` / `getTranslatedFields(postId)` accessor names are used consistently across Tasks 6/7/10/12/13/14. The materialization result is keyed by `p.contentId`+`p.field` (matching `CachedTranslation`) in Task 10 — consistent with the port shape in the reference.

**Note on the two known couplings:** `PostFeedList.keyExtractor` must key by `post.postId` for viewability keys to be post ids (Task 13 Step 1 flags the verify); and the mobile `SUPPORTED_TRANSLATION_LANGUAGES` must mirror the Edge `SUPPORTED_TARGET_LANGUAGES` (Task 15 constant comment flags it).
