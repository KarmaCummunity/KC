import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cacheKeyOf, getCachedMany } from './cache.ts';

const key = { contentType: 'post', contentId: 'id1', field: 'title' };

Deno.test('empty cache batch never reads the database', async () => {
  assertEquals((await getCachedMany({} as SupabaseClient, 'en', [])).size, 0);
});

Deno.test('batched cache rejects query errors rather than treating them as cached data', async () => {
  const client = { from: () => ({ select: () => ({ eq: () => ({ in: () =>
    Promise.resolve({ data: null, error: { message: 'offline' } }) }) }) }) } as unknown as SupabaseClient;
  await assertRejects(() => getCachedMany(client, 'en', [key]), Error, 'getCachedMany: offline');
});

Deno.test('batched cache deduplicates ids and ignores other types and fields', async () => {
  let selectedIds: string[] = [];
  const row = { content_type: 'post', content_id: 'id1', field: 'title', target_language: 'en',
    source_language: 'he', translated_text: 'Wanted', model: null, confidence: null };
  const client = { from: () => ({ select: () => ({ eq: () => ({ in: (_column: string, ids: string[]) => {
    selectedIds = ids;
    return Promise.resolve({ data: [row, { ...row, content_type: 'comment', translated_text: 'Wrong type' },
      { ...row, field: 'description', translated_text: 'Wrong field' }], error: null });
  } }) }) }) } as unknown as SupabaseClient;
  const found = await getCachedMany(client, 'en', [key, key]);
  assertEquals(selectedIds, ['id1']);
  assertEquals(found.size, 1);
  assertEquals(found.get(cacheKeyOf(key))?.translatedText, 'Wanted');
});
