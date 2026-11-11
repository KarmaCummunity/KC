import { describe, expect, it } from 'vitest';
import { PostError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import {
  closePost,
  getClosureCandidates,
  ownerCompleteOffer,
  reopenPost,
  republishPost,
  unmarkRecipientSelf,
} from '../closureMethods';
import { KIND_ROWS, SUBCATEGORY_ROWS, fail, makeCard, ok } from './cardFixtures';

/** A client that can read the post again after a closure RPC (card + gallery + extras). */
function setup(rpc: FakeClientConfig['rpc'] = {}, tables: FakeClientConfig['tables'] = {}) {
  return createFakeClient({
    userId: 'owner-1',
    tables: {
      item_subcategories: ok(SUBCATEGORY_ROWS),
      post_kinds: ok(KIND_ROWS),
      post_media: ok([]),
      post_private_locations: ok({ street: 'Herzl', street_number: '5' }),
      posts: ok([]),
      challenges: ok([]),
      post_closures: ok([]),
      post_handoffs: ok([]),
      users: ok([]),
      ...tables,
    },
    rpc: { post_cards: ok([makeCard({ status: 'closed_delivered' })]), ...rpc },
  });
}

describe('closePost', () => {
  it('names the recipient and reads the post again', async () => {
    const { client, calls } = setup({ close_post_with_recipient: ok({ id: 'h1' }) });

    const post = await closePost(client, 'post-1', 'u-r');

    expect(callsTo(calls, 'close_post_with_recipient')[0]?.args).toEqual({ p_post_id: 'post-1', p_recipient_id: 'u-r' });
    expect(post.status).toBe('closed_delivered');
  });

  it('closes without a recipient through its own RPC', async () => {
    const { client, calls } = setup({ close_post_without_recipient: ok(null) });

    await closePost(client, 'post-1', null);

    expect(callsTo(calls, 'close_post_without_recipient')[0]?.args).toEqual({ p_post_id: 'post-1' });
    expect(callsTo(calls, 'close_post_with_recipient')).toHaveLength(0);
  });

  it.each([
    ['closure_wrong_status', 'closure_wrong_status'],
    ['closure_recipient_not_in_chat', 'closure_recipient_not_in_chat'],
  ])('maps the refusal %s to a post error', async (reason, code) => {
    const { client } = setup({ close_post_with_recipient: fail('P0001', reason) });
    await expect(closePost(client, 'post-1', 'u-r')).rejects.toMatchObject({ code });
  });

  it('reports a missing function as unavailable', async () => {
    const { client } = setup({ close_post_without_recipient: fail('PGRST202', 'not found') });
    await expect(closePost(client, 'post-1', null)).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('fails when the post cannot be read after closing', async () => {
    const { client } = setup({ close_post_without_recipient: ok(null), post_cards: ok([]) });
    await expect(closePost(client, 'post-1', null)).rejects.toBeInstanceOf(PostError);
  });
});

describe('ownerCompleteOffer', () => {
  it('assigns to a recipient', async () => {
    const { client, calls } = setup({ close_post_with_recipient: ok({}) });
    expect(await ownerCompleteOffer(client, 'post-1', 'u-r', 'assign')).toEqual({ closed: true });
    expect(callsTo(calls, 'close_post_with_recipient')).toHaveLength(1);
  });

  it('closes without a recipient even when one is passed', async () => {
    const { client, calls } = setup({ close_post_without_recipient: ok(null) });
    await ownerCompleteOffer(client, 'post-1', 'u-r', 'close_without');
    expect(callsTo(calls, 'close_post_without_recipient')).toHaveLength(1);
    expect(callsTo(calls, 'close_post_with_recipient')).toHaveLength(0);
  });

  it('refuses to assign nobody', async () => {
    const { client } = setup();
    await expect(ownerCompleteOffer(client, 'post-1', null, 'assign')).rejects.toMatchObject({
      code: 'closure_recipient_not_in_chat',
    });
  });
});

describe('reopenPost / unmarkRecipientSelf', () => {
  it('reopens and reads the post again', async () => {
    const { client, calls } = setup({ reopen_post: ok(null), post_cards: ok([makeCard()]) });
    expect((await reopenPost(client, 'post-1')).status).toBe('open');
    expect(callsTo(calls, 'reopen_post')[0]?.args).toEqual({ p_post_id: 'post-1' });
  });

  it('maps an expired window', async () => {
    const { client } = setup({ reopen_post: fail('P0001', 'reopen_window_expired') });
    await expect(reopenPost(client, 'post-1')).rejects.toMatchObject({ code: 'reopen_window_expired' });
  });

  it('removes the recipient mark, and reports a caller who is not the recipient', async () => {
    const ok1 = setup({ recipient_unmark_self: ok(null) });
    await unmarkRecipientSelf(ok1.client, 'post-1');
    expect(callsTo(ok1.calls, 'recipient_unmark_self')[0]?.args).toEqual({ p_post_id: 'post-1' });

    const refused = setup({ recipient_unmark_self: fail('P0001', 'not_recipient_or_wrong_status') });
    await expect(unmarkRecipientSelf(refused.client, 'post-1')).rejects.toMatchObject({ code: 'closure_wrong_status' });
  });
});

describe('republishPost', () => {
  it('publishes a new post with the old one\'s fields and no photos', async () => {
    const { client, calls } = setup(
      { post_cards: ok([makeCard({ status: 'expired' })]), publish_post: ok(null) },
      { posts: (call) => ok(call.kind === 'insert' ? { id: 'new-2' } : []) },
    );

    const id = await republishPost(client, 'post-1');

    const insert = callsTo(calls, 'posts').find((call) => call.kind === 'insert');
    expect(id).toBe('new-2');
    expect(insert?.payload).toMatchObject({
      owner_id: 'owner-1',
      title: 'Sofa',
      status: 'draft',
      item_subcategory_id: 'sub-furniture',
      details: { item_condition: 'Good', estimated_value: 120 },
    });
    expect(callsTo(calls, 'post_media').some((call) => call.kind === 'insert')).toBe(false);
    expect(callsTo(calls, 'publish_post')).toHaveLength(1);
  });

  it('says the post was not found', async () => {
    const { client } = setup({ post_cards: ok([]) });
    await expect(republishPost(client, 'gone')).rejects.toMatchObject({ code: 'republish_not_found' });
  });
});

describe('getClosureCandidates', () => {
  const user = (id: string, name: string) => ({
    id, share_handle: id, display_name: name, biography: null, avatar_url: null, city_id: 'IL-001',
    privacy_mode: 'Public', privacy_changed_at: null, verification_level: 0, preferred_language: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });

  it('lists the other member of every anchored chat, latest conversation first, once each', async () => {
    const { client, calls } = createFakeClient({
      userId: 'owner-1',
      tables: {
        posts: ok({ owner_id: 'owner-1' }),
        chats: ok([
          { direct_user_a: 'owner-1', direct_user_b: 'u-a', last_message_at: '2026-01-02T00:00:00Z' },
          { direct_user_a: 'u-b', direct_user_b: 'owner-1', last_message_at: '2026-01-05T00:00:00Z' },
          { direct_user_a: 'owner-1', direct_user_b: 'u-a', last_message_at: '2026-01-03T00:00:00Z' },
          { direct_user_a: 'owner-1', direct_user_b: 'u-empty', last_message_at: null },
          { direct_user_a: 'owner-1', direct_user_b: null, last_message_at: '2026-01-06T00:00:00Z' },
        ]),
        users: ok([user('u-a', 'Alma'), user('u-b', 'Boaz')]),
        cities: ok([{ city_id: 'IL-001', name_he: 'Tel Aviv' }]),
        user_stats: ok([]),
      },
    });

    const candidates = await getClosureCandidates(client, 'post-1');

    expect(candidates).toEqual([
      { userId: 'u-b', fullName: 'Boaz', avatarUrl: null, cityName: 'Tel Aviv', lastMessageAt: '2026-01-05T00:00:00Z' },
      { userId: 'u-a', fullName: 'Alma', avatarUrl: null, cityName: 'Tel Aviv', lastMessageAt: '2026-01-03T00:00:00Z' },
    ]);
    expect(callsTo(calls, 'chats')[0]?.filters).toContainEqual(['eq', 'anchor_post_id', 'post-1']);
  });

  it('returns nothing without chats, and says not found for an unreadable post', async () => {
    const empty = createFakeClient({ tables: { posts: ok({ owner_id: 'o' }), chats: ok([]) } });
    expect(await getClosureCandidates(empty.client, 'post-1')).toEqual([]);

    const missing = createFakeClient({ tables: { posts: ok(null) } });
    await expect(getClosureCandidates(missing.client, 'post-1')).rejects.toMatchObject({ code: 'not_found' });
  });
});
