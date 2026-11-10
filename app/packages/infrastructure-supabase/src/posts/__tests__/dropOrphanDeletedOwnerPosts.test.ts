import { describe, expect, it } from 'vitest';
import type { PostWithOwner } from '@kc/application';
import { dropOrphanDeletedOwnerPosts, isOrphanDeletedOwnerPost } from '../dropOrphanDeletedOwnerPosts';

const base = {
  postId: 'p1',
  ownerId: 'u1',
  ownerAvatarUrl: null,
  ownerPrivacyMode: 'Public',
  recipientUser: null,
  distanceKm: null,
} as unknown as PostWithOwner;

describe('isOrphanDeletedOwnerPost', () => {
  it('hides orphan owners for viewers', () => {
    const post = { ...base, ownerName: null, ownerHandle: '' };
    expect(isOrphanDeletedOwnerPost(post, 'v')).toBe(true);
  });

  it('keeps own orphan posts for the owner', () => {
    const post = { ...base, ownerId: 'me', ownerName: null, ownerHandle: '' };
    expect(isOrphanDeletedOwnerPost(post, 'me')).toBe(false);
  });

  it('keeps intentionally anonymous posts', () => {
    const post = {
      ...base,
      ownerName: null,
      ownerHandle: '',
      ownerProfileNavigableFromPost: false,
    };
    expect(isOrphanDeletedOwnerPost(post, 'v')).toBe(false);
  });

  it('keeps resolved owners', () => {
    const post = { ...base, ownerName: 'Dana', ownerHandle: 'dana' };
    expect(isOrphanDeletedOwnerPost(post, 'v')).toBe(false);
  });
});

describe('dropOrphanDeletedOwnerPosts', () => {
  it('filters orphan posts only', () => {
    const good = { ...base, ownerName: 'A', ownerHandle: 'a' };
    const bad = { ...base, postId: 'p2', ownerName: null, ownerHandle: '' };
    expect(dropOrphanDeletedOwnerPosts([good, bad], 'v')).toEqual([good]);
  });
});
