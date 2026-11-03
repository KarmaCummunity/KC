import { describe, it, expect } from 'vitest';
import type { Post } from '@kc/domain';
import { postWithOwnerFromPost } from '../postWithOwnerFromPost';

describe('postWithOwnerFromPost', () => {
  const domainPost = {
    postId: 'p-1',
    ownerId: 'u-1',
    type: 'Give',
    status: 'open',
    title: 'Vintage Chair',
    description: 'Good condition',
    category: 'Furniture',
    address: { cityName: 'Jerusalem', street: 'King George', streetNumber: '10' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Post;

  it('hydrates a PostWithOwner with explicit owner context', () => {
    const owner = {
      ownerId: 'u-1',
      ownerName: 'Sarah',
      ownerAvatarUrl: 'https://example.com/avatar.jpg',
      ownerHandle: 'sarah_k',
    };

    const hydrated = postWithOwnerFromPost(domainPost, owner);

    expect(hydrated.postId).toBe('p-1');
    expect(hydrated.ownerName).toBe('Sarah');
    expect(hydrated.ownerAvatarUrl).toBe('https://example.com/avatar.jpg');
    expect(hydrated.ownerHandle).toBe('sarah_k');
    expect(hydrated.ownerPrivacyMode).toBe('Public');
    expect(hydrated.recipientUser).toBeNull();
    expect(hydrated.distanceKm).toBeNull();
  });

  it('provides safe defaults when owner context is omitted', () => {
    const hydrated = postWithOwnerFromPost(domainPost);

    expect(hydrated.postId).toBe('p-1');
    expect(hydrated.ownerName).toBeNull();
    expect(hydrated.ownerAvatarUrl).toBeNull();
    expect(hydrated.ownerHandle).toBe('');
    expect(hydrated.ownerPrivacyMode).toBe('Public');
    expect(hydrated.recipientUser).toBeNull();
    expect(hydrated.distanceKm).toBeNull();
  });
});
