import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { resolveBatch } from './resolveBatch.ts';

const POST_ID = '11111111-1111-1111-1111-111111111111';
const COMMENT_ID = '22222222-2222-2222-2222-222222222222';
const HEBREW_TITLE = 'ספה כחולה למסירה';

/** A source read made under the caller's rights: `table`, selected columns, key column and ids. */
interface SourceRead { table: string; select: string; pk: string; ids: string[] }

/** A fake client whose reads answer from `rows[table]` and are recorded. */
function fakeReader(rows: Record<string, Record<string, unknown>[]>, reads: SourceRead[]): SupabaseClient {
  return {
    from: (table: string) => ({
      select: (select: string) => ({
        in: (pk: string, ids: string[]) => {
          reads.push({ table, select, pk, ids });
          return Promise.resolve({ data: (rows[table] ?? []).filter((r) => ids.includes(String(r[pk]))), error: null });
        },
      }),
    }),
  } as unknown as SupabaseClient;
}

/** A fake cache client over content_translations holding `cached` rows keyed by content id and field. */
function fakeCache(cached: Record<string, Record<string, unknown>>): SupabaseClient {
  const chain = (filters: Record<string, string> = {}) => ({
    eq: (column: string, value: string) => chain({ ...filters, [column]: value }),
    maybeSingle: () => Promise.resolve({ data: cached[`${filters.content_id}:${filters.field}`] ?? null, error: null }),
  });
  return { from: (_table: string) => ({ select: () => chain() }) } as unknown as SupabaseClient;
}

Deno.test('a post title is read from posts by id and answered from the cache without a provider call', async () => {
  const reads: SourceRead[] = [];
  const reader = fakeReader({ posts: [{ id: POST_ID, title: HEBREW_TITLE }] }, reads);
  const cache = fakeCache({
    [`${POST_ID}:title`]: {
      content_type: 'post', content_id: POST_ID, field: 'title', target_language: 'en',
      source_language: 'he', translated_text: 'Blue sofa to give away', model: 'm', confidence: 0.9,
    },
  });
  const results = await resolveBatch(reader, cache, 'en', [{ contentType: 'post', contentId: POST_ID, field: 'title' }]);
  assertEquals(reads, [{ table: 'posts', select: 'id, title', pk: 'id', ids: [POST_ID] }]);
  assertEquals(results[0].status, 'cached');
  assertEquals(results[0].translation?.translatedText, 'Blue sofa to give away');
});

Deno.test('a comment body is read from post_comments by id', async () => {
  const reads: SourceRead[] = [];
  const reader = fakeReader({ post_comments: [{ id: COMMENT_ID, body: HEBREW_TITLE }] }, reads);
  const cache = fakeCache({
    [`${COMMENT_ID}:body`]: {
      content_type: 'comment', content_id: COMMENT_ID, field: 'body', target_language: 'en',
      source_language: 'he', translated_text: 'A blue sofa', model: null, confidence: null,
    },
  });
  const results = await resolveBatch(reader, cache, 'en', [{ contentType: 'comment', contentId: COMMENT_ID, field: 'body' }]);
  assertEquals(reads[0].table, 'post_comments');
  assertEquals(results[0].status, 'cached');
});

Deno.test('items outside the registry, or whose row the caller cannot see, are skipped without any cache read', async () => {
  const reads: SourceRead[] = [];
  const reader = fakeReader({ posts: [] }, reads);
  const cache = fakeCache({});
  const results = await resolveBatch(reader, cache, 'en', [
    { contentType: 'ride_listing', contentId: POST_ID, field: 'title' }, // retired: rides are posts
    { contentType: 'post', contentId: POST_ID, field: 'display_name' },   // not a translatable field
    { contentType: 'post', contentId: POST_ID, field: 'title' },          // row not visible to the caller
  ]);
  assertEquals(results.map((r) => r.status), ['skipped', 'skipped', 'skipped']);
  assertEquals(reads.map((r) => r.table), ['posts']);
});
