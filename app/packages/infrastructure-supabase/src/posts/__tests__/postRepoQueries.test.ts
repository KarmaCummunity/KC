import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall, type FakeResult } from '../../__tests__/fakeBaselineClient';
import {
  countOpenByUser,
  countProfileClosedPosts,
  countProfileOpenPosts,
  countProfilePostsForViewer,
  fetchPostDetail,
} from '../postRepoQueries';
import { fail, makeCard, ok, pageTables } from './cardFixtures';

/** A head-count answer: PostgREST puts the number next to `data`. */
const counted = (count: number): FakeResult => ({ data: null, error: null, count }) as FakeResult;

describe('counters', () => {
  it('counts a member\'s open posts the caller can see', async () => {
    const { client, calls } = createFakeClient({ tables: { posts: counted(4) } });

    expect(await countOpenByUser(client, 'u1')).toBe(4);

    expect(callsTo(calls, 'posts')[0]?.filters).toEqual(
      expect.arrayContaining([['eq', 'owner_id', 'u1'], ['eq', 'status', 'open']]),
    );
  });

  it('counts open and delivered posts for the profile headline', async () => {
    const { client, calls } = createFakeClient({ tables: { posts: counted(7) } });

    expect(await countProfilePostsForViewer(client, 'u1')).toBe(7);

    expect(callsTo(calls, 'posts')[0]?.filters).toContainEqual(['in', 'status', ['open', 'closed_delivered']]);
  });

  it('leaves out the private posts of the open tab when asked', async () => {
    const { client, calls } = createFakeClient({ tables: { posts: counted(2) } });

    expect(await countProfileOpenPosts(client, 'u1', { excludeOnlyMe: true })).toBe(2);
    expect(callsTo(calls, 'posts')[0]?.filters).toContainEqual(['neq', 'visibility', 'OnlyMe']);

    const all = createFakeClient({ tables: { posts: counted(3) } });
    await countProfileOpenPosts(all.client, 'u1');
    expect(callsTo(all.calls, 'posts')[0]?.filters).not.toContainEqual(['neq', 'visibility', 'OnlyMe']);
  });

  it('counts the closed tab with the server function, and the Hidden screen over its own rows', async () => {
    const standard = createFakeClient({ rpc: { profile_closed_posts_count: ok(5) } });
    expect(await countProfileClosedPosts(standard.client, 'u1')).toBe(5);
    expect(callsTo(standard.calls, 'profile_closed_posts_count')[0]?.args).toEqual({ p_user_id: 'u1' });

    const hidden = createFakeClient({ tables: { posts: counted(1) } });
    expect(await countProfileClosedPosts(hidden.client, 'u1', 'owner_only_me')).toBe(1);
    expect(callsTo(hidden.calls, 'posts')[0]?.filters).toContainEqual(['eq', 'visibility', 'OnlyMe']);
  });

  it('is zero without a count, and unavailable without the table', async () => {
    const empty = createFakeClient({ tables: { posts: ok(null) } });
    expect(await countOpenByUser(empty.client, 'u1')).toBe(0);

    const missing = createFakeClient({ tables: { posts: fail('PGRST205', 'no table') } });
    await expect(countOpenByUser(missing.client, 'u1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('fetchPostDetail', () => {
  const GALLERY = [
    {
      id: 'm1', post_id: 'post-1', owner_id: 'owner-1', kind: 'image', storage_bucket: 'post-images',
      storage_key: 'owner-1/b/0.jpg', ordinal: 0, mime_type: 'image/jpeg', size_bytes: 10, width: null,
      height: null, duration_ms: null, blurhash: null, processing_status: 'pending', created_at: '2026-01-01T00:00:00Z',
    },
  ];

  function detailClient(userId: string | null) {
    return createFakeClient({
      userId,
      tables: pageTables({
        post_media: ok(GALLERY),
        post_private_locations: ok({ street: 'Herzl', street_number: '5' }),
      }),
      rpc: { post_cards: ok([makeCard()]) },
    });
  }

  it('returns the card with its whole gallery and, for the owner, the exact street', async () => {
    const { client, calls } = detailClient('owner-1');

    const post = await fetchPostDetail(client, 'post-1');

    expect(callsTo(calls, 'post_cards')[0]?.args).toEqual({ p_post_ids: ['post-1'] });
    expect(post?.mediaAssets.map((m) => m.path)).toEqual(['owner-1/b/0.jpg']);
    expect(post?.address).toMatchObject({ street: 'Herzl', streetNumber: '5' });
  });

  it('does not read the private location for another member', async () => {
    const { client, calls } = detailClient('someone-else');

    const post = await fetchPostDetail(client, 'post-1');

    expect(post?.address.street).toBe('');
    expect(callsTo(calls, 'post_private_locations')).toHaveLength(0);
  });

  it('is null when the caller cannot read the post', async () => {
    const { client } = createFakeClient({ rpc: { post_cards: ok([]) } });
    expect(await fetchPostDetail(client, 'post-1')).toBeNull();
  });

  it('reads the gallery ordered by position', async () => {
    const { client, calls } = detailClient(null);
    await fetchPostDetail(client, 'post-1');
    const read = callsTo(calls, 'post_media')[0] as FakeCall;
    expect(read.filters).toContainEqual(['order', 'ordinal']);
  });
});
