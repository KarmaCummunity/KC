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

/** One batched cache read: the target language and the content ids it asked for. */
interface CacheRead { targetLanguage: string; ids: string[] }

/**
 * A fake cache client over content_translations holding `cached` rows keyed by content id and
 * field. It answers only the batched lookup (`eq(target_language).in(content_id, ids)`) and
 * records every read, so a test sees how many round-trips a batch costs.
 */
function fakeCache(cached: Record<string, Record<string, unknown>>, reads: CacheRead[] = []): SupabaseClient {
  return {
    from: (_table: string) => ({
      select: () => ({
        eq: (_column: string, targetLanguage: string) => ({
          in: (_idColumn: string, ids: string[]) => {
            reads.push({ targetLanguage, ids });
            const rows = Object.values(cached).filter(
              (r) => r.target_language === targetLanguage && ids.includes(String(r.content_id)),
            );
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
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

// #1798: the whole batch costs one cache round-trip, matched in memory by type, id and field.
Deno.test('a batch reads the cache once for every item and matches each row to its own field', async () => {
  const reads: SourceRead[] = [];
  const cacheReads: CacheRead[] = [];
  const reader = fakeReader({ posts: [{ id: POST_ID, title: HEBREW_TITLE, description: HEBREW_TITLE }] }, reads);
  const cache = fakeCache({
    [`${POST_ID}:title`]: {
      content_type: 'post', content_id: POST_ID, field: 'title', target_language: 'en',
      source_language: 'he', translated_text: 'Blue sofa', model: null, confidence: null,
    },
    [`${POST_ID}:description`]: {
      content_type: 'post', content_id: POST_ID, field: 'description', target_language: 'en',
      source_language: 'he', translated_text: 'A blue sofa to give away', model: null, confidence: null,
    },
  }, cacheReads);
  const results = await resolveBatch(reader, cache, 'en', [
    { contentType: 'post', contentId: POST_ID, field: 'title' },
    { contentType: 'post', contentId: POST_ID, field: 'description' },
  ]);
  assertEquals(cacheReads, [{ targetLanguage: 'en', ids: [POST_ID] }]);
  assertEquals(results.map((r) => r.translation?.translatedText), ['Blue sofa', 'A blue sofa to give away']);
});
