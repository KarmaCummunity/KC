import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseGuestProfileRepository } from '../SupabaseGuestProfileRepository';

const id = '40000000-0000-4000-8000-000000000001';
const profileRow = {
  share_handle: 'alice',
  display_name: 'Alice',
  avatar_url: 'avatars/a.jpg',
  biography: 'Hi',
  city_name_he: 'לוד',
  city_name_en: 'Lod',
  verification_level: 1,
  followers_count: 2,
  following_count: 3,
  items_given_count: 4,
  items_received_count: 5,
  open_posts_count: 6,
  email: 'never-copy',
};
const postRow = {
  id, title: 'Desk', description: 'A desk', city_name_he: 'לוד', city_name_en: 'Lod',
};

describe('guest profile adapter', () => {
  it('maps guest_profile and omits unexpected member fields', async () => {
    const { client, calls } = createFakeClient({
      rpc: { guest_profile: { data: [profileRow], error: null } },
    });
    const repo = new SupabaseGuestProfileRepository(client);
    expect(await repo.getByHandle('alice')).toEqual({
      shareHandle: 'alice',
      displayName: 'Alice',
      avatarUrl: 'avatars/a.jpg',
      biography: 'Hi',
      cityNameHe: 'לוד',
      cityNameEn: 'Lod',
      verificationLevel: 1,
      followersCount: 2,
      followingCount: 3,
      itemsGivenCount: 4,
      itemsReceivedCount: 5,
      openPostsCount: 6,
    });
    expect(calls[0]).toMatchObject({
      kind: 'rpc', fn: 'guest_profile', args: { p_share_handle: 'alice' },
    });
  });

  it('treats a missing profile as null, not an error', async () => {
    const { client } = createFakeClient({
      rpc: { guest_profile: { data: [], error: null } },
    });
    expect(await new SupabaseGuestProfileRepository(client).getByHandle('nobody')).toBeNull();
  });

  it('lists guest_profile_posts with the guest_posts row shape', async () => {
    const { client, calls } = createFakeClient({
      rpc: { guest_profile_posts: { data: [postRow], error: null } },
    });
    const repo = new SupabaseGuestProfileRepository(client);
    expect(await repo.listPosts('alice', id)).toEqual([
      { id, title: 'Desk', description: 'A desk', cityNameHe: 'לוד', cityNameEn: 'Lod' },
    ]);
    expect(calls[0]?.args).toEqual({
      p_share_handle: 'alice', p_limit: 20, p_before_id: id,
    });
  });

  it('skips the network for an invalid before-id cursor', async () => {
    const { client, calls } = createFakeClient();
    expect(await new SupabaseGuestProfileRepository(client).listPosts('alice', 'bad')).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
