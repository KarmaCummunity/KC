import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import { SupabaseSocialFeedRepository } from '../SupabaseSocialFeedRepository';

const ok = (data: unknown): FakeResult => ({ data, error: null });

describe('SupabaseSocialFeedRepository', () => {
  it('hides a post for the signed-in member and ignores a duplicate', async () => {
    const { client, calls } = createFakeClient({ userId: 'u1', tables: { feed_hides: ok(null) } });

    await new SupabaseSocialFeedRepository(client).hidePost('p1');

    const write = callsTo(calls, 'feed_hides')[0];
    expect(write?.payload).toEqual({ user_id: 'u1', post_id: 'p1' });
    expect(write?.filters).toContainEqual(['onConflict', { onConflict: 'user_id,post_id', ignoreDuplicates: true }]);
  });

  it('logs impressions as bare post ids and skips an empty list', async () => {
    const { client, calls } = createFakeClient({ tables: { feed_impressions: ok(null) } });
    const repo = new SupabaseSocialFeedRepository(client);

    await repo.logImpressions([]);
    expect(calls).toHaveLength(0);
    await repo.logImpressions(['a', 'b']);

    expect(callsTo(calls, 'feed_impressions')[0]?.payload).toEqual([{ post_id: 'a' }, { post_id: 'b' }]);
  });

  it('lists the mutes with the value of their kind', async () => {
    const { client } = createFakeClient({
      tables: {
        feed_mute_filters: ok([
          { id: 'f1', filter_kind: 'user', muted_user_id: 'u9', world_slug: null, keyword: null, created_at: 't1' },
          { id: 'f2', filter_kind: 'world', muted_user_id: null, world_slug: 'food', keyword: null, created_at: 't2' },
          { id: 'f3', filter_kind: 'keyword', muted_user_id: null, world_slug: null, keyword: 'sofa', created_at: 't3' },
        ]),
      },
    });

    expect(await new SupabaseSocialFeedRepository(client).listMuteFilters()).toEqual([
      { filterId: 'f1', filterKind: 'user', filterValue: 'u9', createdAt: 't1' },
      { filterId: 'f2', filterKind: 'world', filterValue: 'food', createdAt: 't2' },
      { filterId: 'f3', filterKind: 'keyword', filterValue: 'sofa', createdAt: 't3' },
    ]);
  });

  it('adds each kind in its own column, a keyword trimmed and lower-case', async () => {
    const { client, calls } = createFakeClient({ userId: 'u1', tables: { feed_mute_filters: ok(null) } });
    const repo = new SupabaseSocialFeedRepository(client);

    await repo.addMuteFilter('user', 'u9');
    await repo.addMuteFilter('world', 'food');
    await repo.addMuteFilter('keyword', '  Baby Stroller ');

    const writes = callsTo(calls, 'feed_mute_filters');
    expect(writes.map((w) => w.payload)).toEqual([
      { user_id: 'u1', filter_kind: 'user', muted_user_id: 'u9' },
      { user_id: 'u1', filter_kind: 'world', world_slug: 'food' },
      { user_id: 'u1', filter_kind: 'keyword', keyword: 'baby stroller' },
    ]);
    expect(writes[2]?.filters).toContainEqual(['onConflict', { onConflict: 'user_id,keyword', ignoreDuplicates: true }]);
  });

  it('removes a mute by id', async () => {
    const { client, calls } = createFakeClient({ tables: { feed_mute_filters: ok(null) } });

    await new SupabaseSocialFeedRepository(client).removeMuteFilter('f1');

    const write = callsTo(calls, 'feed_mute_filters')[0];
    expect(write?.kind).toBe('delete');
    expect(write?.filters).toContainEqual(['eq', 'id', 'f1']);
  });

  it('reports a missing table as unavailable', async () => {
    const { client } = createFakeClient({
      tables: { feed_mute_filters: { data: null, error: { code: 'PGRST205', message: 'no table' } } },
    });
    await expect(new SupabaseSocialFeedRepository(client).listMuteFilters()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
