import { describe, expect, it } from 'vitest';
import { ORG_EVENT_KIND_SLUG } from '@kc/domain';
import { ownerCancelNotifiesHolders } from '../listingHasHolders';

describe('ownerCancelNotifiesHolders', () => {
  it('is true for a ride and an organization event (FR-RIDE-047, D131)', () => {
    expect(ownerCancelNotifiesHolders({ worldSlug: 'rides', kindSlug: 'ride_offer' })).toBe(true);
    expect(ownerCancelNotifiesHolders({ worldSlug: 'time', kindSlug: ORG_EVENT_KIND_SLUG })).toBe(true);
  });

  it('is false for an item and a person-to-person time post', () => {
    expect(ownerCancelNotifiesHolders({ worldSlug: 'items', kindSlug: 'give_item' })).toBe(false);
    expect(ownerCancelNotifiesHolders({ worldSlug: 'time', kindSlug: 'volunteer_shift' })).toBe(false);
  });
});
