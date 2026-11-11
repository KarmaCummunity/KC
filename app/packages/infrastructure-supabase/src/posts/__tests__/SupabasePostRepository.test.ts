import { describe, expect, it } from 'vitest';
import { callsTo, createFakeClient, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { SupabasePostRepository } from '../SupabasePostRepository';
import { listPostActorIdentitiesForPost, upsertPostActorIdentityRow } from '../postActorIdentityMethods';
import { fail, makeCard, ok, pageTables } from './cardFixtures';

describe('SupabasePostRepository.getFeed', () => {
  function feed(rows: unknown) {
    return createFakeClient({ tables: pageTables(), rpc: { feed_page: ok(rows) } });
  }
  const row = (id: string, over = {}) => ({ card: makeCard({ id, ...over }), next_cursor: { id } });

  it('asks feed_page with the filters and returns the posts and the cursor', async () => {
    const { client, calls } = feed([row('a'), row('b')]);

    const page = await new SupabasePostRepository(client).getFeed('viewer', { type: 'Give', statusFilter: 'open' }, 2);

    expect(callsTo(calls, 'feed_page')[0]?.args).toMatchObject({
      p_limit: 2,
      p_filters: { sort: 'newest', direction: 'offer', status: 'open' },
    });
    expect(page.posts.map((p) => p.postId)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe(JSON.stringify({ id: 'b' }));
  });

  it('narrows the page by item condition while the cursor still advances', async () => {
    const { client } = feed([
      row('a', { details: { item_condition: 'New' } }),
      row('b', { details: { item_condition: 'Fair' } }),
    ]);

    const page = await new SupabasePostRepository(client).getFeed(null, { type: 'Give', itemConditions: ['New'] }, 2);

    expect(page.posts.map((p) => p.postId)).toEqual(['a']);
    expect(page.nextCursor).toBe(JSON.stringify({ id: 'b' }));
  });
});

describe('SupabasePostRepository.findById / create / update', () => {
  it('reads one post through the card', async () => {
    const { client } = createFakeClient({
      tables: pageTables({ post_media: ok([]), post_private_locations: ok(null) }),
      rpc: { post_cards: ok([makeCard()]) },
    });

    const post = await new SupabasePostRepository(client).findById('post-1');

    expect(post).toMatchObject({ postId: 'post-1', ownerName: 'Dana' });
  });

  it('creates, then returns the published post', async () => {
    const { client } = createFakeClient({
      userId: 'owner-1',
      tables: pageTables({
        posts: (call: FakeCall) => ok(call.kind === 'insert' ? { id: 'post-1' } : []),
        post_media: ok([]),
        post_private_locations: ok(null),
      }),
      rpc: { post_cards: ok([makeCard()]), publish_post: ok(null) },
    });

    const created = await new SupabasePostRepository(client).create({
      ownerId: 'owner-1', type: 'Give', visibility: 'Public', title: 'Sofa', description: null, category: 'Furniture',
      address: { city: 'IL-001', cityName: 'Tel Aviv', street: '', streetNumber: '' }, locationDisplayLevel: 'CityOnly',
      itemCondition: null, urgency: null, mediaAssets: [],
    });

    expect(created.postId).toBe('post-1');
  });

  it('says the post is not found when an update leaves nothing to read', async () => {
    const { client } = createFakeClient({
      tables: pageTables({ posts: (call: FakeCall) => ok(call.kind === 'update' ? [{ id: 'post-1' }] : []) }),
      rpc: { post_cards: ok([]) },
    });

    await expect(new SupabasePostRepository(client).update('post-1', { title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('post actor identity', () => {
  it('lists the caller\'s identity rows', async () => {
    const { client, calls } = createFakeClient({
      tables: {
        post_actor_identity: ok([{ post_id: 'p1', user_id: 'u1', surface_visibility: 'FollowersOnly', hide_from_counterparty: true }]),
      },
    });

    expect(await listPostActorIdentitiesForPost(client, 'p1')).toEqual([
      { postId: 'p1', userId: 'u1', surfaceVisibility: 'FollowersOnly', hideFromCounterparty: true },
    ]);
    expect(callsTo(calls, 'post_actor_identity')[0]?.filters).toContainEqual(['eq', 'post_id', 'p1']);
  });

  it('upserts through the RPC and maps a refusal', async () => {
    const accepted = createFakeClient({ rpc: { upsert_post_actor_identity: ok(null) } });
    await upsertPostActorIdentityRow(accepted.client, {
      postId: 'p1', userId: 'u1', surfaceVisibility: 'OnlyMe', hideFromCounterparty: false,
    });
    expect(callsTo(accepted.calls, 'upsert_post_actor_identity')[0]?.args).toEqual({
      p_post_id: 'p1', p_surface_visibility: 'OnlyMe', p_hide_from_counterparty: false,
    });

    const refused = createFakeClient({ rpc: { upsert_post_actor_identity: fail('P0001', 'not_participant') } });
    await expect(
      upsertPostActorIdentityRow(refused.client, { postId: 'p1', userId: 'u1', surfaceVisibility: 'Public', hideFromCounterparty: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
