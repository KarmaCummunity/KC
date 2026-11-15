import { assertEquals } from 'jsr:@std/assert@1';
import { resolveField, SOURCE } from './kcSource.ts';

Deno.test('resolveField maps scalar fields for KC content types', () => {
  assertEquals(resolveField(SOURCE.post, 'title'), { column: 'title', index: null });
  assertEquals(resolveField(SOURCE.message, 'body'), { column: 'body', index: null });
  assertEquals(resolveField(SOURCE.comment, 'body'), { column: 'body', index: null });
  assertEquals(resolveField(SOURCE.user, 'biography'), { column: 'biography', index: null });
});

Deno.test('resolveField rejects proper names and unknown fields', () => {
  assertEquals(resolveField(SOURCE.post, 'display_name'), null);
  assertEquals(resolveField(SOURCE.user, 'display_name'), null);
  assertEquals(resolveField(SOURCE.comment, 'author_id'), null);
});

Deno.test('every registered KC content type resolves documented fields', () => {
  const expected: Record<string, string[]> = {
    post: ['title', 'description'],
    message: ['body'],
    comment: ['body'],
    user: ['biography'],
  };
  for (const [type, fields] of Object.entries(expected)) {
    const src = SOURCE[type];
    assertEquals(!!src, true, `missing content type ${type}`);
    for (const f of fields) {
      assertEquals(resolveField(src, f) !== null, true, `${type}.${f} should resolve`);
    }
  }
});

Deno.test('the registry follows the baseline: content types of the cache, rows keyed by id, no retired ride listing', () => {
  assertEquals(Object.keys(SOURCE).sort(), ['comment', 'message', 'post', 'user']);
  assertEquals(
    Object.fromEntries(Object.entries(SOURCE).map(([type, src]) => [type, [src.table, src.pk]])),
    { post: ['posts', 'id'], comment: ['post_comments', 'id'], message: ['messages', 'id'], user: ['users', 'id'] },
  );
  assertEquals(SOURCE.ride_listing, undefined);
});
