import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { listOwnerPostsPage } from '../getMyPostsPage';
import { getProfileClosedPostsHelper } from '../getProfileClosedPostsHelper';
import { fail, makeCard, ok, pageTables } from './cardFixtures';

const ID_A = '3f9c2f0e-6a5b-4c3e-9a41-0b9d1f6a7c11';
const ID_B = '3f9c2f0e-6a5b-4c3e-9a41-0b9d1f6a7c22';
const ID_C = '3f9c2f0e-6a5b-4c3e-9a41-0b9d1f6a7c33';

function owned(rows: unknown, cards = [makeCard({ id: ID_A }), makeCard({ id: ID_B })]) {
  return createFakeClient({
    tables: pageTables({ posts: ok(rows) }),
    rpc: { post_cards: ok(cards) },
  });
}

describe('listOwnerPostsPage', () => {
  it('filters by owner, status and audience, newest first, and returns one page of cards', async () => {
    const { client, calls } = owned([
      { id: ID_A, created_at: '2026-01-03T00:00:00Z' },
      { id: ID_B, created_at: '2026-01-02T00:00:00Z' },
    ]);

    const page = await listOwnerPostsPage(
      client,
      'u1',
      { statuses: ['open'], excludeVisibility: 'OnlyMe' },
      30,
    );

    const read = callsTo(calls, 'posts')[0];
    expect(read?.columns).toBe('id, created_at');
    expect(read?.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'owner_id', 'u1'],
        ['in', 'status', ['open']],
        ['neq', 'visibility', 'OnlyMe'],
        ['limit', 31],
      ]),
    );
    expect(page.posts.map((post) => post.postId)).toEqual([ID_A, ID_B]);
    expect(page.nextCursor).toBeNull();
  });

  it('applies an audience filter and continues after the cursor', async () => {
    const { client, calls } = owned([]);
    const cursor = JSON.stringify({ t: '2026-01-03T00:00:00Z', id: ID_A });

    await listOwnerPostsPage(client, 'u1', { statuses: ['open'], visibility: 'OnlyMe' }, 10, cursor);

    const filters = callsTo(calls, 'posts')[0]?.filters ?? [];
    expect(filters).toContainEqual(['eq', 'visibility', 'OnlyMe']);
    expect(filters).toContainEqual([
      'or',
      `created_at.lt.2026-01-03T00:00:00Z,and(created_at.eq.2026-01-03T00:00:00Z,id.lt.${ID_A})`,
    ]);
  });

  it('hands back a cursor when there is another page, from the last row kept', async () => {
    const { client } = owned([
      { id: ID_A, created_at: '2026-01-03T00:00:00Z' },
      { id: ID_B, created_at: '2026-01-02T00:00:00Z' },
      { id: ID_C, created_at: '2026-01-01T00:00:00Z' },
    ]);

    const page = await listOwnerPostsPage(client, 'u1', { statuses: ['open'] }, 2);

    expect(page.posts).toHaveLength(2);
    expect(JSON.parse(page.nextCursor ?? 'null')).toEqual({ t: '2026-01-02T00:00:00Z', id: ID_B });
  });

  it('ignores a hostile cursor and returns nothing for no statuses', async () => {
    const { client, calls } = owned([]);
    await listOwnerPostsPage(client, 'u1', { statuses: ['open'] }, 10, JSON.stringify({ t: 'x),id.gt.0', id: ID_A }));
    expect(callsTo(calls, 'posts')[0]?.filters.some((f) => f[0] === 'or')).toBe(false);

    const none = owned([]);
    expect(await listOwnerPostsPage(none.client, 'u1', { statuses: [] }, 10)).toEqual({ posts: [], nextCursor: null });
    expect(none.calls).toHaveLength(0);
  });

  it('reports a missing table as unavailable', async () => {
    const { client } = createFakeClient({ tables: { posts: fail('PGRST205', 'no table') } });
    await expect(listOwnerPostsPage(client, 'u1', { statuses: ['open'] }, 10)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('getProfileClosedPostsHelper', () => {
  it('pages the closed tab and marks every item as the publisher\'s', async () => {
    const { client, calls } = createFakeClient({
      tables: pageTables(),
      rpc: {
        profile_posts_page: ok([
          { card: makeCard({ id: 'p1' }), next_cursor: { t: '2026-01-01T00:00:00Z', id: 'p1' } },
        ]),
      },
    });

    const page = await getProfileClosedPostsHelper(client, 'u1', 1);

    expect(callsTo(calls, 'profile_posts_page')[0]?.args).toMatchObject({ p_user_id: 'u1', p_tab: 'closed', p_limit: 1 });
    expect(page.items).toEqual([
      { post: expect.objectContaining({ postId: 'p1' }), identityRole: 'publisher', closedAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(page.nextCursor).toBe(JSON.stringify({ t: '2026-01-01T00:00:00Z', id: 'p1' }));
  });

  it('lists the owner\'s delivered or deleted "only me" posts for the Hidden screen', async () => {
    const { client, calls } = owned([{ id: ID_A, created_at: '2026-01-03T00:00:00Z' }]);

    await getProfileClosedPostsHelper(client, 'u1', 10, undefined, 'owner_only_me');

    const filters = callsTo(calls, 'posts')[0]?.filters ?? [];
    expect(filters).toContainEqual(['in', 'status', ['closed_delivered', 'deleted_no_recipient']]);
    expect(filters).toContainEqual(['eq', 'visibility', 'OnlyMe']);
    expect(callsTo(calls, 'profile_posts_page')).toHaveLength(0);
  });
});
