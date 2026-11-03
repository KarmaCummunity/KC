import { describe, expect, it } from 'vitest';
import type { PostWithOwner } from '@kc/application';
import { canSharePost } from '../canSharePost';

const base: PostWithOwner = {
  postId: 'p1',
  ownerId: 'u_owner',
  type: 'Give',
  status: 'open',
  statusBeforeAdminRemoval: null,
  visibility: 'Public',
  title: 'שולחן',
  description: null,
  category: 'Furniture',
  address: { city: 'tel-aviv', cityName: 'תל אביב', street: 'דיזengoff', streetNumber: '1' },
  locationDisplayLevel: 'CityOnly',
  itemCondition: 'Good',
  urgency: null,
  estimatedValue: null,
  sourceLanguage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  mediaAssets: [],
  recipient: null,
  reopenCount: 0,
  listingId: null,
  listingWorldSlug: null,
  deleteAfter: null,
  ownerName: 'Test',
  ownerAvatarUrl: null,
  ownerHandle: 'test',
  ownerPrivacyMode: 'Public',
  recipientUser: null,
  distanceKm: null,
  ownerProfileNavigableFromPost: true,
};

const closedHidden = {
  ...base,
  status: 'closed_delivered' as const,
  visibility: 'OnlyMe' as const,
  recipient: { postId: 'p1', recipientUserId: 'u_recipient', markedAt: '2026-01-02T00:00:00.000Z' },
  recipientUser: {
    userId: 'u_recipient',
    displayName: 'Lian',
    shareHandle: 'lian',
    avatarUrl: null,
  },
};

describe('canSharePost', () => {
  it('allows Public open posts for any viewer', () => {
    expect(canSharePost(base, 'u_other')).toBe(true);
  });

  it('allows Public closed_delivered posts for third parties', () => {
    expect(canSharePost({ ...closedHidden, visibility: 'Public' }, 'u_other')).toBe(true);
  });

  it('allows the owner to share a hidden closed_delivered post', () => {
    expect(canSharePost(closedHidden, 'u_owner')).toBe(true);
  });

  it('allows the marked recipient to share a hidden closed_delivered post', () => {
    expect(canSharePost(closedHidden, 'u_recipient')).toBe(true);
  });

  it('blocks non-Public open posts for non-owners', () => {
    expect(canSharePost({ ...base, visibility: 'OnlyMe' }, 'u_other')).toBe(false);
  });

  it('blocks hidden closed_delivered posts for non-participants', () => {
    expect(canSharePost(closedHidden, 'u_other')).toBe(false);
  });

  it('recognizes recipient via recipient.recipientUserId when recipientUser join is absent', () => {
    expect(
      canSharePost(
        {
          ...closedHidden,
          recipientUser: null,
        },
        'u_recipient',
      ),
    ).toBe(true);
  });

  it('blocks other lifecycle states', () => {
    expect(canSharePost({ ...base, status: 'deleted_no_recipient' }, 'u_owner')).toBe(false);
    expect(canSharePost({ ...base, status: 'expired' }, 'u_owner')).toBe(false);
    expect(canSharePost({ ...base, status: 'removed_admin' }, 'u_owner')).toBe(false);
  });
});
