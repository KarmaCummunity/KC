import { describe, expect, it } from 'vitest';
import { PostError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { isPostSavedRow, listSavedPostsPage, savePostRow, unsavePostRow } from '../savedPostsMethods';
import { fail, makeCard, ok, pageTables } from './cardFixtures';

const ID_A = '3f9c2f0e-6a5b-4c3e-9a41-0b9d1f6a7c11';
const ID_B = '3f9c2f0e-6a5b-4c3e-9a41-0b9d1f6a7c22';
const ID_C = '3f9c2f0e-6a5b-4c3e-9a41-0b9d1f6a7c33';

describe('savePostRow / unsavePostRow / isPostSavedRow', () => {
  it('saves for the signed-in member and ignores a duplicate', async () => {
    const { client, calls } = createFakeClient({ userId: 'u1', tables: { saved_posts: ok(null) } });

    await savePostRow(client, 'p1');

    const write = callsTo(calls, 'saved_posts')[0];
    expect(write?.kind).toBe('upsert');
    expect(write?.payload).toEqual({ user_id: 'u1', post_id: 'p1' });
    expect(write?.filters).toContainEqual(['onConflict', { onConflict: 'user_id,post_id', ignoreDuplicates: true }]);
  });

  it('needs a signed-in member', async () => {
    const { client } = createFakeClient({ userId: null });
    await expect(savePostRow(client, 'p1')).rejects.toBeInstanceOf(PostError);
  });

  it('removes a bookmark and tells whether one exists', async () => {
    const { client, calls } = createFakeClient({ tables: { saved_posts: ok({ post_id: 'p1' }) } });

    await unsavePostRow(client, 'p1');
    expect(callsTo(calls, 'saved_posts')[0]?.kind).toBe('delete');
    expect(await isPostSavedRow(client, 'p1')).toBe(true);

    const none = createFakeClient({ tables: { saved_posts: ok(null) } });
    expect(await isPostSavedRow(none.client, 'p1')).toBe(false);
  });

  it('reports a missing table as unavailable', async () => {
    const { client } = createFakeClient({ tables: { saved_posts: fail('PGRST205', 'no table') } });
    await expect(isPostSavedRow(client, 'p1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('listSavedPostsPage', () => {
  function saved(rows: unknown) {
    return createFakeClient({
      userId: 'u1',
      tables: pageTables({ saved_posts: ok(rows) }),
      rpc: { post_cards: ok([makeCard({ id: ID_B }), makeCard({ id: ID_A })]) },
    });
  }

  it('lists the caller\'s bookmarks as cards, most recently saved first', async () => {
    const { client, calls } = saved([
      { post_id: ID_A, saved_at: '2026-01-03T00:00:00Z' },
      { post_id: ID_B, saved_at: '2026-01-02T00:00:00Z' },
    ]);

    const page = await listSavedPostsPage(client, 20);

    const read = callsTo(calls, 'saved_posts')[0];
    expect(read?.filters).toEqual(expect.arrayContaining([['eq', 'user_id', 'u1'], ['limit', 21]]));
    expect(page.posts.map((post) => post.postId)).toEqual([ID_A, ID_B]);
    expect(page.nextCursor).toBeNull();
  });

  it('pages by (saved_at, post_id)', async () => {
    const { client, calls } = saved([
      { post_id: ID_A, saved_at: '2026-01-03T00:00:00Z' },
      { post_id: ID_B, saved_at: '2026-01-02T00:00:00Z' },
      { post_id: ID_C, saved_at: '2026-01-01T00:00:00Z' },
    ]);

    const first = await listSavedPostsPage(client, 2);
    expect(JSON.parse(first.nextCursor ?? 'null')).toEqual({ t: '2026-01-02T00:00:00Z', id: ID_B });

    await listSavedPostsPage(client, 2, first.nextCursor ?? undefined);
    const second = callsTo(calls, 'saved_posts')[1];
    expect(second?.filters).toContainEqual([
      'or',
      `saved_at.lt.2026-01-02T00:00:00Z,and(saved_at.eq.2026-01-02T00:00:00Z,post_id.lt.${ID_B})`,
    ]);
  });
});
