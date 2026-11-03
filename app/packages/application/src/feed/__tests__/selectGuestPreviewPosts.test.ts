import { describe, it, expect } from 'vitest';
import type { PostWithOwner } from '../../ports/IPostRepository';

const base = (id: string, createdAt: string, visibility: 'Public' | 'FollowersOnly'): PostWithOwner => ({
  postId: id,
  ownerId: 'u1',
  ownerName: 'Test',
  ownerAvatarUrl: null,
  ownerHandle: 'test',
  ownerPrivacyMode: 'Public',
  type: 'Give',
  status: 'open',
  statusBeforeAdminRemoval: null,
  visibility,
  title: `t${id}`,
  description: null,
  category: 'Books',
  address: { city: 'tel-aviv', cityName: 'תל אביב', street: 'a', streetNumber: '1' },
  locationDisplayLevel: 'CityOnly',
  itemCondition: 'Good',
  urgency: null,
  estimatedValue: null,
  sourceLanguage: null,
  mediaAssets: [],
  recipient: null,
  recipientUser: null,
  distanceKm: null,
  reopenCount: 0,
  listingId: null,
  listingWorldSlug: null,
  deleteAfter: null,
  createdAt,
  updatedAt: createdAt,
});

describe('selectGuestPreviewPosts', () => {
  it('returns up to 3 newest public open posts', async () => {
    const { selectGuestPreviewPosts } = await import('../selectGuestPreviewPosts');
    const posts: PostWithOwner[] = [
      base('old', '2026-01-01T10:00:00.000Z', 'Public'),
      base('new', '2026-01-03T10:00:00.000Z', 'Public'),
      base('mid', '2026-01-02T10:00:00.000Z', 'Public'),
    ];
    const result = selectGuestPreviewPosts(posts);
    expect(result.map((p) => p.postId)).toEqual(['new', 'mid', 'old']);
  });

  it('excludes non-public and non-open posts', async () => {
    const { selectGuestPreviewPosts } = await import('../selectGuestPreviewPosts');
    const pub = base('a', '2026-01-02T10:00:00.000Z', 'Public');
    const followers = base('b', '2026-01-03T10:00:00.000Z', 'FollowersOnly');
    const closed: PostWithOwner = {
      ...pub,
      postId: 'c',
      createdAt: '2026-01-04T10:00:00.000Z',
      status: 'closed_delivered',
    };
    const result = selectGuestPreviewPosts([followers, closed, pub]);
    expect(result).toHaveLength(1);
    expect(result[0]!.postId).toBe('a');
  });

  it('returns fewer than 3 when not enough eligible posts', async () => {
    const { selectGuestPreviewPosts } = await import('../selectGuestPreviewPosts');
    const posts: PostWithOwner[] = [base('only', '2026-01-01T10:00:00.000Z', 'Public')];
    expect(selectGuestPreviewPosts(posts)).toHaveLength(1);
  });
});
