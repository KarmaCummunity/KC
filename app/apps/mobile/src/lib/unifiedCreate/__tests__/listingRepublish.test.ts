// D127 — republishing an expired listing-world post: dates never carry over, only its owner sees
// the action, and the create form opens on the source's world and direction.
import { describe, expect, it } from 'vitest';
import type { PostStatus } from '@kc/domain';
import {
  TIME_BOUND_DETAIL_KEYS,
  canRepublishListingPost,
  listingRepublishSeed,
  republishRoute,
  republishTargetFor,
  withoutTimeBoundDetails,
} from '../listingRepublish';

describe('withoutTimeBoundDetails', () => {
  it('keeps every non-date field', () => {
    const details = { food_type: 'cooked', allergens: ['milk'], kosher: 'yes', seats_available: 3 };
    expect(withoutTimeBoundDetails(details)).toEqual(details);
  });

  it.each(TIME_BOUND_DETAIL_KEYS)('drops %s', (key) => {
    const out = withoutTimeBoundDetails({ [key]: '2026-11-09T10:00:00Z', pickup_mode: 'pickup' });
    expect(out).toEqual({ pickup_mode: 'pickup' });
  });

  it('covers the food, ride and event date keys named by D127', () => {
    for (const key of ['expires_at', 'departs_at', 'arrives_at', 'starts_at', 'ends_at']) {
      expect(TIME_BOUND_DETAIL_KEYS).toContain(key);
    }
  });

  it('does not mutate its input', () => {
    const details = { expires_at: '2026-11-09T10:00:00Z', food_type: 'dry' };
    const snapshot = { ...details };
    withoutTimeBoundDetails(details);
    expect(details).toEqual(snapshot);
  });
});

describe('canRepublishListingPost', () => {
  const post = (status: PostStatus, listingId: string | null = 'p1') => ({ ownerId: 'u1', status, listingId });

  it('shows for the owner of an expired listing-world post', () => {
    expect(canRepublishListingPost(post('expired'), 'u1')).toBe(true);
  });

  it('hides for anyone else, a guest, or a post that has not expired', () => {
    expect(canRepublishListingPost(post('expired'), 'u2')).toBe(false);
    expect(canRepublishListingPost(post('expired'), null)).toBe(false);
    for (const status of ['open', 'closed_delivered', 'paused', 'removed_admin'] as const) {
      expect(canRepublishListingPost(post(status), 'u1')).toBe(false);
    }
  });

  it('hides for a post that is not in a listing world', () => {
    expect(canRepublishListingPost(post('expired', null), 'u1')).toBe(false);
  });
});

describe('republishRoute', () => {
  it('opens the create form with the source id', () => {
    expect(republishRoute('p1')).toEqual({ pathname: '/create', params: { republishFrom: 'p1' } });
  });
});

describe('republishTargetFor', () => {
  const source = { ownerId: 'u1', worldSlug: 'food', direction: 'give' as const };

  it('opens the source world and direction for its owner', () => {
    expect(republishTargetFor(source, 'u1')).toEqual({ categoryId: 'food', direction: 'give' });
    expect(republishTargetFor({ ...source, worldSlug: 'rides', direction: 'request' }, 'u1')).toEqual({
      categoryId: 'rides',
      direction: 'request',
    });
  });

  it('refuses someone else\'s post, a guest, the items world and an unknown world', () => {
    expect(republishTargetFor(source, 'u2')).toBeNull();
    expect(republishTargetFor(source, null)).toBeNull();
    expect(republishTargetFor({ ...source, worldSlug: 'items' }, 'u1')).toBeNull();
    expect(republishTargetFor({ ...source, worldSlug: 'nowhere' }, 'u1')).toBeNull();
  });
});

describe('listingRepublishSeed', () => {
  it('carries the details without dates, and the photos in order with their type and size', () => {
    const seed = listingRepublishSeed({
      kindSlug: 'food_offer',
      details: { food_type: 'cooked', expires_at: '2026-11-09T10:00:00Z' },
      media: [
        { storagePath: 'u1/b/1.jpg', sortOrder: 1, mimeType: 'image/jpeg', sizeBytes: 2048 },
        { storagePath: 'u1/b/0.jpg', sortOrder: 0, mimeType: 'image/png', sizeBytes: 1024 },
        // A file without a recorded size cannot be attached again.
        { storagePath: 'u1/b/2.jpg', sortOrder: 2, mimeType: 'image/jpeg', sizeBytes: 0 },
      ],
    });
    expect(seed).toEqual({
      kindSlug: 'food_offer',
      details: { food_type: 'cooked' },
      isOrgEvent: false,
      orgId: null,
      media: [
        { path: 'u1/b/0.jpg', mimeType: 'image/png', sizeBytes: 1024 },
        { path: 'u1/b/1.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 },
      ],
    });
  });

  it('takes an event\'s organization out of its details', () => {
    const seed = listingRepublishSeed({
      kindSlug: 'event',
      details: { org_id: 'o1', starts_at: 'x', ends_at: 'y', registration_policy: 'automatic' },
      media: [],
    });
    expect(seed.isOrgEvent).toBe(true);
    expect(seed.orgId).toBe('o1');
    expect(seed.details).toEqual({ registration_policy: 'automatic' });
  });
});
