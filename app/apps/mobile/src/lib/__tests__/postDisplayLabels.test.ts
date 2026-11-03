import { describe, it, expect } from 'vitest';
import type { PostWithOwner } from '@kc/application';
import { postOwnerDisplayLabel } from '../postOwnerDisplayLabel';
import { postRecipientDisplayLabel } from '../postRecipientDisplayLabel';

const mockT = (key: string) => `[t:${key}]`;

const basePost = {
  postId: 'p-1',
  ownerId: 'u-1',
  type: 'Give',
  status: 'open',
  title: 'Test Item',
  description: 'Description',
  category: 'Furniture',
  address: { cityName: 'Tel Aviv', street: 'Main', streetNumber: '1' },
  ownerName: 'Alice',
  ownerAvatarUrl: null,
  ownerHandle: 'alice',
  ownerPrivacyMode: 'Public',
  recipientUser: null,
  distanceKm: null,
} as unknown as PostWithOwner;

describe('postOwnerDisplayLabel', () => {
  it('returns ownerName when owner profile is navigable and ownerName is present', () => {
    const post = { ...basePost, ownerName: 'Alice', ownerProfileNavigableFromPost: true };
    expect(postOwnerDisplayLabel(post, mockT)).toBe('Alice');
  });

  it('falls back to deletedUser when ownerName is null and navigable is true', () => {
    const post = { ...basePost, ownerName: null, ownerProfileNavigableFromPost: true };
    expect(postOwnerDisplayLabel(post, mockT)).toBe('[t:common.deletedUser]');
  });

  it('returns anonymousUser when ownerProfileNavigableFromPost is false', () => {
    const post = { ...basePost, ownerName: 'Alice', ownerProfileNavigableFromPost: false };
    expect(postOwnerDisplayLabel(post, mockT)).toBe('[t:post.detail.anonymousUser]');
  });
});

describe('postRecipientDisplayLabel', () => {
  const recipient = {
    userId: 'u-2',
    displayName: 'Bob',
    avatarUrl: null,
    shareHandle: 'bob',
  };

  it('returns displayName when profileNavigable is true', () => {
    expect(postRecipientDisplayLabel(recipient, true, mockT)).toBe('Bob');
  });

  it('falls back to fallbackName when displayName is null and profileNavigable is true', () => {
    const withoutName = { ...recipient, displayName: null as unknown as string };
    expect(postRecipientDisplayLabel(withoutName, true, mockT)).toBe('[t:profile.fallbackName]');
  });

  it('returns displayName when profileNavigable is false but displayName is non-empty', () => {
    expect(postRecipientDisplayLabel(recipient, false, mockT)).toBe('Bob');
  });

  it('returns anonymousUser when profileNavigable is false and displayName is empty or missing', () => {
    const emptyName = { ...recipient, displayName: '' };
    expect(postRecipientDisplayLabel(emptyName, false, mockT)).toBe('[t:post.detail.anonymousUser]');
  });
});
